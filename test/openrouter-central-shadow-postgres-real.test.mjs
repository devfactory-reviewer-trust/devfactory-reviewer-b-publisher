// Real multi-connection PostgreSQL synthetic integration test.
// This file is NEVER imported by paid Reviewer B and holds no real secrets.
// GitHub Actions provides an isolated postgres service and ephemeral role.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const enabled=process.env.SHADOW_POSTGRES_REAL==='1';
const clientEntry=process.env.SHADOW_PG_CLIENT_ENTRY;
const sql=readFileSync(new URL('../sql/reviewer_b_shadow_central_pg_v1.sql',import.meta.url),'utf8');
const rolesSql=readFileSync(new URL('../sql/reviewer_b_shadow_protected_roles_v1.sql',import.meta.url),'utf8');
const model='qwen/qwen3-coder-30b-a3b-instruct';
const target='deenkids7-dev/deenkids';
const syntheticRolePassword='synthetic-shadow-ci-only-20261020';
const arg=(i,upper=1000000)=>[
  target,200000+i,i.toString(16).padStart(40,'0'),800000+i,model,'synthetic-run-'+i,upper,
];
const call=async(client,args)=>{
  const result=await client.query(
    'SELECT * FROM reviewer_b_shadow.propose_exposure($1,$2,$3,$4,$5,$6,$7)',args);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].may_spend,false);
  assert.equal(result.rows[0].provider_billing_authenticated,false);
  return result;
};
const count=async c=>(await c.query(
  'SELECT count(*)::int AS n FROM reviewer_b_shadow.exposure_proposals')).rows[0].n;
const counters=async c=>(await c.query(
  'SELECT reserved_micro_eur::text AS total, proposal_count AS n FROM reviewer_b_shadow.monthly_periods')).rows[0];
const makeClient=Client=>new Client({
  host:'127.0.0.1',port:5432,user:'postgres',
  password:process.env.PGPASSWORD,database:'postgres',
  connectionTimeoutMillis:2500,query_timeout:4000,
});
test('real PostgreSQL: three independent sessions, row locks, rollback and cap', {
  skip:!enabled||!clientEntry?'requires isolated PostgreSQL Actions job':false,
  timeout:40000,
},async t=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  assert.equal(process.env.PGPASSWORD,syntheticRolePassword);
  const pg=await import(pathToFileURL(clientEntry).href);
  const Client=pg.default?.Client||pg.Client;
  const clients=Array.from({length:3},()=>makeClient(Client));
  // Register cleanup before the first connection attempt, including errors.
  t.after(async()=>{await Promise.all(clients.map(c=>c.end().catch(()=>{})))});
  for(const c of clients)await c.connect();
  const [a,b,observer]=clients;
  await a.query(sql);
  await a.query(
    "INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
  assert.equal((await counters(observer)).n,0);

  // A holds the *same* server row that a second distinct session requires.
  await a.query('BEGIN');
  await a.query('SELECT month_utc FROM reviewer_b_shadow.monthly_periods FOR UPDATE');
  await assert.rejects(()=>call(b,arg(1,1_000_000)),e=>e.code==='55P03');
  assert.equal(await count(observer),0);
  await a.query('ROLLBACK');
  assert.equal((await counters(observer)).n,0);

  // A transaction rollback (or crash) cannot expose a partially admitted
  // proposal or period counter on the independent observer connection.
  await a.query('BEGIN');
  assert.equal((await call(a,arg(2,3_000_000))).rows[0].recorded,true);
  assert.equal(await count(observer),0);
  await a.query('ROLLBACK');
  assert.equal(await count(observer),0);
  assert.equal((await counters(observer)).n,0);
  // The same synthetic identity can be admitted after a rolled-back proposal,
  // but that second provisional admission must also disappear on rollback.
  await a.query('BEGIN');
  assert.equal((await call(a,arg(2,3_000_000))).rows[0].recorded,true);
  await a.query('ROLLBACK');
  assert.equal(await count(observer),0);
  assert.equal((await counters(observer)).total,'0');

  // A committed proposal is visible on an independent observer connection;
  // a HEAD replay is denied even with a fresh service comment ID.
  const first=await call(a,arg(3,10_000_000));
  assert.equal(first.rows[0].recorded,true);
  assert.equal(first.rows[0].may_spend,false);
  assert.equal(first.rows[0].provider_billing_authenticated,false);
  assert.equal((await counters(observer)).n,1);
  assert.equal((await counters(observer)).total,'10000000');
  assert.equal((await call(b,[...arg(3,2_000_000).slice(0,3),
    929393,model,'synthetic-run-retry',2_000_000])).rows[0].recorded,false);
  assert.equal(await count(observer),1);

  // An existing REPEATABLE READ snapshot MUST NOT bypass the updated
  // period row nor admit a second billable upper bound.
  await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await b.query('SELECT count(*) FROM reviewer_b_shadow.exposure_proposals');
  const second=await call(a,arg(4,4_000_000));
  assert.equal(second.rows[0].recorded,true);
  const stale=await call(b,arg(5,4_000_000));
  assert.equal(stale.rows[0].recorded,false);
  assert.equal(stale.rows[0].reason,'SHADOW_ISOLATION_UNSUPPORTED');
  await b.query('ROLLBACK');
  assert.equal((await counters(observer)).total,'14000000');
  assert.equal((await counters(observer)).n,2);

  const over=await call(b,arg(6,2_000_000));
  assert.equal(over.rows[0].recorded,false);
  assert.equal(over.rows[0].reason,'SHADOW_EUR15_CEILING_EXCEEDED');
  assert.equal(await count(observer),2);
  const last=await call(observer,arg(7,1_000_000));
  assert.equal(last.rows[0].recorded,true);
  assert.equal((await counters(observer)).total,'15000000');
  assert.equal((await counters(observer)).n,3);
  assert.equal((await call(a,arg(8,1))).rows[0].recorded,false);
  assert.equal((await counters(observer)).total,'15000000');
  assert.equal((await counters(observer)).n,3);

  // Synthetic test DB ONLY: reset between independent test scenarios.
  // A production ledger MUST NOT permit deletion/reset after billable calls.
  await observer.query('BEGIN');
  await observer.query('DELETE FROM reviewer_b_shadow.exposure_proposals');
  await observer.query('UPDATE reviewer_b_shadow.monthly_periods SET reserved_micro_eur=0,proposal_count=0');
  await observer.query('COMMIT');
  assert.equal((await call(observer,arg(20,14_000_000))).rows[0].recorded,true);

  // Deterministic overlap at the exact remaining EUR 1: A holds its
  // winning proposal UNCOMMITTED while B attempts the identical month row.
  await a.query('BEGIN');
  assert.equal((await call(a,arg(21,1_000_000))).rows[0].recorded,true);
  await assert.rejects(()=>call(b,arg(22,1_000_000)),
    error=>error.code==='55P03');
  assert.equal(await count(observer),1);
  assert.equal((await counters(observer)).total,'14000000');
  await a.query('COMMIT');
  // A distinct *synthetic test probe* now sees the committed ceiling and is
  // denied. This is NOT an automatic retry policy for billable model calls.
  const rejected=await call(b,arg(22,1_000_000));
  assert.equal(rejected.rows[0].recorded,false);
  assert.equal(rejected.rows[0].reason,'SHADOW_EUR15_CEILING_EXCEEDED');
  assert.equal(await count(observer),2);
  assert.equal((await counters(observer)).total,'15000000');
  assert.equal((await counters(observer)).n,2);

  // PUBLIC grants are absent. A low-privilege caller cannot run the
  // SECURITY INVOKER function, documenting the pending role-design blocker.
  const grants=await observer.query(
    "SELECT count(*)::integer AS n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl WHERE n.nspname='reviewer_b_shadow' AND p.oid='reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE'");
  assert.equal(grants.rows[0].n,0);
  await observer.query('CREATE ROLE shadow_lowpriv_synthetic NOLOGIN');
  const permission=await observer.query(
    "SELECT has_function_privilege('shadow_lowpriv_synthetic','reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)','EXECUTE') AS enabled");
  assert.equal(permission.rows[0].enabled,false);

  // Provision an isolated NOLOGIN budget owner and restricted executor.
  // This SQL must never run on a real shared database without a new
  // independent deployment/DB-privilege approval.
  await observer.query(rolesSql);
  const functionProtection=await observer.query(
    "SELECT p.prosecdef, p.proowner::regrole::text AS owner FROM pg_catalog.pg_proc p WHERE p.oid='reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)'::regprocedure");
  assert.equal(functionProtection.rows[0].prosecdef,true);
  assert.equal(functionProtection.rows[0].owner,'reviewer_b_shadow_owner_v1');
  const schemaOwner=await observer.query(
    "SELECT nspowner::regrole::text AS owner FROM pg_catalog.pg_namespace WHERE nspname='reviewer_b_shadow'");
  assert.equal(schemaOwner.rows[0].owner,'reviewer_b_shadow_owner_v1');
  const relationOwners=await observer.query(
    "SELECT relname,relowner::regrole::text AS owner FROM pg_catalog.pg_class WHERE relnamespace='reviewer_b_shadow'::regnamespace AND relkind IN ('r','S')");
  assert.equal(relationOwners.rows.length,3);
  for(const row of relationOwners.rows)
    assert.equal(row.owner,'reviewer_b_shadow_owner_v1',row.relname);
  const definerConfig=await observer.query(
    "SELECT proconfig FROM pg_catalog.pg_proc WHERE oid='reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)'::regprocedure");
  assert.ok(definerConfig.rows[0].proconfig.some(v=>
    v==='search_path=pg_catalog, reviewer_b_shadow, pg_temp'));
  const ownerMembers=await observer.query(
    "SELECT count(*)::integer AS n FROM pg_catalog.pg_auth_members WHERE roleid='reviewer_b_shadow_owner_v1'::regrole");
  assert.equal(ownerMembers.rows[0].n,0);

  // The test identity can call the ONLY entrypoint but cannot read or
  // mutate underlying PostgreSQL tables or create objects in the schema.
  await observer.query(
    "CREATE ROLE reviewer_b_shadow_test_login LOGIN INHERIT PASSWORD 'synthetic-shadow-ci-only-20261020'");
  await observer.query(
    'GRANT reviewer_b_shadow_invoker_v1 TO reviewer_b_shadow_test_login');
  const roleClient=new Client({
    host:'127.0.0.1',port:5432,user:'reviewer_b_shadow_test_login',
    password:syntheticRolePassword,database:'postgres',
    connectionTimeoutMillis:2500,query_timeout:4000,
  });
  t.after(async()=>roleClient.end().catch(()=>{}));
  // Password authentication must actually be enforced by the ephemeral server.
  const badClient=new Client({
    host:'127.0.0.1',port:5432,user:'reviewer_b_shadow_test_login',
    password:'synthetic-shadow-wrong-password',database:'postgres',
    connectionTimeoutMillis:2500,query_timeout:4000,
  });
  t.after(async()=>badClient.end().catch(()=>{}));
  await assert.rejects(()=>badClient.connect(),err=>err.code==='28P01');
  await roleClient.connect();
  const identity=await roleClient.query(
    "SELECT session_user AS session_user, current_user AS current_user");
  assert.equal(identity.rows[0].session_user,'reviewer_b_shadow_test_login');
  assert.equal(identity.rows[0].current_user,'reviewer_b_shadow_test_login');
  const rolePerms=await roleClient.query(
    "SELECT has_table_privilege('reviewer_b_shadow.exposure_proposals','INSERT') AS can_insert, has_table_privilege('reviewer_b_shadow.monthly_periods','UPDATE') AS can_update, has_sequence_privilege('reviewer_b_shadow.exposure_proposals_id_seq','USAGE') AS can_use_seq, has_schema_privilege('reviewer_b_shadow','CREATE') AS can_create, has_function_privilege('reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)','EXECUTE') AS can_propose");
  assert.deepEqual(rolePerms.rows[0],{
    can_insert:false,can_update:false,can_use_seq:false,
    can_create:false,can_propose:true,
  });
  await assert.rejects(
    ()=>roleClient.query('SET ROLE reviewer_b_shadow_owner_v1'),
    err=>err.code==='42501');
  for(const maliciousSql of [
    'SELECT * FROM reviewer_b_shadow.exposure_proposals',
    'UPDATE reviewer_b_shadow.monthly_periods SET reserved_micro_eur=0',
    'DELETE FROM reviewer_b_shadow.exposure_proposals',
    'TRUNCATE reviewer_b_shadow.exposure_proposals',
    'INSERT INTO reviewer_b_shadow.exposure_proposals DEFAULT VALUES',
    'CREATE TABLE reviewer_b_shadow.unsafe_bypass (x integer)',
  ])await assert.rejects(()=>roleClient.query(maliciousSql),
    err=>err.code==='42501');

  // Synthetic privileged test reset only; a deployed ledger MUST NEVER
  // reset/delete billing history to make room for more paid requests.
  await observer.query('DELETE FROM reviewer_b_shadow.exposure_proposals');
  await observer.query(
    'UPDATE reviewer_b_shadow.monthly_periods SET reserved_micro_eur=0,proposal_count=0');
  const accepted=await call(roleClient,arg(77,1_000_000));
  assert.equal(accepted.rows[0].recorded,true);
  assert.equal(accepted.rows[0].may_spend,false);
  assert.equal((await counters(observer)).total,'1000000');
  assert.equal(await count(observer),1);
  const replay=await call(roleClient,arg(77,1_000_000));
  assert.equal(replay.rows[0].recorded,false);
  assert.equal(replay.rows[0].reason,'SHADOW_DUPLICATE_OR_AMBIGUOUS');
  const fill=await call(roleClient,arg(78,14_000_000));
  assert.equal(fill.rows[0].recorded,true);
  const denied=await call(roleClient,arg(79,1));
  assert.equal(denied.rows[0].recorded,false);
  assert.equal(denied.rows[0].reason,'SHADOW_EUR15_CEILING_EXCEEDED');
  assert.equal((await counters(observer)).total,'15000000');
  assert.equal((await counters(observer)).n,2);
});
