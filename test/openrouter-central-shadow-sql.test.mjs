import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const sqlFile=fileURLToPath(new URL('../sql/reviewer_b_shadow_central_pg_v1.sql',import.meta.url));
const sql=readFileSync(sqlFile,'utf8');
const MODEL='qwen/qwen3-coder-30b-a3b-instruct';
const REPO='deenkids7-dev/deenkids';
const sha=i=>i.toString(16).padStart(40,'0');
const params=(i,upper=200000,comment=5000+i)=>[
 REPO,940+i,sha(i),comment,MODEL,'test-run-'+i,upper,
];
const query=async (db,p)=>db.query(
  'SELECT * FROM reviewer_b_shadow.propose_exposure($1,$2,$3,$4,$5,$6,$7)',p);

test('central shadow SQL never enables a paid model or modifies Publisher workflows',()=>{
 assert.match(sql,/FOR UPDATE NOWAIT/);
 assert.match(sql,/SECURITY INVOKER/);
 assert.match(sql,/REVOKE ALL ON FUNCTION/);
 assert.match(sql,/UNIQUE \(target_repo,pr_number,head_sha\)/);
 assert.match(sql,/UNIQUE \(service_comment_id\)/);
 assert.doesNotMatch(sql,/CREATE EXTENSION|http_post|net\.http|OPENROUTER_API_KEY|runpod/);
 const paidGate=readFileSync(fileURLToPath(
   new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url)),'utf8');
 const paidEntrypoint=readFileSync(fileURLToPath(
   new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url)),'utf8');
 assert.match(paidGate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
 assert.doesNotMatch(paidGate,/reviewer_b_shadow|propose_exposure/);
 assert.doesNotMatch(paidEntrypoint,/reviewer_b_shadow|propose_exposure/);
});

const pglitePath=process.env.SHADOW_PGLITE_ENTRY||'';
test('real PostgreSQL WASM: strict cross-claim idempotency and 15 EUR budget', {
 skip:pglitePath===''?'PGlite not provisioned in baseline zero-dependency CI':false,
}, async t=>{
 const {PGlite}=await import(pathToFileURL(path.resolve(pglitePath)).href);
 const db=new PGlite();
 t.after(async()=>{await db.close()});
 await db.exec(sql);
 const utcMonth=await db.query(
   "SELECT date_trunc('month', transaction_timestamp() AT TIME ZONE 'UTC')::date AS month");
 assert.ok(utcMonth.rows[0].month);
 const notProvisioned=await query(db,params(1));
 assert.equal(notProvisioned.rows[0].recorded,false);
 assert.equal(notProvisioned.rows[0].reason,'SHADOW_MONTH_NOT_PROVISIONED');
 await db.query('INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES ($1)',
   [utcMonth.rows[0].month]);
 const first=await query(db,params(1,3000000));
 assert.equal(first.rows[0].recorded,true);
 assert.equal(first.rows[0].may_spend,false);
 assert.equal(first.rows[0].provider_billing_authenticated,false);
 assert.equal(Number(first.rows[0].reserved_micro_eur),3000000);
 const retry=await query(db,params(1,1,8000));
 assert.equal(retry.rows[0].recorded,false);
 assert.equal(retry.rows[0].reason,'SHADOW_DUPLICATE_OR_AMBIGUOUS');
 const reusedComment=await query(db,params(2,1000,5001));
 assert.equal(reusedComment.rows[0].recorded,false);
 assert.equal(reusedComment.rows[0].reason,'SHADOW_DUPLICATE_OR_AMBIGUOUS');
 const second=await query(db,params(2,12000000));
 assert.equal(second.rows[0].recorded,true);
 const exceeded=await query(db,params(3,1));
 assert.equal(exceeded.rows[0].recorded,false);
 assert.equal(exceeded.rows[0].reason,'SHADOW_EUR15_CEILING_EXCEEDED');
 for(const invalid of [
  [...params(4),].map((v,i)=>i===2?'bad-sha':v),
  [...params(4),].map((v,i)=>i===4?'untrusted/model':v),
  [...params(4),].map((v,i)=>i===6?-1:v),
  [...params(4),].map((v,i)=>i===0?'other/repo':v),
 ]){
  const v=await query(db,invalid);
  assert.equal(v.rows[0].recorded,false);
  assert.equal(v.rows[0].may_spend,false);
 }
 const count=await db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.exposure_proposals');
 assert.equal(count.rows[0].n,2);
 const publicGrant=await db.query(
  "SELECT count(*)::int AS n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE n.nspname='reviewer_b_shadow' AND p.proname='propose_exposure' AND a.grantee=0 AND a.privilege_type='EXECUTE'");
 assert.equal(publicGrant.rows[0].n,0);
 const period=await db.query('SELECT reserved_micro_eur,proposal_count FROM reviewer_b_shadow.monthly_periods');
 assert.equal(Number(period.rows[0].reserved_micro_eur),15000000);
 assert.equal(period.rows[0].proposal_count,2);
});

test('real PostgreSQL WASM: the 501st record is rejected before mutation',{
 skip:pglitePath===''?'PGlite not provisioned in baseline CI':false,
},async t=>{
 const {PGlite}=await import(pathToFileURL(path.resolve(pglitePath)).href);
 const db=new PGlite();t.after(async()=>{await db.close()});
 await db.exec(sql);
 await db.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES (date_trunc('month',transaction_timestamp() AT TIME ZONE 'UTC')::date)");
 for(let i=1;i<=500;i++){
  const p=params(10000+i,1,80000+i);
  const q=await query(db,p);
  assert.equal(q.rows[0].recorded,true,'record '+i);
 }
 const denied=await query(db,params(11000,1,99999));
 assert.equal(denied.rows[0].recorded,false);
 assert.equal(denied.rows[0].reason,'SHADOW_MONTHLY_RECORD_LIMIT');
 assert.equal(denied.rows[0].may_spend,false);
 const count=await db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.exposure_proposals');
 assert.equal(count.rows[0].n,500);
});
test('real PostgreSQL WASM: unique exact HEAD persists across periods',{
 skip:pglitePath===''?'PGlite not provisioned in baseline CI':false,
},async t=>{
 const {PGlite}=await import(pathToFileURL(path.resolve(pglitePath)).href);
 const db=new PGlite();t.after(async()=>{await db.close()});
 await db.exec(sql);
 await db.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES (date_trunc('month',transaction_timestamp() AT TIME ZONE 'UTC')::date)");
 const first=await query(db,params(50));
 assert.equal(first.rows[0].recorded,true);
 const wrongMonth=await db.query("SELECT to_char((date_trunc('month',transaction_timestamp() AT TIME ZONE 'UTC')+interval '1 month')::date,'YYYY-MM-DD') AS next_month");
 await db.query('INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES ($1)',[wrongMonth.rows[0].next_month]);
 const directInsert=`INSERT INTO reviewer_b_shadow.exposure_proposals
 (month_utc,target_repo,pr_number,head_sha,service_comment_id,model,run_id,upper_micro_eur)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
 await assert.rejects(()=>db.query(directInsert,[
  wrongMonth.rows[0].next_month,REPO,990,sha(50),77777,MODEL,'later-run',1,
 ]),/unique|duplicate/i);
 const count=await db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.exposure_proposals');
 assert.equal(count.rows[0].n,1);
});

test('PostgreSQL WASM: reject stale Repeatable Read and Serializable contexts',{
 skip:pglitePath===''?'PGlite not provisioned in baseline CI':false,
},async t=>{
 const {PGlite}=await import(pathToFileURL(path.resolve(pglitePath)).href);
 const db=new PGlite();t.after(async()=>{await db.close()});
 await db.exec(sql);
 await db.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
 for(const isolation of ['REPEATABLE READ','SERIALIZABLE']){
  await db.exec('BEGIN ISOLATION LEVEL '+isolation);
  try{
   const r=await query(db,params(777,100000));
   assert.equal(r.rows[0].recorded,false);
   assert.equal(r.rows[0].may_spend,false);
   assert.equal(r.rows[0].reason,'SHADOW_ISOLATION_UNSUPPORTED');
  }finally{await db.exec('ROLLBACK')}
 }
 const counter=await db.query('SELECT proposal_count,reserved_micro_eur FROM reviewer_b_shadow.monthly_periods');
 assert.equal(counter.rows[0].proposal_count,0);
 assert.equal(Number(counter.rows[0].reserved_micro_eur),0);
});

test('PGlite: hardened owner policy rejects pre-existing named and column grants',{
 skip:pglitePath===''?'PGlite not provisioned in baseline zero-dependency CI':false,
},async()=>{
 const {PGlite}=await import(pathToFileURL(path.resolve(pglitePath)).href);
 const rolesSql=readFileSync(new URL('../sql/reviewer_b_shadow_protected_roles_v1.sql',import.meta.url),'utf8');
 for(const unsafeGrant of [
  'GRANT UPDATE ON reviewer_b_shadow.monthly_periods TO shadow_attacker',
  'GRANT UPDATE(ceiling_micro_eur) ON reviewer_b_shadow.monthly_periods TO shadow_attacker',
  'GRANT CREATE ON SCHEMA reviewer_b_shadow TO shadow_attacker',
  'GRANT USAGE ON SEQUENCE reviewer_b_shadow.exposure_proposals_id_seq TO shadow_attacker',
  'GRANT EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint) TO shadow_attacker',
 ]){
  const db=new PGlite();
  try{
   await db.exec(sql);
   await db.exec('CREATE ROLE shadow_attacker NOLOGIN');
   await db.exec(unsafeGrant);
   await assert.rejects(()=>db.exec(rolesSql),/SHADOW_EXISTING_PRIVILEGES_NOT_TRUSTED/);
   await db.exec('ROLLBACK');
   const result=await db.query(
    "SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)'::regprocedure");
   assert.equal(result.rows[0].prosecdef,false);
  }finally{await db.close()}
 }
});
test('PGlite: hardened no-login definer accepts synthetic low-priv proposal',{
 skip:pglitePath===''?'PGlite not provisioned in baseline zero-dependency CI':false,
},async t=>{
 const {PGlite}=await import(pathToFileURL(path.resolve(pglitePath)).href);
 const db=new PGlite();
 t.after(async()=>db.close());
 await db.exec(sql);
 await db.exec(readFileSync(new URL('../sql/reviewer_b_shadow_protected_roles_v1.sql',import.meta.url),'utf8'));
 const role=await db.query(
  "SELECT p.prosecdef,p.proowner::regrole::text AS owner,has_function_privilege('reviewer_b_shadow_invoker_v1','reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)','EXECUTE') AS can_call,has_table_privilege('reviewer_b_shadow_invoker_v1','reviewer_b_shadow.monthly_periods','UPDATE') AS can_update FROM pg_catalog.pg_proc p WHERE p.oid='reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)'::regprocedure");
 assert.deepEqual(role.rows[0],{
  prosecdef:true,owner:'reviewer_b_shadow_owner_v1',
  can_call:true,can_update:false,
 });
 await db.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
 await db.exec('SET ROLE reviewer_b_shadow_invoker_v1');
 try{
  const output=await query(db,params(9001,1000000));
  assert.equal(output.rows[0].recorded,true);
  assert.equal(output.rows[0].may_spend,false);
  await assert.rejects(
   ()=>db.query('SELECT * FROM reviewer_b_shadow.exposure_proposals'),
   /permission denied/i);
 }finally{await db.exec('RESET ROLE')}
});
