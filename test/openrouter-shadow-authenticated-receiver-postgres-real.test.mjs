// PostgreSQL 16 ephemeral test only. All logins/passwords are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const files=[
 'reviewer_b_shadow_central_pg_v1.sql',
 'reviewer_b_shadow_protected_roles_v1.sql',
 'reviewer_b_shadow_nonce_atomic_v1.sql',
 'reviewer_b_shadow_challenge_atomic_v1.sql',
 'reviewer_b_shadow_authenticated_receiver_v1.sql',
].map(n=>readFileSync(new URL('../sql/'+n,import.meta.url),'utf8'));
const password='synthetic-shadow-ci-only-20261020';
const repo='deenkids7-dev/deenkids';
const model='qwen/qwen3-coder-30b-a3b-instruct';
const uuid=i=>'11111111-2222-4333-8444-'+i.toString(16).padStart(12,'0');
const hash=i=>i.toString(16).padStart(64,'0');
const challenge=uuid(811);
const params=[
 repo,940,'a'.repeat(40),8111,model,'synthetic-only-receiver-811',
 15000000,uuid(812),hash(812),challenge,hash(813),
];
const oldFunction='reviewer_b_shadow.propose_exposure_with_challenge(text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)';
const receiverFunction='reviewer_b_shadow.propose_exposure_authenticated_receiver(text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)';
const invoke=(client)=>client.query(
 'SELECT * FROM reviewer_b_shadow.propose_exposure_authenticated_receiver($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',params);
const oldInvoke=client=>client.query(
 'SELECT * FROM reviewer_b_shadow.propose_exposure_with_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',params);
async function counters(db){
 const a=await db.query('SELECT reserved_micro_eur::text AS spent,proposal_count AS count FROM reviewer_b_shadow.monthly_periods');
 const b=await db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.consumed_shadow_proofs');
 const c=await db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.issued_shadow_challenges WHERE consumed_at IS NOT NULL');
 return {spent:a.rows[0].spent,count:a.rows[0].count,
   nonces:b.rows[0].n,challenges:c.rows[0].n};
}
test('postgres real: only authenticated receiver SESSION_USER may submit synthetic proposal',{
 skip:process.env.SHADOW_POSTGRES_REAL!=='1'||!process.env.SHADOW_PG_CLIENT_ENTRY
   ?'only on isolated Postgres 16 GitHub CI':false,
 timeout:60000,
},async t=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');
 assert.equal(process.env.PGPASSWORD,password);
 const pg=await import(pathToFileURL(process.env.SHADOW_PG_CLIENT_ENTRY).href);
 const Client=pg.default?.Client||pg.Client;
 const connect=(user='postgres')=>new Client({
   host:'127.0.0.1',port:5432,user,password,database:'postgres',
   connectionTimeoutMillis:2500,query_timeout:4000,
 });
 const admin=connect();
 const adversary=connect('synthetic_other_client');
 const receiver=connect('reviewer_b_shadow_receiver_v1');
 t.after(async()=>Promise.all([admin,adversary,receiver].map(x=>x.end().catch(()=>{}))));
 await admin.connect();
 for(const sql of files)await admin.query(sql);
 await admin.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
 const role=await admin.query(
  "SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb FROM pg_catalog.pg_roles WHERE rolname='reviewer_b_shadow_receiver_v1'");
 assert.deepEqual(role.rows[0],{
   rolcanlogin:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,
 });
 // Operator has not provisioned any production credential; login must fail.
 const deniedLogin=connect('reviewer_b_shadow_receiver_v1');
 await assert.rejects(()=>deniedLogin.connect(),e=>e.code==='28000'||e.code==='28P01');
 await deniedLogin.end().catch(()=>{});
 await admin.query("CREATE ROLE synthetic_other_client LOGIN INHERIT NOSUPERUSER PASSWORD 'synthetic-shadow-ci-only-20261020'");
 await admin.query('GRANT reviewer_b_shadow_invoker_v1 TO synthetic_other_client');
 await adversary.connect();

 const privileges=await adversary.query('SELECT '+
  'has_function_privilege($1::text,$3::text) AS old_route,'+
  'has_function_privilege($2::text,$3::text) AS guarded_route',
  [oldFunction,receiverFunction,'EXECUTE']);
 assert.deepEqual(privileges.rows[0],{
   old_route:false,guarded_route:false,
 });
 await assert.rejects(()=>oldInvoke(adversary),e=>e.code==='42501');
 await assert.rejects(()=>invoke(adversary),e=>e.code==='42501');
 await assert.rejects(()=>adversary.query(
   'SET SESSION AUTHORIZATION reviewer_b_shadow_receiver_v1'),
   e=>e.code==='42501');
 await assert.rejects(()=>adversary.query(
   'SET ROLE reviewer_b_shadow_receiver_v1'),
   e=>e.code==='42501');

 // Even a mistaken GRANT of receiver-role membership cannot impersonate
 // PostgreSQL's original authenticated SESSION_USER using SET ROLE.
 await admin.query('GRANT reviewer_b_shadow_receiver_v1 TO synthetic_other_client');
 await adversary.query('SET ROLE reviewer_b_shadow_receiver_v1');
 const identities=(await adversary.query(
  'SELECT session_user AS authenticated, current_user AS execution_role')).rows[0];
 assert.equal(identities.authenticated,'synthetic_other_client');
 assert.equal(identities.execution_role,'reviewer_b_shadow_receiver_v1');
 const rejected=(await invoke(adversary)).rows[0];
 assert.equal(rejected.recorded,false);
 assert.equal(rejected.reason,'SHADOW_RECEIVER_SESSION_IDENTITY_UNTRUSTED');
 assert.equal(rejected.may_spend,false);
 await adversary.query('RESET ROLE');
 assert.deepEqual(await counters(admin),{
   spent:'0',count:0,nonces:0,challenges:0,
 });

 // Only disposable CI superuser may change the NOLOGIN role to a LOGIN
 // principal. This is NOT performed in protected Publisher production.
 await admin.query("ALTER ROLE reviewer_b_shadow_receiver_v1 LOGIN PASSWORD 'synthetic-shadow-ci-only-20261020'");
 await receiver.connect();
 const live=(await receiver.query(
  'SELECT session_user AS authenticated, current_user AS execution_role')).rows[0];
 assert.equal(live.authenticated,'reviewer_b_shadow_receiver_v1');
 assert.equal(live.execution_role,'reviewer_b_shadow_receiver_v1');

 // Challenge issuance is privileged and NOT available to the receiver.
 await assert.rejects(()=>receiver.query(
  'INSERT INTO reviewer_b_shadow.issued_shadow_challenges DEFAULT VALUES'),
  e=>e.code==='42501');
 await assert.rejects(()=>oldInvoke(receiver),e=>e.code==='42501');
 const before=(await invoke(receiver)).rows[0];
 assert.equal(before.recorded,false);
 assert.equal(before.reason,'SHADOW_CHALLENGE_UNKNOWN');

 await admin.query(
  'INSERT INTO reviewer_b_shadow.issued_shadow_challenges('+
  'challenge_uuid,issuer,audience,month_utc,target_repo,pr_number,'+
  'head_sha,service_comment_id,model,upper_micro_eur,shadow_digest,'+
  'service_digest,issued_at,expires_at) VALUES('+
  "$1,'synthetic-service-account','shadow-postgres-processor',"+
  "date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date,"+
  "$2,$3,$4,$5,$6,15000000,$7,$8,"+
  "clock_timestamp(),clock_timestamp()+interval '45 seconds')",
  [challenge,repo,940,'a'.repeat(40),8111,model,hash(812),hash(813)]);
 await receiver.query('BEGIN');
 const pending=(await invoke(receiver)).rows[0];
 assert.equal(pending.recorded,true);
 assert.equal(pending.may_spend,false);
 assert.equal(pending.provider_billing_authenticated,false);
 assert.deepEqual(await counters(admin),{
   spent:'0',count:0,nonces:0,challenges:0,
 });
 await receiver.query('ROLLBACK');
 assert.deepEqual(await counters(admin),{
   spent:'0',count:0,nonces:0,challenges:0,
 });

 const accepted=(await invoke(receiver)).rows[0];
 assert.equal(accepted.recorded,true);
 assert.equal(accepted.may_spend,false);
 assert.equal(accepted.provider_billing_authenticated,false);
 const replay=(await invoke(receiver)).rows[0];
 assert.equal(replay.recorded,false);
 assert.equal(replay.reason,'SHADOW_CHALLENGE_ALREADY_CONSUMED');
 assert.deepEqual(await counters(admin),{
   spent:'15000000',count:1,nonces:1,challenges:1,
 });
});
test('static: no paid model, no private signing key or real service deployment',()=>{
 const migration=files[4];
 assert.match(migration,/NOLOGIN INHERIT NOSUPERUSER/);
 assert.match(migration,/session_user IS DISTINCT FROM/);
 assert.match(migration,/REVOKE EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure_with_challenge/);
 const real=readFileSync(new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
 const gate=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(real,/propose_exposure_authenticated_receiver/);
 assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
 assert.doesNotMatch(migration,/ALTER ROLE reviewer_b_shadow_receiver_v1 LOGIN/);
});
