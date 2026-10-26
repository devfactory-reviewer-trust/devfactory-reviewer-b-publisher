import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {inspect} from 'node:util';
import {prepareBoundedSemanticReview} from '../candidate/semantic-review-request.mjs';
import {OPENROUTER_MODEL_IDS,prepareOpenRouterBoundedRequest,
 assessOpenRouterMonthlyKey,assessOpenRouterModelZdr,
 preflightOpenRouterKey,executeOpenRouterShard as rawExecuteOpenRouterShard}
 from '../scripts/openrouter-zdr-executor.mjs';
import {executeCompleteOpenRouterSemanticReview as rawCompleteReview}
 from '../scripts/openrouter-semantic-full-review.mjs';
import {reserveIndependentFinancialShard,makeFinancialReservationReceiptBytes}
 from '../scripts/openrouter-independent-financial-reservation.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const URL='https://openrouter.ai/api/v1/chat/completions';
const KEY='https://openrouter.ai/api/v1/key';
const ZDR='https://openrouter.ai/api/v1/models?zdr=true';
const RUN='gh-38715430667-1';
const INPUT=Buffer.from('diff --git a/src/a.mjs b/src/a.mjs\n'+
 'index 1111111..2222222 100644\n--- a/src/a.mjs\n+++ b/src/a.mjs\n'+
 '@@ -1,2 +1,2 @@\n const x = 1;\n-return false;\n+return true;\n');
function makePlan(bytes=INPUT){
 return prepareBoundedSemanticReview({snapshot:{
  repository:'deenkids7-dev/deenkids',repository_id:1282086207,pr_number:932,
  head_sha:'a'.repeat(40),base_sha:'b'.repeat(40),
  diff_sha256:hash(bytes)},rawDiffBytes:bytes});
}
const K='sk-or-abc_123_456_789_abcdefghijklmno';
const signer=generateKeyPairSync('ed25519');
const publicPem=signer.publicKey.export({format:'pem',type:'spki'});
const financialConfig={endpoint:'https://trusted-finance.example.org/v1/financial-reservations/openrouter-reviewer-b',
 trustedSignerPublicKeyPem:publicPem,
 trustedSignerFingerprintSha256:hash(signer.publicKey.export({format:'der',type:'spki'})),
 authorizationToken:'t'.repeat(64)};
function fakeFinancialAuthority({mutateReceipt=null,throwOnReserve=false,
 corruptSignature=false}={}){
 const requests=[];
 const fetchImpl=async(url,options)=>{
  requests.push({url,options});
  assert.equal(url,financialConfig.endpoint);
  assert.equal(options.method,'POST');
  assert.equal(options.headers.Authorization,'Bearer '+financialConfig.authorizationToken);
  if(throwOnReserve)throw Error('DISCONNECTED');
  const req=JSON.parse(options.body);
  const receipt={...req,status:'RESERVED_POSSIBLY_BILLED_NO_AUTO_REFUND',
   reservationId:'res-'+String(requests.length).padStart(32,'a'),
   expiresAtMs:Date.now()+30_000};
  if(mutateReceipt)mutateReceipt(receipt);
  receipt.signature=sign(null,makeFinancialReservationReceiptBytes(receipt),signer.privateKey)
   .toString('base64');
  if(corruptSignature)receipt.upperMicroUsd+=1;
  return reply(url,receipt);
 };
 return {fetchImpl,requests,config:financialConfig};
}
async function executeOpenRouterShard(args){
 if(args.approvedThirdPartyPrivateEgress===true&&
    args.authenticatedGlobalBudgetVerified===true&&
    !Object.hasOwn(args,'financialReservation')){
  const model=args.model??OPENROUTER_MODEL_IDS[0];
  const envelope=prepareOpenRouterBoundedRequest({plan:args.plan,model,
   maxOutputTokens:args.maxOutputTokens??1024,
   trustedDeclarationIndex:args.trustedDeclarationIndex??null,
   trustedOriginalDiffSha256:args.trustedOriginalDiffSha256??null});
  const fixture=fakeFinancialAuthority();
  const financialReservation=await reserveIndependentFinancialShard({
   config:fixture.config,fetchImpl:fixture.fetchImpl,
   context:{prNumber:args.plan.exactScope.prNumber,
    headSha:args.plan.exactScope.headSha,runId:args.runId,
    shardIndex:args.shardIndex??0,model,
    requestSha256:hash(envelope.privateRequestJson),
    upperMicroUsd:Math.ceil(envelope.estimateWorstShardUsd*1_000_000)}
  });
  return rawExecuteOpenRouterShard({...args,financialReservation});
 }
 return rawExecuteOpenRouterShard(args);
}
async function executeCompleteOpenRouterSemanticReview(args){
 const fixture=fakeFinancialAuthority();
 return rawCompleteReview({...args,
  financialAuthority:fixture.config,financialFetchImpl:fixture.fetchImpl});
}
const keyInfo=(overrides={})=>({data:{
 limit:1,limit_reset:'monthly',limit_remaining:0.95,
 usage_monthly:0.05,include_byok_in_limit:false,...overrides}});
const catalog=(overrides={})=>({data:[
 {id:OPENROUTER_MODEL_IDS[0],pricing:{prompt:'0.00000007',completion:'0.00000028'},
  supported_parameters:['structured_outputs'],...overrides},
 {id:OPENROUTER_MODEL_IDS[1],pricing:{prompt:'0.00000015',completion:'0.000001'},
  supported_parameters:['structured_outputs']}]});
function reply(url,body,status=200,contentType='application/json'){
 return {url,status,redirected:false,headers:new Headers({'content-type':contentType}),
  body:new Response(JSON.stringify(body)).body};
}
function mockedNetwork({changedBody,failAt=0,refusal,modelOverride,
 keyOverrides={},keySequence=null,catalogOverrides={},cacheHit=false}={}){
 const requests=[];
 const fetchImpl=async(url,options)=>{
  requests.push({url,method:options.method,body:options.body,headers:options.headers});
  if(url===KEY)return reply(url,keyInfo(keySequence?.shift()??keyOverrides));
  if(url===ZDR)return reply(url,catalog(catalogOverrides));
  assert.equal(url,URL);
  assert.equal(options.method,'POST');
  assert.equal(options.headers['X-OpenRouter-Cache'],'false');
  const sent=JSON.parse(options.body);
  assert.equal(sent.provider.zdr,true);
  assert.equal(sent.provider.data_collection,'deny');
  assert.equal(sent.provider.allow_fallbacks,false);
  assert.equal(sent.provider.require_parameters,true);
  assert.equal(sent.stream,false);
  assert.equal(sent.response_format.json_schema.strict,true);
  assert.equal(sent.max_tokens,1024);
  if(failAt>0&&requests.filter(x=>x.url===URL).length===failAt)
   throw Error('MOCK_TIMEOUT');
  const response=reply(url,changedBody??{
   model:modelOverride??sent.model,
   choices:[{finish_reason:'stop',message:{role:'assistant',
    ...(refusal!==undefined?{refusal}:{}) ,
    content:JSON.stringify({summary:'No specific synthetic defect',findings:[]})}}],
   usage:{prompt_tokens:900,completion_tokens:70,cost:0.00027}
  });
  if(cacheHit)response.headers.set('x-openrouter-cache-status','HIT');
  return response;
 };
 return {fetchImpl,requests,postCount:()=>requests.filter(x=>x.url===URL).length};
}
test('two exact Qwen models, not openrouter/auto',()=>{
 assert.equal(OPENROUTER_MODEL_IDS.length,2);
 assert.throws(()=>prepareOpenRouterBoundedRequest({plan:makePlan(),model:'openrouter/auto'}),/NOT_ALLOWLISTED/);
});
test('private plans and API payloads redact under stringify and inspect',()=>{
 const q=prepareOpenRouterBoundedRequest({plan:makePlan()});
 assert.equal(q.localModelExecuted,false);
 assert.equal(q.modelOrigin,'OPENROUTER_THIRD_PARTY_ZDR');
 assert.doesNotMatch(JSON.stringify(q),/return true/);
 assert.doesNotMatch(inspect(q),/return true/);
 assert.match(q.privateRequestJson,/return true/);
});
test('provider object cannot silently allow fallback or training',()=>{
 const req=JSON.parse(prepareOpenRouterBoundedRequest({plan:makePlan()}).privateRequestJson);
 assert.deepEqual(Object.keys(req.provider).sort(),[
  'allow_fallbacks','data_collection','max_price','require_parameters','sort','zdr'].sort());
 assert.equal(req.provider.zdr,true);
 assert.equal(req.provider.data_collection,'deny');
 assert.equal(req.provider.max_price.completion,0.40);
 assert.equal(req.tools,undefined);
 assert.equal(req.plugins,undefined);
});
test('invalid tiny and oversized output budgets denied',()=>{
 for(const n of [10,0,9999,1.1])
  assert.throws(()=>prepareOpenRouterBoundedRequest({plan:makePlan(),maxOutputTokens:n}));
});
test('month cap validated but BYOK toggle false is not relevant for no BYOK requests',()=>{
 assert.equal(assessOpenRouterMonthlyKey(keyInfo()).ok,true);
});
test('wrong reset, unlimited and exhausted keys are rejected',()=>{
 for(const changes of [{limit_reset:'daily'},{limit:null},
  {limit:3.5},{limit_remaining:0.01},{limit_remaining:-1},{usage_monthly:-2}])
  assert.equal(assessOpenRouterMonthlyKey(keyInfo(changes)).ok,false);
});
test('ZDR public catalogue strict price and structured-output capability',()=>{
 assert.equal(assessOpenRouterModelZdr(catalog(),OPENROUTER_MODEL_IDS[0]).ok,true);
 assert.equal(assessOpenRouterModelZdr(catalog({supported_parameters:[]}),OPENROUTER_MODEL_IDS[0]).ok,false);
 assert.equal(assessOpenRouterModelZdr(catalog({pricing:{prompt:'2',completion:'2'}}),OPENROUTER_MODEL_IDS[0]).ok,false);
});
test('preflight only anonymous public and read-only key; zero private code',async()=>{
 const net=mockedNetwork();
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 assert.equal(p.ok,true);
 assert.equal(p.remainingUsd,0.95);
 assert.equal(net.postCount(),0);
 assert.equal(net.requests[0].url,KEY);
 assert.equal(net.requests[1].url,ZDR);
 assert.equal(net.requests[1].headers.Authorization,undefined);
});
test('preflight fail closed on insufficient key limit',async()=>{
 const net=mockedNetwork({keyOverrides:{limit_remaining:0.001}});
 await assert.rejects(()=>preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl}),/BUDGET/);
 assert.equal(net.postCount(),0);
});
test('no private egress authorization => zero paid POST',async()=>{
 const net=mockedNetwork();
 await assert.rejects(()=>executeOpenRouterShard({
  plan:makePlan(),trustedDiffBytes:INPUT,runId:RUN,
  apiKey:K,preflight:{ok:true,model:OPENROUTER_MODEL_IDS[0],
   remainingUsd:1,monthlyLimitUsd:1,expiresAfterMs:120000},
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl
 }),/OR_PRIVATE_EGRESS_NOT_AUTHORIZED/);
 assert.equal(net.postCount(),0);
});
test('no global budget proof => zero paid POST',async()=>{
 const net=mockedNetwork();
 await assert.rejects(()=>executeOpenRouterShard({
  plan:makePlan(),trustedDiffBytes:INPUT,runId:RUN,apiKey:K,
  preflight:{ok:true,model:OPENROUTER_MODEL_IDS[0],remainingUsd:1,
   monthlyLimitUsd:1,expiresAfterMs:120000},
  approvedThirdPartyPrivateEgress:true,fetchImpl:net.fetchImpl
 }),/OR_GLOBAL_BUDGET_NOT_VERIFIED/);
 assert.equal(net.postCount(),0);
});
test('owner consent and key preflight alone cannot authorize a billable POST',async()=>{
 const net=mockedNetwork();
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 await assert.rejects(()=>rawExecuteOpenRouterShard({
  plan:makePlan(),trustedDiffBytes:INPUT,runId:RUN,apiKey:K,preflight:p,
  approvedThirdPartyPrivateEgress:true,authenticatedGlobalBudgetVerified:true,
  fetchImpl:net.fetchImpl
 }),/OR_FINANCIAL_RESERVATION_REQUIRED/);
 assert.equal(net.postCount(),0);
});

test('forged financial reservation object never authorizes a paid POST',async()=>{
 const net=mockedNetwork();
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 await assert.rejects(()=>rawExecuteOpenRouterShard({
  plan:makePlan(),trustedDiffBytes:INPUT,runId:RUN,apiKey:K,preflight:p,
  approvedThirdPartyPrivateEgress:true,authenticatedGlobalBudgetVerified:true,
  financialReservation:{ok:true,maySpend:true,status:'RESERVED'},
  fetchImpl:net.fetchImpl
 }),/OR_FINANCIAL_RESERVATION_REQUIRED/);
 assert.equal(net.postCount(),0);
});

test('independent broker unavailable => zero provider POST',async()=>{
 const net=mockedNetwork();
 const fixture=fakeFinancialAuthority({throwOnReserve:true});
 await assert.rejects(()=>rawCompleteReview({
  plan:makePlan(),runId:RUN,apiKey:K,
  approvedThirdPartyPrivateEgress:true,authenticatedGlobalBudgetVerified:true,
  fetchImpl:net.fetchImpl,financialAuthority:fixture.config,
  financialFetchImpl:fixture.fetchImpl
 }),/OR_FINANCIAL_RESERVATION_UNCERTAIN_NO_RETRY/);
 assert.equal(net.postCount(),0);
 assert.equal(fixture.requests.length,1);
});

test('signed reservation cannot be transferred to a different run',async()=>{
 const net=mockedNetwork();
 const proofKey=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 const plan=makePlan();
 const envelope=prepareOpenRouterBoundedRequest({plan});
 const fixture=fakeFinancialAuthority();
 const financialReservation=await reserveIndependentFinancialShard({
  config:fixture.config,fetchImpl:fixture.fetchImpl,
  context:{prNumber:plan.exactScope.prNumber,headSha:plan.exactScope.headSha,
   runId:RUN,shardIndex:0,model:OPENROUTER_MODEL_IDS[0],
   requestSha256:hash(envelope.privateRequestJson),
   upperMicroUsd:Math.ceil(envelope.estimateWorstShardUsd*1_000_000)}
 });
 await assert.rejects(()=>rawExecuteOpenRouterShard({
  plan,trustedDiffBytes:INPUT,runId:'gh-38715430667-2',apiKey:K,
  preflight:proofKey,financialReservation,
  approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl
 }),/OR_FINANCIAL_RESERVATION_SCOPE_MISMATCH/);
 assert.equal(net.postCount(),0);
});

test('signed reservation is burned before POST, including after a provider failure',async()=>{
 const net=mockedNetwork({failAt:1});
 const proofKey=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 const plan=makePlan();
 const envelope=prepareOpenRouterBoundedRequest({plan});
 const fixture=fakeFinancialAuthority();
 const financialReservation=await reserveIndependentFinancialShard({
  config:fixture.config,fetchImpl:fixture.fetchImpl,
  context:{prNumber:plan.exactScope.prNumber,headSha:plan.exactScope.headSha,
   runId:RUN,shardIndex:0,model:OPENROUTER_MODEL_IDS[0],
   requestSha256:hash(envelope.privateRequestJson),
   upperMicroUsd:Math.ceil(envelope.estimateWorstShardUsd*1_000_000)}
 });
 const args={plan,trustedDiffBytes:INPUT,runId:RUN,apiKey:K,
  preflight:proofKey,financialReservation,
  approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl};
 await assert.rejects(()=>rawExecuteOpenRouterShard(args),/NO_AUTORETRY/);
 await assert.rejects(()=>rawExecuteOpenRouterShard(args),/OR_FINANCIAL_RESERVATION_REQUIRED/);
 assert.equal(net.postCount(),1);
 assert.equal(fixture.requests.length,1);
});

test('wrong independent signer and mutated signed receipt fail before any paid POST',async()=>{
 const plan=makePlan(),envelope=prepareOpenRouterBoundedRequest({plan});
 const context={prNumber:plan.exactScope.prNumber,headSha:plan.exactScope.headSha,
  runId:RUN,shardIndex:0,model:OPENROUTER_MODEL_IDS[0],
  requestSha256:hash(envelope.privateRequestJson),
  upperMicroUsd:Math.ceil(envelope.estimateWorstShardUsd*1_000_000)};
 const fixture=fakeFinancialAuthority({corruptSignature:true});
 await assert.rejects(()=>reserveIndependentFinancialShard({
  config:fixture.config,context,fetchImpl:fixture.fetchImpl
 }),/OR_FINANCIAL_RESERVATION_SCOPE_MISMATCH/);
 const wrongConfig={...fixture.config,
  trustedSignerFingerprintSha256:'0'.repeat(64)};
 await assert.rejects(()=>reserveIndependentFinancialShard({
  config:wrongConfig,context,fetchImpl:fixture.fetchImpl
 }),/OR_FINANCIAL_AUTHORITY_NOT_CONFIGURED/);
 assert.equal(fixture.requests.length,1);
});

test('expired or scope-violating broker receipts authorize no POST',async()=>{
 const ctx=()=>{
  const plan=makePlan(),envelope=prepareOpenRouterBoundedRequest({plan});
  return {prNumber:plan.exactScope.prNumber,headSha:plan.exactScope.headSha,
   runId:RUN,shardIndex:0,model:OPENROUTER_MODEL_IDS[0],
   requestSha256:hash(envelope.privateRequestJson),
   upperMicroUsd:Math.ceil(envelope.estimateWorstShardUsd*1_000_000)};
 };
 for(const mutateReceipt of [
  row=>{row.expiresAtMs=Date.now()-1000},
  row=>{row.upperMicroUsd+=1},
  row=>{row.globalMonthCapMicroUsd+=1},
  row=>{row.idempotencyKey='f'.repeat(64)}
 ]){
  const fixture=fakeFinancialAuthority({mutateReceipt});
  await assert.rejects(()=>reserveIndependentFinancialShard({
   config:fixture.config,context:ctx(),fetchImpl:fixture.fetchImpl
  }),/OR_FINANCIAL_RESERVATION_(UNVERIFIED|SCOPE_MISMATCH)/);
 }
});

test('correct public synthetic diff and ZDR POST retains true cloud provenance',async()=>{
 const net=mockedNetwork();
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 const r=await executeOpenRouterShard({plan:makePlan(),trustedDiffBytes:INPUT,
  runId:RUN,apiKey:K,preflight:p,
  approvedThirdPartyPrivateEgress:true,authenticatedGlobalBudgetVerified:true,
  fetchImpl:net.fetchImpl});
 assert.equal(r.cloudModelExecuted,true);
 assert.equal(r.localModelExecuted,false);
 assert.equal(r.findingCount,0);
 assert.equal(r.approvalAuthorized,false);
 assert.equal(r.mayPublishReview,false);
 assert.equal(net.postCount(),1);
 assert.doesNotMatch(JSON.stringify(r),/return true/);
});
test('private OpenRouter response cache is explicitly off and cache hits are denied',async()=>{
 const net=mockedNetwork({cacheHit:true});
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 await assert.rejects(()=>executeOpenRouterShard({plan:makePlan(),trustedDiffBytes:INPUT,
  runId:RUN,apiKey:K,preflight:p,
  approvedThirdPartyPrivateEgress:true,authenticatedGlobalBudgetVerified:true,
  fetchImpl:net.fetchImpl}),/OR_PRIVATE_RESPONSE_CACHE_FORBIDDEN/);
 assert.equal(net.postCount(),1);
});
test('private input changed after plan cryptographic binding => deny before POST',async()=>{
 const net=mockedNetwork();
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 await assert.rejects(()=>executeOpenRouterShard({
  plan:makePlan(),trustedDiffBytes:Buffer.from('changed'),runId:RUN,
  apiKey:K,preflight:p,approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl
 }),/OR_DIFF_SCOPE_MISMATCH/);
 assert.equal(net.postCount(),0);
});
test('wrong model response not accepted as proof',async()=>{
 const net=mockedNetwork({modelOverride:'qwen/not-allowlisted'});
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 await assert.rejects(()=>executeOpenRouterShard({plan:makePlan(),
  trustedDiffBytes:INPUT,runId:RUN,apiKey:K,preflight:p,
  approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl
 }),/OR_COMPLETION_ENVELOPE_UNVERIFIED/);
});
test('too expensive even if model content valid => fail closed',async()=>{
 const net=mockedNetwork({changedBody:{model:OPENROUTER_MODEL_IDS[0],
  choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"summary":"ok","findings":[]}'}}],
  usage:{prompt_tokens:500,completion_tokens:100,cost:0.02}}});
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 await assert.rejects(()=>executeOpenRouterShard({plan:makePlan(),trustedDiffBytes:INPUT,
  runId:RUN,apiKey:K,preflight:p,approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl}),/OR_COMPLETION_USAGE_UNVERIFIED/);
});
test('response refusal must not yield an accepted finding',async()=>{
 const net=mockedNetwork({refusal:'I refuse'});
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 await assert.rejects(()=>executeOpenRouterShard({plan:makePlan(),trustedDiffBytes:INPUT,
  runId:RUN,apiKey:K,preflight:p,approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl}));
});
test('transport error not retried automatically, even with budget',async()=>{
 const net=mockedNetwork({failAt:1});
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 await assert.rejects(()=>executeOpenRouterShard({plan:makePlan(),trustedDiffBytes:INPUT,
  runId:RUN,apiKey:K,preflight:p,approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl}),/NO_AUTORETRY/);
 assert.equal(net.postCount(),1);
});
test('entire synthetic diff can be processed via real partitioned pipeline without network',async()=>{
 const net=mockedNetwork();
 const r=await executeCompleteOpenRouterSemanticReview({
  plan:makePlan(),runId:RUN,apiKey:K,approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl
 });
 assert.equal(r.cloudModelExecuted,true);
 assert.equal(r.localModelExecuted,false);
 assert.equal(r.rawByteCoverageProven,true);
 assert.equal(r.processedShardCount,net.postCount());
 assert.equal(r.findingCount,0);
 assert.equal(r.mayMerge,false);
 assert.equal(JSON.parse(r.privateCanonicalReportBytes.toString('utf8')).run_id,RUN);
});
test('expired read-only preflight refreshes once before synthetic paid shard',async()=>{
 const net=mockedNetwork();
 let ticks=0;
 const r=await executeCompleteOpenRouterSemanticReview({
  plan:makePlan(),runId:RUN,apiKey:K,
  approvedThirdPartyPrivateEgress:true,authenticatedGlobalBudgetVerified:true,
  fetchImpl:net.fetchImpl,clockMs:()=>ticks++===0?0:90_001
 });
 assert.equal(r.processedShardCount,1);
 assert.equal(net.requests.filter(x=>x.url===KEY).length,2);
 assert.equal(net.postCount(),1);
});
test('stale proof with exhausted monthly budget blocks before all paid shards',async()=>{
 const net=mockedNetwork({keySequence:[{}, {limit_remaining:0.01}]});
 let ticks=0;
 await assert.rejects(()=>executeCompleteOpenRouterSemanticReview({
  plan:makePlan(),runId:RUN,apiKey:K,
  approvedThirdPartyPrivateEgress:true,authenticatedGlobalBudgetVerified:true,
  fetchImpl:net.fetchImpl,clockMs:()=>ticks++===0?0:90_001
 }),/OR_MONTHLY_KEY_BUDGET_NOT_PROVEN/);
 assert.equal(net.postCount(),0);
});

test('full pipeline blocked before any paid call absent global budget',async()=>{
 const net=mockedNetwork();
 await assert.rejects(()=>executeCompleteOpenRouterSemanticReview({
  plan:makePlan(),runId:RUN,apiKey:K,approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:false,fetchImpl:net.fetchImpl
 }),/OR_GLOBAL_BUDGET_NOT_VERIFIED/);
 assert.equal(net.postCount(),0);
});
test('entire pipeline fails closed on one shard error, no partial output',async()=>{
 const net=mockedNetwork({failAt:1});
 await assert.rejects(()=>executeCompleteOpenRouterSemanticReview({
  plan:makePlan(),runId:RUN,apiKey:K,approvedThirdPartyPrivateEgress:true,
  authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl
 }),/OR_REQUEST_INTERRUPTED_NO_AUTORETRY/);
});

test('finish reason remains strictly stop; each alternative yields safe evidence only',async()=>{
 for(const reason of [undefined,null,'length','error','content_filter','tool_calls']){
  const body={model:OPENROUTER_MODEL_IDS[0],
   choices:[{finish_reason:reason,message:{role:'assistant',content:'{"summary":"ok","findings":[]}'}}],
   usage:{prompt_tokens:1101,completion_tokens:557,cost:0.000233}};
  const net=mockedNetwork({changedBody:body});
  const preflight=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
  await assert.rejects(()=>executeOpenRouterShard({
   plan:makePlan(),trustedDiffBytes:INPUT,runId:RUN,apiKey:K,
   preflight,approvedThirdPartyPrivateEgress:true,
   authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl
  }),/OR_COMPLETION_FINISH_NOT_STOP/);
  // Real providers may bill such a response. No built-in POST replay.
  assert.equal(net.postCount(),1);
 }
});

test('non-assistant and refusal outputs fail without disclosing content',async()=>{
 for(const message of [
  undefined, null,
  {role:'user',content:'{"summary":"ok","findings":[]}'},
  {role:'assistant',refusal:'PRIVATE_UNSAFE_DETAILS',content:''},
  {role:'assistant',tool_calls:[],content:'{"summary":"ok","findings":[]}'},
  {role:'assistant',content:null},
 ]){
  const net=mockedNetwork({changedBody:{model:OPENROUTER_MODEL_IDS[0],
   choices:[{finish_reason:'stop',message}],
   usage:{prompt_tokens:900,completion_tokens:60,cost:0.00015}}});
  const proof=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
  await assert.rejects(()=>executeOpenRouterShard({
   plan:makePlan(),trustedDiffBytes:INPUT,runId:RUN,apiKey:K,
   preflight:proof,approvedThirdPartyPrivateEgress:true,
   authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl
  }),/OR_COMPLETION_MESSAGE_UNVERIFIED/);
  assert.equal(net.postCount(),1);
 }
});

test('invalid accounting, envelope and oversized token usage remain rejected',async()=>{
 const base={model:OPENROUTER_MODEL_IDS[0],
  choices:[{finish_reason:'stop',
    message:{role:'assistant',content:'{"summary":"ok","findings":[]}'}}],
  usage:{prompt_tokens:1101,completion_tokens:557,cost:0.000233}};
 const cases=[
  [{...base,choices:[]},'OR_COMPLETION_ENVELOPE_UNVERIFIED'],
  [{...base,choices:[null]},'OR_COMPLETION_ENVELOPE_UNVERIFIED'],
  [{...base,choices:[42]},'OR_COMPLETION_ENVELOPE_UNVERIFIED'],
  [{...base,choices:['malformed']},'OR_COMPLETION_ENVELOPE_UNVERIFIED'],
  [{...base,choices:[[]]},'OR_COMPLETION_ENVELOPE_UNVERIFIED'],
  [{...base,model:'another-model'},'OR_COMPLETION_ENVELOPE_UNVERIFIED'],
  [{...base,usage:undefined},'OR_COMPLETION_USAGE_UNVERIFIED'],
  [{...base,usage:null},'OR_COMPLETION_USAGE_UNVERIFIED'],
  [{...base,usage:{...base.usage,cost:null}},'OR_COMPLETION_USAGE_UNVERIFIED'],
  [{...base,usage:{...base.usage,cost:0.02}},'OR_COMPLETION_USAGE_UNVERIFIED'],
  [{...base,usage:{...base.usage,prompt_tokens:8192}},'OR_COMPLETION_USAGE_UNVERIFIED'],
  [{...base,usage:{...base.usage,completion_tokens:1025}},'OR_COMPLETION_USAGE_UNVERIFIED'],
 ];
 for(const [body,code] of cases){
  const net=mockedNetwork({changedBody:body});
  const proof=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
  await assert.rejects(()=>executeOpenRouterShard({
   plan:makePlan(),trustedDiffBytes:INPUT,runId:RUN,apiKey:K,
   preflight:proof,approvedThirdPartyPrivateEgress:true,
   authenticatedGlobalBudgetVerified:true,fetchImpl:net.fetchImpl
  }),new RegExp(code));
  assert.equal(net.postCount(),1);
 }
});

test('native Reviewer B key cap of 3 USD authenticates only its own fresh preflight',async()=>{
 const net=mockedNetwork({keyOverrides:{limit:3,limit_remaining:2.85,usage_monthly:0.15}});
 const p=await preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl});
 const {verifyAuthenticatedOpenRouterNativeCap}=await import('../scripts/openrouter-zdr-executor.mjs');
 const args={apiKey:K,preflight:p,model:OPENROUTER_MODEL_IDS[0],maxMonthlyUsd:3};
 assert.equal(verifyAuthenticatedOpenRouterNativeCap(args),true);
 assert.equal(verifyAuthenticatedOpenRouterNativeCap({...args,apiKey:K+'wrong'}),false);
 assert.equal(verifyAuthenticatedOpenRouterNativeCap({...args,preflight:{...p}}),false);
 assert.equal(verifyAuthenticatedOpenRouterNativeCap({...args,model:OPENROUTER_MODEL_IDS[1]}),false);
 const realNow=Date.now;
 try{
  Date.now=()=>realNow()+120001;
  assert.equal(verifyAuthenticatedOpenRouterNativeCap(args),false);
 }finally{Date.now=realNow}
 assert.equal(net.postCount(),0);
});

test('native key preflight refuses above 3 USD cap and never sends billable POST',async()=>{
 const net=mockedNetwork({keyOverrides:{limit:3.01,limit_remaining:3,usage_monthly:0.01}});
 await assert.rejects(()=>preflightOpenRouterKey({apiKey:K,fetchImpl:net.fetchImpl}),/OR_MONTHLY_KEY_BUDGET_NOT_PROVEN/);
 assert.equal(net.postCount(),0);
});
