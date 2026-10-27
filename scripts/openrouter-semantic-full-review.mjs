/**
 * Complete exact-diff OpenRouter advisory; is NOT local Ollama and does NOT
 * post a review. Reuses production exact authenticated shard planning.
 * No partial success, no replay, no auto model request retries.
 */
import {createHash} from 'node:crypto';
import {inspect} from 'node:util';
import {performance} from 'node:perf_hooks';
import {canonicalJson} from '../src/canonical.mjs';
import {prepareBoundedSemanticReview} from '../candidate/semantic-review-request.mjs';
import {planAdaptiveSemanticShards} from '../candidate/semantic-bounded-shards.mjs';
import {makeBoundedDiffDeclarationIndex} from '../candidate/semantic-diff-declarations.mjs';
import {OPENROUTER_MODEL_IDS,preflightOpenRouterKey,executeOpenRouterShard,
 prepareOpenRouterBoundedRequest}
 from './openrouter-zdr-executor.mjs';
import {reserveIndependentFinancialShard,validateIndependentFinancialConfig}
 from './openrouter-independent-financial-reservation.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const deny=c=>{throw Error(c)};
const MAX_ADVISORY_USD=0.50;
export async function executeCompleteOpenRouterSemanticReview({
 plan,runId,model=OPENROUTER_MODEL_IDS[0],apiKey,
 approvedThirdPartyPrivateEgress=false,
 authenticatedGlobalBudgetVerified=false,
 fetchImpl=globalThis.fetch,maxOutputTokens=1024,
 concurrency=3,clockMs=()=>performance.now(),
 financialAuthority=null,financialFetchImpl=globalThis.fetch
}={}){
 if(typeof clockMs!=='function')deny('OR_CLOCK_INVALID');
 if(!plan||typeof plan.privateDiffText!=='string'||
    !/^gh-[1-9][0-9]{0,18}-[1-9][0-9]{0,18}$/.test(runId||'')||
    !OPENROUTER_MODEL_IDS.includes(model)||
    ![1,2,3].includes(concurrency)||maxOutputTokens!==1024)
    deny('OR_FULL_SCOPE_INVALID');
 if(approvedThirdPartyPrivateEgress!==true)
    deny('OR_PRIVATE_EGRESS_NOT_AUTHORIZED');
 if(authenticatedGlobalBudgetVerified!==true)
    deny('OR_GLOBAL_BUDGET_NOT_VERIFIED');
 if(!validateIndependentFinancialConfig(financialAuthority).ok)
    deny('OR_FINANCIAL_AUTHORITY_NOT_CONFIGURED');
 const original=Buffer.from(plan.privateDiffText,'utf8');
 if(sha(original)!==plan.exactScope?.diffSha256)
    deny('OR_FULL_DIFF_MISMATCH');
 // Exact same full-source partitioning as protected LOCAL Reviewer B.
 const routing=planAdaptiveSemanticShards({plan,maxOutputTokens});
 const parts=routing.partitions;
 if(parts.rawByteCoverageProven!==true||
    parts.originalDiffSha256!==sha(original)||
    !Number.isSafeInteger(parts.shardCount)||parts.shardCount<1||
    parts.shardCount>96||parts.shards.length!==parts.shardCount)
    deny('OR_FULL_COVERAGE_NOT_PROVEN');
 const startTime=performance.now();
 const declarations=makeBoundedDiffDeclarationIndex({plan});
 // All model requests are preconstructed before FIRST private external call.
 const jobs=parts.shards.map(part=>{
   const bytes=part.privateDiffBytes;
   if(sha(bytes)!==part.diffSha256)deny('OR_SHARD_PROOF_FAILED');
   const chunkPlan=prepareBoundedSemanticReview({
    snapshot:{repository:'deenkids7-dev/deenkids',repository_id:1282086207,
      pr_number:plan.exactScope.prNumber,
      head_sha:plan.exactScope.headSha,base_sha:plan.exactScope.baseSha,
      diff_sha256:part.diffSha256},
    rawDiffBytes:bytes
   });
   return {bytes,chunkPlan,part};
 });
 let preflight=await preflightOpenRouterKey({apiKey,model,fetchImpl});
 let preflightIssuedAt=clockMs();
 if(!Number.isFinite(preflightIssuedAt))deny('OR_CLOCK_INVALID');
 // Cost guard uses MAX price of allowlisted model and full conservative
 // 8192 input token envelope. No additional PRIVATE HTTP requests beyond
 // this one bounded exact original diff and its authenticated shards.
 const perShardCeiling={
  'qwen/qwen3-coder-30b-a3b-instruct':(8192*0.10+1024*0.40)/1e6,
  'qwen/qwen3.6-35b-a3b':(8192*0.20+1024*1.20)/1e6
 }[model];
 const worstCase=perShardCeiling*jobs.length;
 if(!(Number.isFinite(worstCase))||worstCase>MAX_ADVISORY_USD||
    preflight.remainingUsd<worstCase+0.05)
    deny('OR_FULL_REVIEW_BUDGET_NOT_PROVEN');
 // Revalidate the READ-ONLY key budget and ZDR catalogue before a long
 // review outlives its 120-second proof. Share one renewal across workers;
 // NEVER retry a paid shard POST, and fail closed if funds or ZDR drift.
 let refreshInFlight=null;
 const currentKeyProof=async()=>{
  const currentTime=clockMs();
  if(!Number.isFinite(currentTime)||currentTime<preflightIssuedAt)
    deny('OR_CLOCK_INVALID');
  if(currentTime-preflightIssuedAt<90_000)return preflight;
  if(!refreshInFlight){
   refreshInFlight=(async()=>{
    const renewed=await preflightOpenRouterKey({apiKey,model,fetchImpl});
    if(renewed.remainingUsd<worstCase+0.05)
      deny('OR_FULL_REVIEW_BUDGET_NOT_PROVEN');
    preflight=renewed;
    preflightIssuedAt=clockMs();
    if(!Number.isFinite(preflightIssuedAt))deny('OR_CLOCK_INVALID');
   })().finally(()=>{refreshInFlight=null});
  }
  await refreshInFlight;
  return preflight;
 };
 const findings=[],seen=new Set(),responses=Array(jobs.length);
 let nextIndex=0,failed=null,spentUsd=0;
 const results=Array(jobs.length);
 const worker=async()=>{
  while(true){
   if(failed)return;
   const index=nextIndex++;
   if(index>=jobs.length)return;
   const job=jobs[index];
   try{
    const freshPreflight=await currentKeyProof();
    const envelope=prepareOpenRouterBoundedRequest({
      plan:job.chunkPlan,model,maxOutputTokens,
      trustedDeclarationIndex:declarations,
      trustedOriginalDiffSha256:parts.originalDiffSha256
    });
    // The independent broker must DURABLY reserve the conservative bound
    // before this exact shard can reach the provider. No retry on ambiguity.
    const financialReservation=await reserveIndependentFinancialShard({
      config:financialAuthority,fetchImpl:financialFetchImpl,
      context:{prNumber:plan.exactScope.prNumber,
       headSha:plan.exactScope.headSha,runId,shardIndex:index,model,
       requestSha256:sha(envelope.privateRequestJson),
       upperMicroUsd:Math.ceil(envelope.estimateWorstShardUsd*1_000_000)}
    });
    const result=await executeOpenRouterShard({
      plan:job.chunkPlan,trustedDiffBytes:job.bytes,runId,
      model,apiKey,preflight:freshPreflight,approvedThirdPartyPrivateEgress,
      authenticatedGlobalBudgetVerified,fetchImpl,maxOutputTokens,
      financialReservation,shardIndex:index,
      trustedDeclarationIndex:declarations,
      trustedOriginalDiffSha256:parts.originalDiffSha256
    });
    results[index]=result;
    spentUsd+=result.billedCostReportedUsd;
    if(spentUsd>MAX_ADVISORY_USD)
      throw Error('OR_FULL_REVIEW_BUDGET_EXCEEDED');
   }catch(error){
    // No retry or verbose error logging. The other in-flight requests finish
    // and are discarded; never publish a partial source analysis.
    failed=error instanceof Error?error:Error('OR_FULL_REVIEW_FAILED_CLOSED');
    return;
   }
  }
 };
 await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},worker));
 if(failed)throw failed;
 if(results.some(v=>!v||v.cloudModelExecuted!==true||
     v.localModelExecuted!==false||v.model!==model||
     v.approvalAuthorized!==false||v.independentReviewVerified!==false))
    deny('OR_FULL_REVIEW_INCOMPLETE');
 let totalInput=0,totalOutput=0;
 for(let i=0;i<jobs.length;i++){
  const result=results[i],job=jobs[i];
  const r=JSON.parse(result.privateCanonicalReportBytes.toString('utf8'));
  if(r.run_id!==runId||!Array.isArray(r.findings)||
     r.findings.length!==result.findingCount)
    deny('OR_FULL_REPORT_INVALID');
  for(const f of r.findings){
   if(!f||typeof f.fingerprint!=='string'||
       !/^[0-9a-f]{64}$/.test(f.fingerprint)||seen.has(f.fingerprint))
      deny('OR_FULL_REPORT_DUPLICATE_OR_INVALID');
   seen.add(f.fingerprint);findings.push(f);
  }
  responses[i]=job.part.diffSha256+':'+result.externalResponseSha256;
  totalInput+=result.reportedInputTokens;
  totalOutput+=result.reportedOutputTokens;
 }
 // Recheck all authenticated shard outputs before considering completeness.
 if(results.length!==parts.shardCount||findings.length>128)
    deny('OR_FULL_REPORT_INCOMPLETE');
 const report=Buffer.from(canonicalJson({
  schema:'devfactory.reviewer-b.findings.v1',
  run_id:runId,
  summary:'Full immutable PRIVATE diff was processed in '+parts.shardCount+
    ' bounded OpenRouter ZDR third-party Qwen shards; findings are advisory and require manual acceptance.',
  findings
 }),'utf8');
 if(report.byteLength>96*1024)deny('OR_FULL_REPORT_TOO_LARGE');
 const result={
  model,modelOrigin:'OPENROUTER_THIRD_PARTY_ZDR',
  cloudModelExecuted:true,localModelExecuted:false,
  externalResponseSha256:sha(responses.join('\n')),
  fullOriginalDiffSha256:parts.originalDiffSha256,
  rawByteCoverageProven:true,processedShardCount:jobs.length,
  totalInputTokens:totalInput,totalOutputTokens:totalOutput,
  apiCostReportedUsd:+spentUsd.toFixed(6),
  elapsedMs:Math.round(performance.now()-startTime),
  reviewMode:routing.mode,
  geminiAdvisoryRecommended:routing.geminiAdvisoryRecommended,
  findingCount:findings.length,
  provisionalState:findings.some(f=>['critical','high'].includes(f.severity))
    ?'FAIL':'INCONCLUSIVE',
  approvalAuthorized:false,independentReviewVerified:false,
  mayPublishReview:false,mayMerge:false
 };
 Object.defineProperties(result,{
   privateCanonicalReportBytes:{enumerable:false,configurable:false,
     get:()=>Buffer.from(report)},
   toJSON:{enumerable:false,configurable:false,
     value:()=>({...Object.fromEntries(Object.entries(result)),
       privateCanonicalReportBytes:'[REDACTED]'})},
   [inspect.custom]:{enumerable:false,configurable:false,
     value:()=> '[CompleteOpenRouterZDRReview: PRIVATE REPORT REDACTED; NOT APPROVED]'}
 });
 return Object.freeze(result);
}
