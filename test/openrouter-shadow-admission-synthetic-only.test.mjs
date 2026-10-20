import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {runSyntheticShadowAdmissionOnly} from '../scripts/openrouter-shadow-admission-synthetic-only.mjs';

const PR=940,HEAD='a'.repeat(40);
const MODEL='qwen/qwen3-coder-30b-a3b-instruct';
const TOKEN='ghs_SYNTHETIC_TEST_TOKEN_NEVER_EXTERNAL_12345';
const REPO='deenkids7-dev/deenkids',COMMENT=727272;
const privateUrl='https://api.github.com/repos/'+REPO+'/pulls/'+PR;
const consentUrl='https://api.github.com/repos/'+REPO+
  '/issues/'+PR+'/comments?per_page=100&page=1';
const commandUrl='https://api.github.com/repos/devfactory-reviewer-trust/'+
  'devfactory-reviewer-b-publisher/issues/62/comments?per_page=100&page=1';
const sha=i=>i.toString(16).padStart(40,'0');
const month=()=>new Date().toISOString().slice(0,7);
const now=()=>Date.now();
function fixture({head=HEAD,owner='deenkids7-dev',service='devfactory-reviewer-service'}={}){
 const stamp=now()-60*60*1000;
 const pr={number:PR,state:'open',merged:false,draft:true,
   head:{sha:head,repo:{full_name:REPO,fork:false}},
   base:{ref:'master',repo:{full_name:REPO,fork:false}}};
 const consent=[{
   id:88001,user:{login:owner,id:297379913},
   created_at:new Date(stamp).toISOString(),
   body:'/devfactory-openrouter-consent '+PR+' '+HEAD+' '+MODEL+' '+month()+' budget15eur',
 }];
 const serviceComments=[{
   id:COMMENT,user:{login:service,id:340477389},
   body:'/review-b-openrouter '+PR+' '+HEAD+' '+MODEL,
 }];
 const payloads={[privateUrl]:pr,[consentUrl]:consent,[commandUrl]:serviceComments};
 const requests=[];
 const fetchImpl=async(url,opts)=>{
   requests.push({url,opts});
   assert.equal(opts.method,'GET');
   assert.equal(opts.redirect,'error');
   assert.ok(Object.hasOwn(payloads,url),'unexpected endpoint');
   return {status:200,redirected:false,url,
     headers:{get:key=>key==='content-type'?'application/json':null},
     text:async()=>JSON.stringify(payloads[url])};
 };
 return {fetchImpl,requests};
}
function options(fetchImpl,db,override={}){
 return {
   prNumber:PR,expectedHeadSha:HEAD,model:MODEL,
   requestCommentId:COMMENT,eventName:'issue_comment',runAttempt:'1',
   readToken:TOKEN,fetchImpl,db,...override,
 };
}
const sql=readFileSync(
 new URL('../sql/reviewer_b_shadow_central_pg_v1.sql',import.meta.url),'utf8');
const roles=readFileSync(
 new URL('../sql/reviewer_b_shadow_protected_roles_v1.sql',import.meta.url),'utf8');
function synthetic(testFn){
 return async()=>{
   const prev=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
   process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
   try{await testFn()}finally{
     if(prev===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
     else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prev;
   }
 };
}

test('runtime defaults to fail closed even when mocks claim full consent',async()=>{
 const fixture0=fixture(),queries=[];
 const db={query:async(...args)=>{queries.push(args);return{rows:[{recorded:true,may_spend:false,provider_billing_authenticated:false}]}}};
 const previous=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 try{
   const result=await runSyntheticShadowAdmissionOnly(options(fixture0.fetchImpl,db));
   assert.equal(result.ok,false);
   assert.equal(result.reason,'SHADOW_SYNTHETIC_TEST_SWITCH_REQUIRED');
   assert.equal(result.maySpend,false);
   assert.deepEqual(fixture0.requests,[]);
   assert.deepEqual(queries,[]);
 }finally{if(previous!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=previous}
});
test('caller-supplied shadow pricing, run ID or calendar month fails before GET and DB',synthetic(async()=>{
 for(const bad of [
   {estimatedCostEur:0.000001},{upperMicroEur:1},{providerBillUsd:0},
   {runId:'forged-run'},{month:'2030-01'},{now:0},{maySpend:true},
   {repository:'attacker/fork'},{headSha:'b'.repeat(40)},
   {claim:{upper_micro_eur:1}},
 ]){
   const f=fixture(),queries=[];
   const db={query:async(...args)=>{queries.push(args)}};
   const result=await runSyntheticShadowAdmissionOnly(options(f.fetchImpl,db,bad));
   assert.equal(result.ok,false,JSON.stringify(bad));
   assert.equal(result.reason,'SHADOW_UNTRUSTED_INPUT_OR_DB');
   assert.equal(f.requests.length,0);
   assert.equal(queries.length,0);
 }
}));
test('invalid GitHub facts deny BEFORE any call to PostgreSQL',synthetic(async()=>{
 for(const bad of [
  {head:'b'.repeat(40)}, {owner:'fake-owner'},
  {service:'attacker-service'},
 ]){
   const f=fixture(bad),queries=[];
   const db={query:async(...args)=>{queries.push(args)}};
   const result=await runSyntheticShadowAdmissionOnly(options(f.fetchImpl,db));
   assert.equal(result.ok,false);
   assert.equal(result.reason,'SHADOW_GITHUB_PROVENANCE_NOT_ESTABLISHED');
   assert.equal(queries.length,0);
 }
}));
test('real read-only GitHub mock proof creates ONLY a fixed 15 EUR synthetic plan',synthetic(async()=>{
 const f=fixture(),queries=[];
 const db={query:async(query,args)=>{
   queries.push({query,args});
   return {rows:[{recorded:true,may_spend:false,provider_billing_authenticated:false}]};
 }};
 const result=await runSyntheticShadowAdmissionOnly(options(f.fetchImpl,db));
 assert.equal(result.ok,true);
 assert.equal(result.recorded,true);
 for(const flag of ['maySpend','mayReserve','mayPublish','mayMerge',
   'providerBillingAuthenticated','estimatedEurAuthenticated'])
   assert.equal(result[flag],false);
 assert.ok(Object.isFrozen(result));
 assert.deepEqual(f.requests.map(x=>x.url),[privateUrl,consentUrl,commandUrl]);
 assert.equal(queries.length,1);
 assert.deepEqual(queries[0].args,[
   REPO,PR,HEAD,COMMENT,MODEL,'synthetic-'+COMMENT,15000000,
 ]);
 assert.ok(!JSON.stringify(result).includes(TOKEN));
}));
test('untrusted database response cannot create positive synthetic result',synthetic(async()=>{
 for(const row of [
   {recorded:true,may_spend:true,provider_billing_authenticated:false},
   {recorded:true,may_spend:false,provider_billing_authenticated:true},
   {recorded:'true',may_spend:false,provider_billing_authenticated:false},
   null,undefined,
 ]){
   const f=fixture();
   const db={query:async()=>({rows:[row]})};
   const r=await runSyntheticShadowAdmissionOnly(options(f.fetchImpl,db));
   assert.equal(r.ok,false);
   assert.equal(r.maySpend,false);
 }
}));
const pglitePath=process.env.SHADOW_PGLITE_ENTRY||'';
test('real PostgreSQL WASM integration: restricted-role proposal is not a spend permit',{
 skip:!pglitePath?'PGlite test dependency not installed in generic Publisher CI':false,
},synthetic(async()=>{
 const {PGlite}=await import(pathToFileURL(path.resolve(pglitePath)).href);
 const db=new PGlite();
 try{
  await db.exec(sql);
  await db.exec(roles);
  await db.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
  await db.exec('SET ROLE reviewer_b_shadow_invoker_v1');
  const f=fixture();
  const first=await runSyntheticShadowAdmissionOnly(options(f.fetchImpl,db));
  assert.equal(first.ok,true);
  assert.equal(first.recorded,true);
  assert.equal(first.maySpend,false);
  assert.equal(first.providerBillingAuthenticated,false);
  const again=await runSyntheticShadowAdmissionOnly(options(f.fetchImpl,db));
  assert.equal(again.ok,false);
  assert.equal(again.recorded,false);
  await db.exec('RESET ROLE');
  const s=await db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.exposure_proposals');
  assert.equal(s.rows[0].n,1);
  const total=await db.query('SELECT reserved_micro_eur::text AS total FROM reviewer_b_shadow.monthly_periods');
  assert.equal(total.rows[0].total,'15000000');
 }finally{await db.close()}
}));
test('paid entrypoint and real budget gate are not wired to synthetic admission',()=>{
 const a=readFileSync(new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
 const b=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
 for(const s of [a,b])assert.doesNotMatch(s,/openrouter-shadow-admission-synthetic-only/);
 assert.match(b,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
});
