import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { createReadOnlyGitHubTransport } from './github-read-only.mjs';
import { observePrSnapshot } from '../src/github-pr-observer.mjs';
import { runFailOnlyStaticDiffAudit } from './fail-only-static-audit.mjs';
import { prepareBoundedSemanticReview } from './semantic-review-request.mjs';

function deny(code) { throw new Error(code); }

/**
 * Secret-free orchestrator, to be executed ONLY in a future privileged job
 * with an independently provisioned installation token. Does no write, no
 * model inference and no publication. The raw private diff is available only
 * via a NONENUMERABLE privateSemanticPlan getter for a separately authorized
 * protected LOCAL model, never by default JSON, spread, or Node inspection.
 *
 * Caller must separately approve exposure before ANY use of the model
 * interface. This preflight is not a code review or an approval.
 */
export async function runReadOnlyReviewPreflight({
  prNumber, runId, installationToken, fetchImpl=fetch,
  allowAdvisoryStackedBase=false
}={}) {
  const transport=createReadOnlyGitHubTransport({
    installationToken,fetchImpl
  });
  let rawDiffBytes;
  const request=async ({url,method,accept,maxBytes})=>{
    const response=await transport({url,method,accept,maxBytes});
    if(accept==='application/vnd.github.diff'){
      if(rawDiffBytes!==undefined) deny('PREFLIGHT_REPEATED_DIFF');
      rawDiffBytes=Buffer.from(response.body);
    }
    return response;
  };
  const snapshot=await observePrSnapshot({prNumber,request,allowAdvisoryStackedBase});
  if(!Buffer.isBuffer(rawDiffBytes)||rawDiffBytes.length<1 ||
     createHash('sha256').update(rawDiffBytes).digest('hex')!==snapshot.diff_sha256){
    deny('PREFLIGHT_DIFF_MISMATCH');
  }
  const audit=runFailOnlyStaticDiffAudit({
    diffBytes:rawDiffBytes,runId
  });
  const summary=Object.freeze({
    repository:snapshot.repository,
    repositoryId:snapshot.repository_id,
    prNumber:snapshot.pr_number,
    headSha:snapshot.head_sha,
    baseSha:snapshot.base_sha,
    ...(snapshot.advisory_stacked===true?{baseRef:snapshot.base_ref}:{}),
    diffSha256:snapshot.diff_sha256
  });
  const report=Buffer.from(audit.reportBytes);
  // Future protected local inference can reuse the exact same authenticated
  // private diff without fetching an unverified second copy. This creates
  // NO model call, grant of private-source processing, or review authority.
  const localPlan=prepareBoundedSemanticReview({snapshot,rawDiffBytes});
  // Private file names remain sensitive even when no code line is echoed.
  const output={
    target:summary,staticDisposition:audit.provisionalState,
    blockingFindings:audit.blockingFindings,
    semanticAnalysisCompleted:false,independentReviewVerified:false,
    approvalAuthorized:false,publishEvent:null
  };
  Object.defineProperties(output,{
    staticReportBytes:{enumerable:false,configurable:false,
      get:()=>Buffer.from(report)},
    privateSemanticPlan:{enumerable:false,configurable:false,
      get:()=>localPlan},
    toJSON:{enumerable:false,configurable:false,
      value:()=>({...Object.fromEntries(Object.entries(output)),
        staticReportBytes:'[REDACTED_PRIVATE_REPORT]'})},
    [inspect.custom]:{enumerable:false,configurable:false,
      value:()=> '[ReadOnlyReviewPreflight: PRIVATE REPORT REDACTED; NOT AUTHORIZED]'}
  });
  return Object.freeze(output);
}
