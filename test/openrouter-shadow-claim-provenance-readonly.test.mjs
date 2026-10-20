import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {
  assessExactPrivateGitHubHead,fetchAndAssessShadowClaimProvenance,
} from '../scripts/openrouter-shadow-claim-provenance-readonly.mjs';

const PR=940,HEAD='a'.repeat(40);
const MODEL='qwen/qwen3-coder-30b-a3b-instruct';
const TOK='ghs_SYNTHETIC_READ_ONLY_TOKEN_123456789';
const NOW=Date.UTC(2026,9,20,10,0,0);
const COMMENT='/review-b-openrouter '+PR+' '+HEAD+' '+MODEL;
const CONSENT='/devfactory-openrouter-consent '+PR+' '+HEAD+' '+MODEL+' 2026-10 budget15eur';
const api='https://api.github.com/repos/deenkids7-dev/deenkids/pulls/940';
const ownerApi='https://api.github.com/repos/deenkids7-dev/deenkids/issues/940/comments?per_page=100&page=1';
const serviceApi='https://api.github.com/repos/devfactory-reviewer-trust/devfactory-reviewer-b-publisher/issues/62/comments?per_page=100&page=1';
const pr=()=>({
 number:940,state:'open',merged:false,draft:true,
 head:{sha:HEAD,repo:{full_name:'deenkids7-dev/deenkids',fork:false}},
 base:{ref:'master',repo:{full_name:'deenkids7-dev/deenkids',fork:false}},
});
const owner=()=>[{
 id:90909,body:CONSENT,created_at:new Date(NOW-60*60*1000).toISOString(),
 user:{login:'deenkids7-dev',id:297379913},
}];
const service=()=>[{
 id:71717,body:COMMENT,
 user:{login:'devfactory-reviewer-service',id:340477389},
}];
const args={
 prNumber:PR,expectedHeadSha:HEAD,model:MODEL,requestCommentId:71717,
 runAttempt:'1',eventName:'issue_comment',readToken:TOK,now:NOW,
};
function mock({prPayload=pr(),ownerItems=owner(),serviceItems=service(),
 override={},onRequest=()=>{}}={}){
 const requests=[];
 const fetchImpl=async(url,opts)=>{
   requests.push({url,opts});
   onRequest(url,opts);
   const map={[api]:prPayload,[ownerApi]:ownerItems,[serviceApi]:serviceItems};
   assert.ok(Object.hasOwn(map,url),'unexpected GitHub endpoint '+url);
   assert.equal(opts.method,'GET');
   assert.equal(opts.redirect,'error');
   assert.equal(opts.cache,'no-store');
   const isPrivate=url!==serviceApi;
   if(isPrivate)assert.equal(opts.headers.Authorization,'Bearer '+TOK);
   else assert.equal(opts.headers.Authorization,undefined);
   return {status:override.status??200,
     redirected:override.redirected??false,
     url:override.url??url,
     headers:{get:key=>key==='content-type'?
       (override.contentType??'application/json'):
       key==='content-length'?override.contentLength??null:
       key==='link'?null:null},
     text:async()=>override.body??JSON.stringify(map[url]),
   };
 };
 return {fetchImpl,requests};
}
test('private PR HEAD comparison rejects closed, merged, forks and wrong base',()=>{
 const accepted=assessExactPrivateGitHubHead({payload:pr(),prNumber:PR,expectedHeadSha:HEAD});
 assert.equal(accepted.ok,true);
 assert.equal(accepted.maySpend,false);
 for(const variant of [
  {number:939},{state:'closed'},{merged:true},{draft:null},
  {head:{...pr().head,sha:'b'.repeat(40)}},
  {head:{...pr().head,repo:{full_name:'attacker/fork',fork:true}}},
  {head:{...pr().head,repo:{full_name:'deenkids7-dev/deenkids',fork:true}}},
  {base:{...pr().base,repo:{full_name:'attacker/repo',fork:true}}},
  {base:{...pr().base,repo:{full_name:'deenkids7-dev/deenkids',fork:true}}},
  {base:{...pr().base,ref:'evil'}},
 ]){
  const result=assessExactPrivateGitHubHead({
   payload:{...pr(),...variant},prNumber:PR,expectedHeadSha:HEAD});
  assert.equal(result.ok,false);
  assert.equal(result.mayReserve,false);
 }
});
test('three GitHub evidence checks complete without any spend or DB request',async()=>{
 const m=mock();
 const verified=await fetchAndAssessShadowClaimProvenance({...args,fetchImpl:m.fetchImpl});
 assert.equal(verified.ok,true);
 assert.equal(verified.prNumber,PR);
 assert.equal(verified.headSha,HEAD);
 assert.equal(verified.model,MODEL);
 assert.equal(verified.serviceCommentId,71717);
 assert.equal(verified.ownerConsentCommentId,90909);
 assert.equal(verified.evidenceMonthUtc,'2026-10');
 for(const flag of ['mayReserve','maySpend','mayPublish','mayMerge',
   'providerBillingAuthenticated','estimatedEurAuthenticated',
   'independentReviewVerified'])assert.equal(verified[flag],false,flag);
 assert.deepEqual(m.requests.map(x=>x.url),[api,ownerApi,serviceApi]);
 assert.ok(Object.isFrozen(verified));
 assert.equal(JSON.stringify(verified).includes(TOK),false);
});
test('invalid workflow event, rerun, model and malformed SHA abort without GET',async()=>{
 for(const patch of [
  {eventName:'workflow_dispatch'},{eventName:'pull_request'},
  {runAttempt:'2'},{model:'unknown/provider'},
  {expectedHeadSha:'ABC'},{readToken:'short'},
  {requestCommentId:0},{prNumber:0},
 ]){
  const m=mock();
  await assert.rejects(
   ()=>fetchAndAssessShadowClaimProvenance({...args,...patch,fetchImpl:m.fetchImpl}),
   /SHADOW_CLAIM_INPUT_UNTRUSTED/);
  assert.equal(m.requests.length,0);
 }
});
test('fail HEAD-scoped attack before fetching consent or service commands',async()=>{
 for(const v of [
  {head:{sha:'b'.repeat(40),repo:pr().head.repo}},
  {head:{sha:HEAD,repo:{full_name:'fake/fork',fork:true}}},
  {head:{sha:HEAD,repo:{full_name:'deenkids7-dev/deenkids',fork:true}}},
  {state:'closed'},{merged:true},{base:{ref:'test',repo:pr().base.repo}},
 ]){
  const m=mock({prPayload:{...pr(),...v}});
  await assert.rejects(
   ()=>fetchAndAssessShadowClaimProvenance({...args,fetchImpl:m.fetchImpl}),
   /SHADOW_PRIVATE_HEAD_NOT_VERIFIED/);
  assert.deepEqual(m.requests.map(x=>x.url),[api]);
 }
});
test('fail owner consent or service request provenance before release',async()=>{
 for(const changes of [
  {ownerItems:[]},
  {ownerItems:[owner()[0],{...owner()[0],id:90910}]},
  {ownerItems:[{...owner()[0],user:{login:'forger',id:297379913}}]},
  {ownerItems:[{...owner()[0],created_at:'2026-10-19T12:00:00Z'}]},
  {serviceItems:[]},
  {serviceItems:[{...service()[0],user:{login:'fraud',id:340477389}}]},
  {serviceItems:[service()[0],{...service()[0],id:71718}]},
 ]){
  const m=mock(changes);
  await assert.rejects(()=>fetchAndAssessShadowClaimProvenance({
   ...args,fetchImpl:m.fetchImpl
  }),/SHADOW_(?:OWNER_CONSENT|UNIQUE_SERVICE_REQUEST)_UNVERIFIED/);
  assert.ok(m.requests.length===2||m.requests.length===3);
 }
});
test('wrong endpoint, content type, oversized content and unreadable JSON deny',async()=>{
 for(const override of [
  {status:403},{redirected:true},{url:'https://bad.invalid/path'},
  {contentType:'text/html'},{contentLength:'9999999'},
  {body:'invalid-json'},{body:'x'.repeat(129*1024)},
 ]){
  const m=mock({override});
  await assert.rejects(()=>fetchAndAssessShadowClaimProvenance({
   ...args,fetchImpl:m.fetchImpl
  }),/SHADOW_PRIVATE_HEAD_(?:RESPONSE_UNTRUSTED|CONTENT_UNVERIFIED)/);
  assert.equal(m.requests.length,1);
 }
});
test('real streaming PR body exceeding byte ceiling cancels before reading all chunks',async()=>{
 let cancelled=false,readCount=0;
 const stream=new ReadableStream({
  pull(controller){
   readCount++;
   controller.enqueue(new Uint8Array(32768));
   if(readCount===40)controller.close();
  },
  cancel(){cancelled=true},
 });
 const m=mock();
 const fetchImpl=async(url,opts)=>{
   if(url!==api)return m.fetchImpl(url,opts);
   return {status:200,redirected:false,url,
    headers:{get:key=>key==='content-type'?'application/json':null},
    body:stream,
   };
 };
 await assert.rejects(()=>fetchAndAssessShadowClaimProvenance({
  ...args,fetchImpl}),/SHADOW_PRIVATE_HEAD_CONTENT_UNVERIFIED/);
 assert.equal(cancelled,true);
 assert.ok(readCount<40);
});
test('paid Publisher entrypoint still consumes only locked spend gate, not this module',()=>{
 const root=new URL('../',import.meta.url);
 const entry=readFileSync(new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
 const gate=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(entry,/openrouter-shadow-claim-provenance-readonly/);
 assert.doesNotMatch(gate,/openrouter-shadow-claim-provenance-readonly/);
 assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
 assert.match(entry,/budget\.verified!==true\|\|budget\.maySpend!==true/);
});
