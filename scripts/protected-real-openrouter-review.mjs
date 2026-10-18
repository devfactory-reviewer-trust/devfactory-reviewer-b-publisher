/**
 * Dormant until separately owner-approved Publisher+DevFactory policy rollout.
 * Protected MAIN only. Real PRIVATE OpenRouter review -> native COMMENTED.
 * Never APPROVE, PASS, HUMAN_GO, MERGE_GO or bypass existing App readback.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {classifyOpenRouterSafeFailure} from './openrouter-safe-failure-diagnostic.mjs';
import {approvedReadOnlyExecutionContext} from './protected-private-read-entrypoint.mjs';
import {createReviewerBAppJwt,createScopedReviewerBInstallationToken}
 from '../candidate/github-app-auth.mjs';
import {runReadOnlyReviewPreflight}
 from '../candidate/private-review-preflight.mjs';
import {readNativeReviews} from '../candidate/github-review-readback.mjs';
import {assessNativeReviewUniqueness} from '../candidate/native-review-uniqueness.mjs';
import {OPENROUTER_MODEL_IDS}
 from './openrouter-zdr-executor.mjs';
import {executeCompleteOpenRouterSemanticReview}
 from './openrouter-semantic-full-review.mjs';
import {assessAuthenticatedSharedBudgetReservation}
 from './authenticated-shared-budget-reservation.mjs';
import {prepareOpenRouterNativeComment}
 from './openrouter-native-report.mjs';
import {fetchAndVerifyOwnerCloudConsent}
 from './openrouter-owner-consent.mjs';
import {publishRealSemanticComment}
 from './protected-real-semantic-review.mjs';

const REPO='devfactory-reviewer-trust/devfactory-reviewer-b-publisher';
const WORKFLOW=REPO+'/.github/workflows/reviewer-b-private-openrouter.yml@refs/heads/main';
const SHA40=/^[a-f0-9]{40}$/;
const deny=c=>{throw Error(c)};
export function canRunProtectedOpenRouterReview(e){
 return approvedReadOnlyExecutionContext(e)&&
   e.GITHUB_WORKFLOW_REF===WORKFLOW&&
   (e.GITHUB_EVENT_NAME==='workflow_dispatch'||e.GITHUB_EVENT_NAME==='issue_comment')&&
   e.REVIEWER_B_CLOUD_REQUEST_VERIFIED==='true'&&
   typeof e.REVIEWER_B_EXPECTED_HEAD==='string'&&
   SHA40.test(e.REVIEWER_B_EXPECTED_HEAD)&&
   OPENROUTER_MODEL_IDS.includes(e.REVIEWER_B_OPENROUTER_MODEL)&&
   e.REVIEWER_B_CLOUD_POLICY_READY==='approved-protected-v1'&&
   e.REVIEWER_B_CLOUD_TARGET_REPOSITORY==='deenkids7-dev/deenkids';
}
export async function executeProtectedOpenRouterReview({
 env={},fetchImpl=globalThis.fetch,cloudFetchImpl=globalThis.fetch,
 now=Date.now(),clock=()=>Date.now()
}={}){
 if(typeof clock!=='function'||!Number.isSafeInteger(now))
   return Object.freeze({ok:false,code:'CLOUD_CLOCK_INVALID'});
 if(!canRunProtectedOpenRouterReview(env))
    return Object.freeze({ok:false,code:'CLOUD_CONTEXT_OR_POLICY_DENIED'});
 if(typeof env.REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM!=='string'||
    env.REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM.length<100||
    typeof env.REVIEWER_B_OPENROUTER_API_KEY!=='string'||
    !/^sk-or-[A-Za-z0-9_-]{20,200}$/.test(env.REVIEWER_B_OPENROUTER_API_KEY))
    return Object.freeze({ok:false,code:'CLOUD_CREDENTIALS_NOT_PROVISIONED'});
 let stage='READ';
 try {
  const runId='gh-'+env.GITHUB_RUN_ID+'-'+env.GITHUB_RUN_ATTEMPT;
  const issuePr=Number(env.REVIEWER_B_TARGET_PR);
  const pem=env.REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM;
  const jwt=createReviewerBAppJwt({privateKeyPem:pem,now});
  const read=await createScopedReviewerBInstallationToken({
   appJwt:jwt,purpose:'reviewRead',now,fetchImpl
  });
  stage='PREFLIGHT';
  const preflight=await runReadOnlyReviewPreflight({
    prNumber:issuePr,runId,installationToken:read.token,fetchImpl
  });
  if(preflight?.target?.headSha!==env.REVIEWER_B_EXPECTED_HEAD||
     preflight?.target?.repository!=='deenkids7-dev/deenkids'||
     preflight?.target?.prNumber!==issuePr||
     preflight.staticDisposition!=='INCONCLUSIVE'||
     preflight.blockingFindings!==0||
     preflight.approvalAuthorized!==false||
     preflight.independentReviewVerified!==false)
     deny('CLOUD_EXACT_HEAD_OR_STATIC_REJECTED');
  // Same exact-GitHub-HEAD uniqueness check as local Reviewer B BEFORE billing.
  const prior=await readNativeReviews({
   prNumber:issuePr,expectedHeadSha:preflight.target.headSha,
   installationToken:read.token,fetchImpl
  });
  if(assessNativeReviewUniqueness({
    observed:prior,prNumber:issuePr,
    currentHeadSha:preflight.target.headSha
  }).blocked)deny('CLOUD_ALREADY_REVIEWED');
  // Owner separately attests private third-party egress AND GLOBAL 15 EUR
  // RunPod+OpenRouter spend for this exact HEAD, model and UTC month.
  // The service actor's dispatch alone is never consent.
  stage='CONSENT';
  const consent=await fetchAndVerifyOwnerCloudConsent({
    readToken:read.token,prNumber:issuePr,
    headSha:preflight.target.headSha,
    model:env.REVIEWER_B_OPENROUTER_MODEL,now,fetchImpl
  });
  if(!consent.ok||consent.globalMonthlyBudgetEur!==15)
    deny('CLOUD_OWNER_SPEND_OR_EGRESS_NOT_PROVEN');
  // Owner consent is separate from authenticated RunPod+OpenRouter spend.
  // This shared EUR15 atomic reservation is not implemented. Block BEFORE
  // billable POST; never elevate consent to global ledger proof.
  stage='SHARED_BUDGET';
  const budget=assessAuthenticatedSharedBudgetReservation({
    prNumber:issuePr,headSha:preflight.target.headSha,
    model:env.REVIEWER_B_OPENROUTER_MODEL,
    consentVerified:consent.ok,now
  });
  if(budget.verified!==true||budget.maySpend!==true)
    deny('CLOUD_SHARED_BUDGET_ATOMIC_RESERVATION_NOT_PROVEN');
  stage='OPENROUTER';
  const cloud=await executeCompleteOpenRouterSemanticReview({
   plan:preflight.privateSemanticPlan,runId,
   model:env.REVIEWER_B_OPENROUTER_MODEL,
   apiKey:env.REVIEWER_B_OPENROUTER_API_KEY,
   approvedThirdPartyPrivateEgress:true,
   authenticatedGlobalBudgetVerified:budget.verified&&budget.maySpend,
   fetchImpl:cloudFetchImpl,maxOutputTokens:1024,concurrency:3
  });
  stage='REPORT';
  const comment=prepareOpenRouterNativeComment({preflight,cloud,runId});
  // Refresh short-lived GitHub App credentials AFTER paid inference.
  stage='READ_REFRESH';
  const refreshNow=clock();
  if(!Number.isSafeInteger(refreshNow)||refreshNow<now)
    deny('CLOUD_CLOCK_REFRESH_INVALID');
  const jwtAgain=createReviewerBAppJwt({privateKeyPem:pem,now:refreshNow});
  const readAgain=await createScopedReviewerBInstallationToken({
    appJwt:jwtAgain,purpose:'reviewRead',now:refreshNow,fetchImpl
  });
  stage='CONSENT_REFRESH';
  await fetchAndVerifyOwnerCloudConsent({
    readToken:readAgain.token,prNumber:issuePr,
    headSha:preflight.target.headSha,
    model:env.REVIEWER_B_OPENROUTER_MODEL,now:refreshNow,fetchImpl
  });
  stage='WRITE';
  const writerNow=clock();
  if(!Number.isSafeInteger(writerNow)||writerNow<refreshNow)
    deny('CLOUD_CLOCK_WRITE_INVALID');
  const writeJwt=createReviewerBAppJwt({privateKeyPem:pem,now:writerNow});
  const write=await createScopedReviewerBInstallationToken({
   appJwt:writeJwt,purpose:'publish',now:writerNow,fetchImpl
  });
  stage='NATIVE';
  const published=await publishRealSemanticComment({
   plan:comment,readToken:readAgain.token,writeToken:write.token,
   approvedProtectedPublication:true,approvedCloudCommentPublication:true,
   fetchImpl
  });
  if(!published?.ok||published.code!=='REAL_REVIEW_COMMENT_VERIFIED')
    deny('CLOUD_NATIVE_READBACK_INVALID');
  // Never log private text, model tokens, API key, or per-file metrics.
  console.log('OPENROUTER_PROTECTED_NATIVE_COMMENT_VERIFIED');
  return Object.freeze({ok:true,code:'CLOUD_NATIVE_COMMENT_VERIFIED',
    model:cloud.model,parts:cloud.processedShardCount,
    providerCostUsd:cloud.apiCostReportedUsd,
    approvalAuthorized:false,independentReviewVerified:false,mayMerge:false});
 } catch(error) {
  // Only constant allowlisted categories reach PUBLIC logs. Never log the
  // error message/stack/cause, response body, provider data or private diff.
  if(stage==='OPENROUTER')
    console.log('OPENROUTER_PROTECTED_DIAGNOSTIC_'+
      classifyOpenRouterSafeFailure(error));
  console.log('OPENROUTER_PROTECTED_'+stage+'_FAILED_CLOSED');
  return Object.freeze({ok:false,code:'CLOUD_'+stage+'_FAILED_CLOSED'});
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const result=await executeProtectedOpenRouterReview({env:process.env});
 console.log('OPENROUTER_PROTECTED_'+result.code);
 if(!result.ok)process.exitCode=1;
}
