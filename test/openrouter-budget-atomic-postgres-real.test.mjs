// Real multi-session PostgreSQL test in a disposable Linux cluster only.
// NEVER run against Windows localhost or a user-managed database.
// NO provider requests, billing evidence or spend authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const sql=readFileSync(
  new URL('../sql/openrouter_budget_offline_atomic_v1.sql',import.meta.url),'utf8');
const enabled=process.platform==='linux' &&
  process.env.SHADOW_POSTGRES_REAL==='1' &&
  process.env.SHADOW_PG_CLIENT_ENTRY &&
  process.env.SHADOW_PG_ISOLATED_SOCKET &&
  process.env.SHADOW_PG_EXPECTED_DATA_DIR;

const role='reviewer_b';
const source='a'.repeat(64);
const query='SELECT * FROM openrouter_budget_offline.propose_quote($1,$2,$3,$4,$5)';
const args=(run,who='reviewer_b',eur=1000000,usd=1000000)=>[
  source,run,who,eur,usd];
const call=async(client,values)=>{
  const res=await client.query(query,values);
  assert.equal(res.rows.length,1);
  const r=res.rows[0];
  assert.equal(r.may_reserve,false);
  assert.equal(r.may_spend,false);
  assert.equal(r.may_start_runner,false);
  return r;
};
const totals=async client=>{
  const m=await client.query('SELECT global_held_micro_eur::text AS total FROM openrouter_budget_offline.months');
  const r=await client.query('SELECT role,key_held_micro_usd::text AS total FROM openrouter_budget_offline.roles ORDER BY role');
  const q=await client.query('SELECT count(*)::integer AS n FROM openrouter_budget_offline.quotes');
  return {eur:m.rows[0]?.total,roles:r.rows,quotes:q.rows[0].n};
};
test('three isolated PostgreSQL 16 sessions: atomic caps, replay, rollback, no spend',{
  skip:!enabled?'needs disposable Linux PostgreSQL 16 Unix socket and pg client':false,
  timeout:45000,
},async t=>{
  const socket=realpathSync(process.env.SHADOW_PG_ISOLATED_SOCKET);
  const datadir=realpathSync(process.env.SHADOW_PG_EXPECTED_DATA_DIR);
  // Verify the caller points to a throwaway WSL/Linux cluster. Never use TCP
  // localhost:5432, which may lead to the user's Windows PostgreSQL instance.
  assert.match(socket,/^\/tmp\/devfactory-pg16-[A-Za-z0-9_-]+\/socket$/);
  assert.match(datadir,/^\/tmp\/devfactory-pg16-[A-Za-z0-9_-]+\/data$/);
  assert.equal(socket.slice(0,socket.lastIndexOf('/')),
    datadir.slice(0,datadir.lastIndexOf('/')));
  const pg=await import(pathToFileURL(resolve(process.env.SHADOW_PG_CLIENT_ENTRY)).href);
  const Client=pg.default?.Client||pg.Client;
  assert.equal(typeof Client,'function');
  const make=()=>new Client({
    host:socket,port:5432,user:process.env.SHADOW_PG_TEST_USER||'ismah',
    database:'postgres',connectionTimeoutMillis:2500,query_timeout:3500,
  });
  const clients=Array.from({length:3},make);
  t.after(async()=>Promise.all(clients.map(c=>c.end().catch(()=>{}))));
  // The first connection is READ ONLY until the exact disposable data directory
  // and PostgreSQL 16 version have been verified. Do not touch foreign servers.
  await clients[0].connect();
  const [a,b,observer]=clients;
  const evidence=await a.query(
    "SELECT current_setting('data_directory') AS dir,current_setting('server_version_num')::integer AS version,current_setting('listen_addresses') AS listens");
  assert.equal(realpathSync(evidence.rows[0].dir),datadir);
  assert.ok(evidence.rows[0].version>=160000&&evidence.rows[0].version<170000);
  assert.ok(evidence.rows[0].listens===''||
    evidence.rows[0].listens==='127.0.0.1','must not listen globally');
  await Promise.all([b.connect(),observer.connect()]);
  await a.query(sql);
  const period="date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date";
  await a.query('INSERT INTO openrouter_budget_offline.months(month_utc) VALUES ('+period+')');
  await a.query('INSERT INTO openrouter_budget_offline.roles(month_utc,role) VALUES ('+
    period+",$1),("+period+',$2)', ['reviewer_b','development']);

  // The same calendar-month lock serializes BOTH roles and prevents overlap.
  await a.query('BEGIN');
  await a.query('SELECT * FROM openrouter_budget_offline.months FOR UPDATE');
  await assert.rejects(()=>call(b,args('locked','development',1000000,1000000)),
    error=>error.code==='55P03');
  await a.query('ROLLBACK');
  assert.equal((await totals(observer)).quotes,0);

  // A local rollback restores both counters and permits reusing a *test-only*
  // identity. This must not be interpreted as approval to retry provider POST.
  await a.query('BEGIN');
  assert.equal((await call(a,args('rolled',role,1000000,1000000))).recorded,true);
  assert.equal((await totals(observer)).quotes,0);
  await a.query('ROLLBACK');
  assert.equal((await totals(observer)).eur,'0');
  assert.equal((await totals(observer)).quotes,0);

  assert.equal((await call(a,args('r1',role,7000000,2000000))).recorded,true);
  assert.equal((await call(b,args('r1','development',1,1))).reason,
    'OFFLINE_DUPLICATE_OR_AMBIGUOUS');
  assert.equal((await call(b,args('r2',role,1000000,1000000))).recorded,true);
  assert.equal((await call(b,args('r3',role,1,1))).reason,'OFFLINE_CAP_EXCEEDED');

  await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const stale=await call(b,args('stale','development',1,1));
  assert.equal(stale.recorded,false);
  assert.equal(stale.reason,'OFFLINE_ISOLATION_UNSUPPORTED');
  await b.query('ROLLBACK');

  assert.equal((await call(a,args('d1','development',7000000,10000000))).recorded,true);
  assert.equal((await call(b,args('d2','development',1,1))).reason,
    'OFFLINE_CAP_EXCEEDED');
  assert.deepEqual(await totals(observer),{
    eur:'15000000',
    roles:[
      {role:'development',total:'10000000'},
      {role:'reviewer_b',total:'3000000'},
    ],
    quotes:3,
  });
  const publicPrivilege=await a.query(
    "SELECT count(*)::integer AS n FROM pg_catalog.pg_proc p "+
    "JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace "+
    "CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl "+
    "WHERE n.nspname='openrouter_budget_offline' "+
    "AND p.proname='propose_quote' AND acl.grantee=0 AND acl.privilege_type='EXECUTE'");
  assert.equal(publicPrivilege.rows[0].n,0);
});
