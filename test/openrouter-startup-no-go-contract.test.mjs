/**
 * Non-authorizing regression contract for REAL protected OpenRouter path.
 * No mock provider "success" can turn this offline CI into a spend grant.
 * Never connects to GitHub, OpenRouter, PostgreSQL or the Runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessAuthenticatedOpenRouterSpendAuthorization as gate}
  from '../scripts/openrouter-only-spend-gate.mjs';

const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const real=file('../scripts/protected-real-openrouter-review.mjs');
const spend=file('../scripts/openrouter-only-spend-gate.mjs');
const sql=file('../sql/reviewer_b_shadow_central_pg_v1.sql');

const assertBlocked=result=>{
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.verified,false);
  assert.equal(result.maySpend,false);
  assert.equal(result.mayReserve,false);
  assert.equal(result.mayRetryAmbiguousRequest,false);
  assert.equal(result.reason,
    'OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED');
  assert.equal(result.monthlyCapEur,15);
  assert.equal(Object.isFrozen(result),true);
};

test('real paid spend gate refuses without evidence',()=>{
  assertBlocked(gate());
});
test('forged billing proof, user consent and fake approval cannot grant spend',()=>{
  for(const f of [
    {verified:true,maySpend:true,mayReserve:true},
    {providerBillingAuthenticated:true,accountCoverageAuthenticated:true,
      fxAuthenticated:true,independentReviewerApproved:true},
    {status:'APPROVED',HUMAN_GO:true,MERGE_GO:true,ZERO_CURSOR_GO:true},
    {verified:true,providerStatements:[{signed:true}],
      monthlyCapEur:15000000},
    {prNumber:73,headSha:'a'.repeat(40),approved:true},
    {retryAmbiguousRequest:true,releaseHeldCharge:true,rolledOver:true},
  ])assertBlocked(gate(f));
});
test('paid real protected path must consume the real gate before model POST',()=>{
  assert.match(real,/from '\.\/openrouter-only-spend-gate\.mjs'/);
  assert.match(real,/assessAuthenticatedOpenRouterSpendAuthorization\(/);
  assert.match(real,/if\(budget\.verified!==true\|\|budget\.maySpend!==true\)/);
  assert.match(real,/deny\('CLOUD_OPENROUTER_ONLY_BUDGET_NOT_PROVEN'\)/);
  const budgetIndex=real.indexOf("stage='OPENROUTER_BUDGET'");
  const modelIndex=real.indexOf("stage='OPENROUTER'");
  assert.ok(budgetIndex>=0&&modelIndex>budgetIndex);
  assert.ok(real.indexOf('executeCompleteOpenRouterSemanticReview({',modelIndex)>
    modelIndex);
});
test('consent and unique service request are not substituted for billing gate',()=>{
  assert.match(real,/fetchAndVerifyOwnerCloudConsent\(/);
  assert.match(real,/fetchAndVerifyUniqueOpenRouterServiceRequest\(/);
  const consent=real.indexOf("stage='CONSENT'");
  const unique=real.indexOf("stage='UNIQUE_REQUEST'");
  const budget=real.indexOf("stage='OPENROUTER_BUDGET'");
  assert.ok(consent>=0&&consent<unique&&unique<budget);
});
test('real paid Publisher is not wired to shadow witness or synthetic ledger',()=>{
  assert.doesNotMatch(real,/openrouter-shadow-(?:audit|witness|billing|provider|evidence|admission|readonly)/);
});
test('shadow ledger does not grant real spend or authenticated billing',()=>{
  assert.match(sql,/may_spend boolean,provider_billing_authenticated boolean/);
  assert.match(sql,/SHADOW_MONTH_NOT_PROVISIONED/);
  assert.match(sql,/SHADOW_DUPLICATE_OR_AMBIGUOUS/);
  assert.match(sql,/FOR UPDATE NOWAIT/);
  assert.match(sql,/READ COMMITTED|read committed/);
  assert.match(sql,/15000000/);
  assert.doesNotMatch(spend,/status:\s*'APPROVED'|maySpend:\s*true/);
});
test('real cost grant remains a deliberate non-implementing stub',()=>{
  assert.match(spend,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.match(spend,/No external provider calls, key reads, state mutations or scheduling/);
  assert.doesNotMatch(spend,/openrouter-shadow-/);
});


/**
 * OpenRouter's documented management GET data is informative but does not
 * authenticate an unbilled/pending liability upper bound or future execution.
 * These are deliberate local adversarial objects, not HTTP requests.
 */
test('management API observations cannot grant budget authorization',()=>{
  assertBlocked(gate({
    managementReadsObserved:true,
    keyListing:{path:'/api/v1/keys',status:200,
      data:[{hash:'a'.repeat(64),usage_monthly:0,disabled:false}]},
    activity:{path:'/api/v1/activity',status:200,
      data:[{date:'2026-10-19',usage:0,requests:0}]},
    credits:{path:'/api/v1/credits',status:200,
      data:{total_credits:100,total_usage:0}},
    verified:true,maySpend:true,
  }));
});
test('default-workspace keys GET cannot certify full workspace inventory',()=>{
  for(const candidate of [
    {workspaceList:['default'],allKeysCovered:true},
    {keyListComplete:true,include_disabled:true,offset:0},
    {workspaces:[{id:'default'}],workspacePaginationExhausted:true},
  ])assertBlocked(gate(candidate));
});
test('last 30 completed UTC days activity cannot prove today or next POST',()=>{
  for(const candidate of [
    {activityRange:'last_30_completed_utc_days',amountPending:0},
    {lastCompletedDay:'2026-10-19',asOfDay:'2026-10-20',
      todayUsageGuaranteedZero:true},
    {activityRequests:0,noUnbilledProviderTraffic:true},
  ])assertBlocked(gate(candidate));
});
test('credit balances and key monthly limits are not global EUR authorization',()=>{
  for(const candidate of [
    {remainingCredits:100.5,currency:'USD',eurRemaining:15},
    {keyLimits:[3,10],keyCurrency:'USD',monthlyCapEur:15},
    {keyAUsageUsd:0,keyBUsageUsd:0,accountWidePendingEur:0},
  ])assertBlocked(gate(candidate));
});
test('post-timeout unknown billing cannot be cleared by zero known charges',()=>{
  for(const candidate of [
    {lastHttpStatus:504,knownChargeUsd:0,providerSettled:true},
    {requestReset:true,mayRetryAmbiguousRequest:true},
    {lastHttpStatus:429,retryAfter:5,mayRetry:true},
    {providerUsageLagSeconds:120,unsettledUpperBoundEur:0},
  ])assertBlocked(gate(candidate));
});
test('disabled and rotated keys can still have unaccounted prior charges',()=>{
  for(const candidate of [
    {disabledKeysExcluded:true,allLiabilitiesSettled:true},
    {lastKeyDeleted:true,knownSpendEur:0},
    {managementKeyPresent:true,inventoryAuthenticated:true},
  ])assertBlocked(gate(candidate));
});
test('unsigned FX and public price tables cannot mint a EUR reservation',()=>{
  for(const candidate of [
    {usdToEurRate:1.0,fxAuthenticated:true,mayReserve:true},
    {modelPricesCurrent:true,maximumOutputTokens:1024,
      worstCaseEur:0.0001,maySpend:true},
    {providerZdr:true,providerBillingAuthenticated:true,
      concurrencyGuaranteed:true},
  ])assertBlocked(gate(candidate));
});
test('owner and Reviewer B approval claims remain separate from spending',()=>{
  for(const candidate of [
    {HUMAN_GO:true,MERGE_GO:true,ZERO_CURSOR_GO:true},
    {independentReviewerState:'APPROVED',headSha:'a'.repeat(40)},
    {ownerConsentVerified:true,model:'qwen/qwen3-coder-30b-a3b-instruct'},
    {serviceRequestUnique:true,firstAttempt:true,maySpend:true},
  ])assertBlocked(gate(candidate));
});
test('cross-month and cross-key simulated exhaustion never rolls credit grant',()=>{
  for(const candidate of [
    {monthUtc:'2026-11',previousMonthOutstandingEur:0,mayReserve:true},
    {allClients:'same-postgres',shadowProposalRecorded:true,
      providerBillingAuthenticated:true},
    {budgetLimitEur:15,accountTotalKnownEur:0,unresolvedUsd:0,
      maySpend:true},
  ])assertBlocked(gate(candidate));
});


/**
 * These enforce the actual real gate after the financial handoff DESIGN.
 * None of the deliberately hypothetical financial envelopes below is
 * provider-signed, independently verified, or allowed to authorize spend.
 */
test('financial handoff contract remains explicitly non-authorizing',()=>{
  const design=file('../docs/OPENROUTER-FINANCIAL-EVIDENCE-ATOMIC-RESERVATION-HANDOFF-20261020.md');
  for(const text of [
    'devfactory.financial-evidence.v0',
    'devfactory.financial-reservation.v0',
    'AMBIGUOUS_HOLD',
    'NO-GO SPEND / NO-GO MERGE / NO-GO DEPLOY / NO-GO RUNNER',
    '**not** an implemented OpenRouter management client',
    '15_000_000 micro-EUR',
  ])assert.ok(design.includes(text),text);
  assert.match(design,/COMMIT/);
});
test('signed-looking evidence envelopes alone cannot grant reserve or spend',()=>{
  for(const signed of [
    {schema:'devfactory.financial-evidence.v0',verified:true,
      providerBillingAuthenticated:true,keyInventoryAuthenticated:true,
      operatorSignature:'pretend-signature'},
    {schema:'devfactory.financial-reservation.v0',
      reservationRecorded:true,quote_upper_micro_eur:15000000,
      maySpend:true,authorized:true},
    {providerManagementGETStatus:200,signedProviderInvoice:true,
      accountScopeDigest:'f'.repeat(64)},
  ])assertBlocked(gate(signed));
});
test('stale evidence watermarks and current-day blind spot never authorize',()=>{
  for(const snapshot of [
    {expiredAtUtc:'2026-10-20T00:00:00Z',asOf:'2026-10-20T20:00:00Z',
      verified:true},
    {lastCompletedUtcDay:'2026-10-19',currentUtcDayUnbilledEur:0,
      mayReserve:true},
    {watermark:'provider-unverified',clockTrusted:true,
      billingLagUpperEur:0},
  ])assertBlocked(gate(snapshot));
});
test('unknown provider results and late charges remain in financial quarantine',()=>{
  for(const payload of [
    {httpStatus:504,attemptUnknown:true,zeroChargesObserved:true,
      mayRetryAmbiguousRequest:true},
    {httpStatus:200,chargeSettled:false,holdReleased:true,
      maySpend:true},
    {billingMonth:'2026-09',lateChargeEur:12,
      currentMonthAvailableEur:15,mayReserve:true},
  ])assertBlocked(gate(payload));
});
test('two clients falsely claiming a durable reservation cannot mint permission',()=>{
  for(const payload of [
    {twoKeys:['development','reviewer_b'],bothReserved:true,
      sharedLockProven:true,maySpend:true},
    {atomicLedgerRecorded:true,transactionCommitted:true,
      releaseFenceAuthenticated:true,mayReserve:true},
    {providerBudgetUsdRemaining:200,
      centralReserveMicroEur:100,dbRole:'reviewer_b_shadow_invoker_v1'},
  ])assertBlocked(gate(payload));
});
test('identity replay, lost commit reply and UTC rollover do not grant retry',()=>{
  for(const payload of [
    {duplicateCommentId:true,requestIdentityUnique:true,maySpend:true},
    {commitReplyLost:true,assumeRolledBack:true,
      retryAmbiguousRequest:true},
    {beforeMonthUtc:'2026-10',afterMonthUtc:'2026-11',
      priorMonthExposureZero:true,mayReserve:true},
    {shaBoundApproval:'a'.repeat(40),currentSHA:'b'.repeat(40),
      independentReviewerApproved:true},
  ])assertBlocked(gate(payload));
});
test('production-paid path does not import design or a synthetic producer',()=>{
  const forbidden=/openrouter-shadow-(?:billing|fx|provider|evidence|audit|witness|readonly|admission)|OPENROUTER-FINANCIAL-EVIDENCE-ATOMIC-RESERVATION-HANDOFF/;
  assert.doesNotMatch(real,forbidden);
  assert.doesNotMatch(spend,forbidden);
  assert.match(real,/if\(budget\.verified!==true\|\|budget\.maySpend!==true\)/);
});
test('shadow SQL reserves proposals only and denies spend in function contract',()=>{
  assert.match(sql,/FOR UPDATE NOWAIT/);
  assert.match(sql,/SHADOW_DUPLICATE_OR_AMBIGUOUS/);
  assert.match(sql,/provider_billing_authenticated boolean/);
  assert.match(sql,/may_spend boolean/);
  assert.doesNotMatch(sql,/may_spend\s*=\s*true/);
  assert.doesNotMatch(spend,/maySpend\s*:\s*true/);
});

test('post-inference consent refresh is checked before native write',()=>{
  const start=real.indexOf("stage='CONSENT_REFRESH'");
  const write=real.indexOf("stage='WRITE'");
  const native=real.indexOf("stage='NATIVE'");
  assert.ok(start>=0&&write>start&&native>write);
  const block=real.slice(start,write);
  assert.match(block,/const refreshedConsent=await fetchAndVerifyOwnerCloudConsent\(/);
  assert.match(block,/if\(refreshedConsent\?\.ok!==true\|\|/);
  assert.match(block,/refreshedConsent\.globalMonthlyBudgetEur!==15\)/);
  assert.match(block,/deny\('CLOUD_OWNER_CONSENT_REFRESH_REJECTED'\)/);
  assert.ok(real.indexOf('publishRealSemanticComment({',native)>native);
});
test('failed refreshed consent has no fallback publication or spend exception',()=>{
  assert.match(real,/stage='CONSENT_REFRESH'/);
  assert.match(real,/CLOUD_OWNER_CONSENT_REFRESH_REJECTED/);
  assert.match(real,/stage='CONSENT_REFRESH'[\s\S]*?deny\('CLOUD_OWNER_CONSENT_REFRESH_REJECTED'\);[\s\S]*?stage='WRITE'/);
  assert.match(real,/catch\(error\) \{[\s\S]*?CLOUD_[\s\S]*?_FAILED_CLOSED/);
  assertBlocked(gate({refreshedConsent:{ok:true,
    globalMonthlyBudgetEur:15},maySpend:true}));
});
