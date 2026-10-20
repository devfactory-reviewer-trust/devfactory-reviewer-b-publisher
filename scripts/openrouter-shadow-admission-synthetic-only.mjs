/**
 * TEST-ONLY composition of the read-only GitHub provenance verifier and the
 * PROPOSED PostgreSQL shadow budget ledger. This module is deliberately NOT
 * a service, deployable authorization gate, or actual paid Reviewer B path.
 *
 * The only price-like value admitted is a fixed 15 EUR proposal (entire
 * monthly shadow ceiling), NOT the caller's or provider's estimated cost.
 * There is no option to reduce that bound using untrusted input. Thus, on
 * one month's synthetic ledger, at most one complete shadow claim fits.
 *
 * Only invoke from explicitly enabled synthetic tests with isolated DB and
 * mocked GitHub GET responses. Caller-provided fetch/database dependencies
 * are NOT identities. Never consume this result as billing authorization.
 */
import {fetchAndAssessShadowClaimProvenance}
  from './openrouter-shadow-claim-provenance-readonly.mjs';

const TARGET='deenkids7-dev/deenkids';
const FIXED_SHADOW_MICRO_EUR=15_000_000;
const FIELDS=new Set([
  'prNumber','expectedHeadSha','model','requestCommentId',
  'runAttempt','eventName','readToken','fetchImpl','db',
]);
const fail=reason=>Object.freeze({
  ok:false,reason,recorded:false,shadowReservationOnly:true,
  estimatedEurAuthenticated:false,providerBillingAuthenticated:false,
  mayReserve:false,maySpend:false,mayPublish:false,mayMerge:false,
});
export async function runSyntheticShadowAdmissionOnly(options={}){
  // Deliberate process-level deny for regular CI/protected/main execution.
  // This flag is an offline test guard, NOT caller authentication.
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return fail('SHADOW_SYNTHETIC_TEST_SWITCH_REQUIRED');
  if(!options||typeof options!=='object'||Array.isArray(options)||
     Object.keys(options).some(k=>!FIELDS.has(k))||
     typeof options.db?.query!=='function')
    return fail('SHADOW_UNTRUSTED_INPUT_OR_DB');
  const {prNumber,expectedHeadSha,model,requestCommentId,
    runAttempt,eventName,readToken,fetchImpl,db}=options;
  // The test harness never trusts a caller-chosen clock or accounting month.
  const now=Date.now();
  let evidence;
  try{
    evidence=await fetchAndAssessShadowClaimProvenance({
      prNumber,expectedHeadSha,model,requestCommentId,
      runAttempt,eventName,readToken,now,fetchImpl,
    });
  }catch{
    return fail('SHADOW_GITHUB_PROVENANCE_NOT_ESTABLISHED');
  }
  if(evidence?.ok!==true||evidence.repository!==TARGET||
     evidence.privateHeadVerified!==true||
     evidence.ownerConsentVerified!==true||
     evidence.uniqueServiceRequestVerified!==true||
     evidence.maySpend!==false||evidence.mayReserve!==false||
     evidence.prNumber!==prNumber||
     evidence.headSha!==expectedHeadSha||
     evidence.serviceCommentId!==requestCommentId||
     evidence.model!==model||
     evidence.evidenceMonthUtc!==new Date(now).toISOString().slice(0,7))
    return fail('SHADOW_PROVENANCE_INVARIANTS_NOT_MET');
  // Derive the entire DB row only from freshly checked evidence, never from
  // user-supplied repo, month, run ID, price, quote or claim object.
  const args=[
    TARGET,evidence.prNumber,evidence.headSha,evidence.serviceCommentId,
    evidence.model,'synthetic-'+evidence.serviceCommentId,
    FIXED_SHADOW_MICRO_EUR,
  ];
  let result;
  try{
    result=await db.query(
      'SELECT * FROM reviewer_b_shadow.propose_exposure($1,$2,$3,$4,$5,$6,$7)',
      args,
    );
  }catch{
    return fail('SHADOW_PROPOSAL_DB_UNVERIFIED');
  }
  const row=result?.rows?.[0];
  if(!Array.isArray(result?.rows)||result.rows.length!==1||
     row?.may_spend!==false||
     row?.provider_billing_authenticated!==false||
     typeof row.recorded!=='boolean')
    return fail('SHADOW_PROPOSAL_RESULT_UNVERIFIED');
  return Object.freeze({
    ok:row.recorded===true,
    status:row.recorded===true?
      'SYNTHETIC_SHADOW_PROPOSAL_RECORDED_NOT_SPEND_AUTHORITY':
      'SYNTHETIC_SHADOW_PROPOSAL_DENIED',
    recorded:row.recorded===true,
    shadowReservationOnly:true,
    // Not even a successful row confers a right to reserve *actual*
    // provider exposure: no authenticated invoices or FX exists.
    estimatedEurAuthenticated:false,providerBillingAuthenticated:false,
    mayReserve:false,maySpend:false,mayPublish:false,mayMerge:false,
  });
}
