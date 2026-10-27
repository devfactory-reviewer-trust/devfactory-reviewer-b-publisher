/**
 * OpenRouter ZDR PRIVATE inference candidate for the existing protected
 * Publisher. This file NEVER claims LOCAL Ollama model execution, independent
 * security PASS, native review publication, or merge authority.
 *
 * Exactly two allowlisted Qwen models. No auto/fallback providers, caches,
 * plugins, tools, BYOK, external files, logs or explicit insecure endpoint.
 */
import {createHash} from 'node:crypto';
import {consumeIndependentFinancialShard}
 from './openrouter-independent-financial-reservation.mjs';
import {inspect} from 'node:util';
import {prepareOfflineOllamaCandidate,validateOfflineOllamaCompletion}
 from '../candidate/ollama-offline-contract.mjs';

const CHAT='https://openrouter.ai/api/v1/chat/completions';
const KEY='https://openrouter.ai/api/v1/key';
const CATALOG='https://openrouter.ai/api/v1/models?zdr=true';
const OLLAMA_VALIDATION_MODEL='qwen2.5-coder:7b';
const MAX_REPLY_BYTES=128*1024;
const MAX_PUBLIC_CATALOG_BYTES=8*1024*1024;
const KEY_PROOFS=new WeakMap();
const PRICES=Object.freeze({
 'qwen/qwen3-coder-30b-a3b-instruct':Object.freeze({prompt:0.10,completion:0.40}),
 'qwen/qwen3.6-35b-a3b':Object.freeze({prompt:0.20,completion:1.20})
}); // PER MILLION tokens, conservative ceilings above 2026-10-15 public prices.
export const OPENROUTER_MODEL_IDS=Object.freeze(Object.keys(PRICES));
const deny=code=>{throw Error(code)};
const DIGEST=b=>createHash('sha256').update(b).digest('hex');
const JSON_TYPE=/^application\/json(?:\s*;|$)/i;
function exactJsonResponse(r,url,maxBytes=MAX_REPLY_BYTES){
 if(!r||r.status!==200||r.url!==url||r.redirected!==false||
    typeof r.headers?.get!=='function'||
    !JSON_TYPE.test(r.headers.get('content-type')||''))
    deny('OR_ENDPOINT_UNVERIFIED');
 const len=r.headers.get('content-length');
 if(len!==null&&len!==undefined&&(!/^\d+$/.test(len)||Number(len)>maxBytes))
    deny('OR_RESPONSE_TOO_LARGE');
}
async function boundedJson(r,url,maxBytes=MAX_REPLY_BYTES){
 exactJsonResponse(r,url,maxBytes);
 if(typeof r.body?.getReader!=='function')deny('OR_BODY_INVALID');
 const rd=r.body.getReader(),parts=[];
 let count=0,finished=false;
 try{
  for(;;){
   const part=await rd.read();
   if(part.done){finished=true;break}
   if(!(part.value instanceof Uint8Array))deny('OR_BODY_INVALID');
   count+=part.value.byteLength;
   if(count>maxBytes)deny('OR_RESPONSE_TOO_LARGE');
   parts.push(Buffer.from(part.value));
  }
 }finally{
  if(!finished){try{Promise.resolve(rd.cancel()).catch(()=>{})}catch{}}
  rd.releaseLock();
 }
 const bytes=Buffer.concat(parts,count),raw=bytes.toString('utf8');
 if(!Buffer.from(raw,'utf8').equals(bytes))deny('OR_RESPONSE_ENCODING_INVALID');
 let json;
 try{json=JSON.parse(raw)}catch{deny('OR_RESPONSE_INVALID_JSON')}
 return {json,bytes};
}
export function prepareOpenRouterBoundedRequest({plan,model=OPENROUTER_MODEL_IDS[0],
 maxOutputTokens=1024,trustedDeclarationIndex=null,trustedOriginalDiffSha256=null}={}){
 if(!Object.hasOwn(PRICES,model))deny('OR_MODEL_NOT_ALLOWLISTED');
 if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<128||maxOutputTokens>2048)
   deny('OR_OUTPUT_BUDGET_INVALID');
 // Re-use the STRICT exact-Git-diff/changed-line grammar, never private
 // text supplied outside the cryptographically rebound local plan.
 const local=prepareOfflineOllamaCandidate({
  plan,model:OLLAMA_VALIDATION_MODEL,maxOutputTokens,
  protectedEphemeralKeepAlive:false,trustedDeclarationIndex,trustedOriginalDiffSha256
 });
 const oracle=JSON.parse(local.privateRequestJson);
 const request={
  model,stream:false,temperature:0,max_tokens:maxOutputTokens,
  usage:{include:true},messages:oracle.messages,
  response_format:{type:'json_schema',json_schema:{
   name:'reviewer_b_bounded_findings',strict:true,schema:oracle.format
  }},
  provider:{
   sort:'throughput',allow_fallbacks:false,require_parameters:true,
   data_collection:'deny',zdr:true,max_price:PRICES[model]
  }
 };
 // No implicit OpenRouter plugins, external tools or cache can be requested.
 if(Buffer.byteLength(JSON.stringify(request),'utf8')>12000)
    deny('OR_REQUEST_TOO_LARGE');
 const envelope={model,prNumber:plan.exactScope.prNumber,
   headSha:plan.exactScope.headSha,baseSha:plan.exactScope.baseSha,
   diffSha256:plan.exactScope.diffSha256,maxOutputTokens,
   modelOrigin:'OPENROUTER_THIRD_PARTY_ZDR',localModelExecuted:false,
   approvalAuthorized:false,independentReviewVerified:false,
   privateSourceProcessingAuthorized:false,mayPublishReview:false,
   estimateWorstShardUsd:+((8192*PRICES[model].prompt+
                              maxOutputTokens*PRICES[model].completion)/1e6).toFixed(6)
 };
 Object.defineProperties(envelope,{
  privateRequestJson:{enumerable:false,configurable:false,
   value:JSON.stringify(request)},
  toJSON:{enumerable:false,configurable:false,value:()=>({
   ...Object.fromEntries(Object.entries(envelope)),privateRequestJson:'[REDACTED]'
  })},
  [inspect.custom]:{enumerable:false,configurable:false,
   value:()=> '[OpenRouterPRIVATERequest: REDACTED; NO AUTHORITY]'}
 });
 return Object.freeze(envelope);
}
export function assessOpenRouterMonthlyKey(info){
 const k=info?.data;
 if(!k||typeof k!=='object'||k.limit_reset!=='monthly'||
    typeof k.limit!=='number'||k.limit<0.01||k.limit>3||
    typeof k.limit_remaining!=='number'||!Number.isFinite(k.limit_remaining)||
    k.limit_remaining<0.05||k.limit_remaining>k.limit||

    !Number.isFinite(k.usage_monthly)||k.usage_monthly<0)
    return Object.freeze({ok:false,reason:'OR_MONTHLY_KEY_BUDGET_NOT_PROVEN'});
 return Object.freeze({ok:true,monthlyLimitUsd:k.limit,
   remainingUsd:k.limit_remaining,usageMonthUsd:k.usage_monthly});
}
export function assessOpenRouterModelZdr({data},model){
 const m=Array.isArray(data)?data.find(v=>v?.id===model):null;
 if(!m||!Array.isArray(m.supported_parameters)||
    !m.supported_parameters.includes('structured_outputs')||
    typeof m.pricing?.prompt!=='string'||typeof m.pricing?.completion!=='string')
    return Object.freeze({ok:false,reason:'OR_ZDR_MODEL_CAPABILITY_MISSING'});
 const p=Number(m.pricing.prompt)*1e6,c=Number(m.pricing.completion)*1e6;
 if(!Number.isFinite(p)||!Number.isFinite(c)||p<0||c<0||
    p>PRICES[model].prompt||c>PRICES[model].completion)
    return Object.freeze({ok:false,reason:'OR_MODEL_PRICE_DRIFT'});
 return Object.freeze({ok:true,zdrCandidate:true,pricePerMillionUsd:{input:p,output:c}});
}
async function strictGet(url,fetchImpl,header){
 let r;
 try{
  r=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(12000),
   headers:{Accept:'application/json',...header}});
 }catch{deny('OR_PREFLIGHT_NETWORK_FAILED')}
 return (await boundedJson(r,url,url===CATALOG?MAX_PUBLIC_CATALOG_BYTES:MAX_REPLY_BYTES)).json;
}
export async function preflightOpenRouterKey({apiKey,model=OPENROUTER_MODEL_IDS[0],
 fetchImpl=globalThis.fetch}={}){
 if(!Object.hasOwn(PRICES,model)||typeof apiKey!=='string'||
    !/^sk-or-[A-Za-z0-9_-]{20,200}$/.test(apiKey)||
    typeof fetchImpl!=='function')
    deny('OR_KEY_OR_MODEL_UNVERIFIED');
 const keyInfo=await strictGet(KEY,fetchImpl,{Authorization:'Bearer '+apiKey});
 const budget=assessOpenRouterMonthlyKey(keyInfo);
 if(!budget.ok)deny(budget.reason);
 const models=await strictGet(CATALOG,fetchImpl,{});
 const catalog=assessOpenRouterModelZdr(models,model);
 if(!catalog.ok)deny(catalog.reason);
 const proof=Object.freeze({ok:true,model,monthlyLimitUsd:budget.monthlyLimitUsd,
   remainingUsd:budget.remainingUsd,catalog,
   noPrivateSourceRead:true,mayPublishReview:false,
   independentReviewVerified:false,expiresAfterMs:120000});
 KEY_PROOFS.set(proof,{time:Date.now(),keyHash:DIGEST(apiKey)});
 return proof;
}
/**
 * Authenticate the native Reviewer B monthly key ceiling. Proofs may only
 * originate from this module's strict read-only provider preflight. Caller
 * booleans, object copies and arbitrary timestamps cannot grant spending.
 */
export function verifyAuthenticatedOpenRouterNativeCap({
 apiKey,preflight,model=OPENROUTER_MODEL_IDS[0],maxMonthlyUsd=3
}={}){
 if(maxMonthlyUsd!==3||typeof apiKey!=='string'||
    !/^sk-or-[A-Za-z0-9_-]{20,200}$/.test(apiKey)||
    !preflight?.ok||preflight.model!==model||
    !Object.hasOwn(PRICES,model)||
    !Number.isFinite(preflight.monthlyLimitUsd)||
    preflight.monthlyLimitUsd<0.01||preflight.monthlyLimitUsd>3||
    !Number.isFinite(preflight.remainingUsd)||
    preflight.remainingUsd<0.05||
    preflight.remainingUsd>preflight.monthlyLimitUsd||
    preflight.expiresAfterMs!==120000)return false;
 const proof=KEY_PROOFS.get(preflight);
 const age=proof?Date.now()-proof.time:NaN;
 return !!proof&&Number.isFinite(age)&&age>=0&&age<=120000&&
   proof.keyHash===DIGEST(apiKey);
}
/**
 * One authorized PRIVATE request, using only the preflighted key and plan.
 * The existing LOCAL validator is used for JSON + exact source-line anchors
 * as a PURE parser. We never describe this model as local, and return no
 * localModelExecuted or local response provenance as true.
 */
export async function executeOpenRouterShard({
 plan,trustedDiffBytes,runId,model=OPENROUTER_MODEL_IDS[0],
 apiKey,preflight,approvedThirdPartyPrivateEgress=false,
 authenticatedGlobalBudgetVerified=false,fetchImpl=globalThis.fetch,
 maxOutputTokens=1024,trustedDeclarationIndex=null,
 trustedOriginalDiffSha256=null,financialReservation=null,shardIndex=0
}={}){
 if(approvedThirdPartyPrivateEgress!==true)
    deny('OR_PRIVATE_EGRESS_NOT_AUTHORIZED');
 if(authenticatedGlobalBudgetVerified!==true)
    deny('OR_GLOBAL_BUDGET_NOT_VERIFIED');
 if(!preflight?.ok||preflight.model!==model||preflight.remainingUsd<0.05||
    preflight.monthlyLimitUsd>3||preflight.expiresAfterMs!==120000)
    deny('OR_PREFLIGHT_PROOF_INVALID');
 const proof=KEY_PROOFS.get(preflight);
 if(!proof||Date.now()-proof.time<0||Date.now()-proof.time>120000||
    typeof apiKey!=='string'||proof.keyHash!==DIGEST(apiKey))
    deny('OR_PREFLIGHT_PROOF_NOT_AUTHENTIC_OR_EXPIRED');
 if(typeof apiKey!=='string'||!/^sk-or-[A-Za-z0-9_-]{20,200}$/.test(apiKey)||
    typeof fetchImpl!=='function'||!Buffer.isBuffer(trustedDiffBytes))
    deny('OR_INPUT_UNVERIFIED');
 const req=prepareOpenRouterBoundedRequest({
  plan,model,maxOutputTokens,trustedDeclarationIndex,trustedOriginalDiffSha256
 });
 if(DIGEST(trustedDiffBytes)!==req.diffSha256||
   trustedDiffBytes.toString('utf8')!==plan.privateDiffText)
    deny('OR_DIFF_SCOPE_MISMATCH');
 // This is the ONLY paid OpenRouter egress point: a pinned, independent,
 // one-use signed financial reservation is mandatory for every shard.
 consumeIndependentFinancialShard({proof:financialReservation,context:{
   prNumber:plan.exactScope.prNumber,headSha:plan.exactScope.headSha,
   runId,shardIndex,model,requestSha256:DIGEST(req.privateRequestJson),
   upperMicroUsd:Math.ceil(req.estimateWorstShardUsd*1_000_000)
 }});
 // No automatic retry: a transport loss can have incurred a provider bill.
 let r;
 try{
  r=await fetchImpl(CHAT,{
   method:'POST',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(45000),
   headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',
     Accept:'application/json','X-OpenRouter-Title':'DevFactory-Protected-ReviewerB-ZDR',
     'X-OpenRouter-Cache':'false'},
   body:req.privateRequestJson});
 }catch{deny('OR_REQUEST_INTERRUPTED_NO_AUTORETRY')}
 // Per-request provider.zdr controls the upstream route, NOT OpenRouter's
 // separate response cache. Never accept a cached PRIVATE diff response.
 if(r?.headers?.get?.('x-openrouter-cache-status')?.toUpperCase()==='HIT')
   deny('OR_PRIVATE_RESPONSE_CACHE_FORBIDDEN');
 const {json,bytes}=await boundedJson(r,CHAT);
 // Keep EXACTLY the existing fail-closed acceptance predicates, but
 // distinguish each trusted internal rejection with a fixed error code.
 // Never log or return raw provider content, model output, IDs or tokens.
 const choice=json?.choices?.[0];
 if(!Array.isArray(json?.choices)||json.choices.length!==1||
    !choice||typeof choice!=='object'||Array.isArray(choice)||
    json.model!==model)
    deny('OR_COMPLETION_ENVELOPE_UNVERIFIED');
 if(choice?.finish_reason!=='stop')
    deny('OR_COMPLETION_FINISH_NOT_STOP');
 const message=choice?.message;
 if(!message||message.role!=='assistant'||message.refusal!=null||
    message.tool_calls!=null||typeof message.content!=='string')
    deny('OR_COMPLETION_MESSAGE_UNVERIFIED');
 const usage=json?.usage;
 if(!usage||!Number.isSafeInteger(usage.prompt_tokens)||
    usage.prompt_tokens<1||
    !Number.isSafeInteger(usage.completion_tokens)||
    usage.completion_tokens<1||
    usage.completion_tokens>maxOutputTokens||
    usage.prompt_tokens+usage.completion_tokens+512>8192||
    typeof usage.cost!=='number'||!Number.isFinite(usage.cost)||
    usage.cost<0||usage.cost>0.01)
    deny('OR_COMPLETION_USAGE_UNVERIFIED');
 // Normalize exactly the signed-diff anchors; this is NOT an Ollama claim.
 const normalized=validateOfflineOllamaCompletion({
   response:{model:OLLAMA_VALIDATION_MODEL,done:true,done_reason:'stop',
     message:{role:'assistant',content:choice.message.content},
     prompt_eval_count:json.usage.prompt_tokens,
     eval_count:json.usage.completion_tokens},
   expectedModel:OLLAMA_VALIDATION_MODEL,runId,
   trustedChangedPaths:plan.changedPaths,trustedDiffBytes,
   expectedDiffSha256:req.diffSha256,maxCompletionTokens:maxOutputTokens});
 const report=Buffer.from(normalized.privateCanonicalReportBytes);
 const result={
  model,modelOrigin:'OPENROUTER_THIRD_PARTY_ZDR',
  cloudModelExecuted:true,localModelExecuted:false,
  findingCount:normalized.findingCount,provisionalState:normalized.provisionalState,
  externalResponseSha256:DIGEST(bytes),
  billedCostReportedUsd:json.usage.cost,
  reportedInputTokens:json.usage.prompt_tokens,
  reportedOutputTokens:json.usage.completion_tokens,
  approvalAuthorized:false,independentReviewVerified:false,mayPublishReview:false
 };
 Object.defineProperties(result,{
  privateCanonicalReportBytes:{enumerable:false,configurable:false,
    get:()=>Buffer.from(report)},
  toJSON:{enumerable:false,configurable:false,value:()=>({
    ...Object.fromEntries(Object.entries(result)),privateCanonicalReportBytes:'[REDACTED]'
  })},
  [inspect.custom]:{enumerable:false,configurable:false,
    value:()=> '[OpenRouterShard: PRIVATE RESULT REDACTED; NOT APPROVED]'}
 });
 return Object.freeze(result);
}
