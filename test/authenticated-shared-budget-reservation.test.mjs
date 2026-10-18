import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assessAuthenticatedSharedBudgetReservation}
 from '../scripts/authenticated-shared-budget-reservation.mjs';

test('no RunPod/OpenRouter atomic ledger means real spend never authorized',()=>{
 for(const x of [
  undefined,null,{},true,{verified:true,maySpend:true,consentVerified:true},
  {monthlyCapEur:15,spentUsd:0,runpodUsd:0,openrouterUsd:0,fxEurUsd:1},
  {budgetAuthorized:true,canReserve:true,maySpend:true,
   authenticatedGlobalBudgetVerified:true,ownerConsent:true},
  {receipt:{signed:true,sha256:'a'.repeat(64)},paidPreviousAttempt:false}
 ]){
  const r=assessAuthenticatedSharedBudgetReservation(x);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.verified,false);
  assert.equal(r.maySpend,false);
  assert.equal(r.canReserve,false);
  assert.equal(r.safeToRetryAmbiguousProviderRequest,false);
  assert.equal(r.monthlyCapEur,15);
  assert.ok(Object.isFrozen(r));
 }
});

test('production protected entrypoint denies before opening OpenRouter network',()=>{
 const code=readFileSync(fileURLToPath(
  new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url)),'utf8');
 const idxConsent=code.indexOf('const consent=await fetchAndVerifyOwnerCloudConsent');
 const idxGate=code.indexOf('const budget=assessAuthenticatedSharedBudgetReservation');
 const idxDeny=code.indexOf("deny('CLOUD_SHARED_BUDGET_ATOMIC_RESERVATION_NOT_PROVEN')");
 const idxProvider=code.indexOf('const cloud=await executeCompleteOpenRouterSemanticReview');
 assert.ok(idxConsent>=0&&idxConsent<idxGate&&idxGate<idxDeny&&idxDeny<idxProvider);
 assert.match(code,/budget\.verified!==true\|\|budget\.maySpend!==true/);
 assert.match(code,/authenticatedGlobalBudgetVerified:budget\.verified&&budget\.maySpend/);
 assert.doesNotMatch(code,/authenticatedGlobalBudgetVerified:true/);
 assert.match(code,/stage='SHARED_BUDGET'/);
});

test('no secret or external access in reserved real-budget authorization module',()=>{
 const code=readFileSync(fileURLToPath(
  new URL('../scripts/authenticated-shared-budget-reservation.mjs',import.meta.url)),'utf8');
 assert.doesNotMatch(code,/\bfetch\(|\bwriteFile\(|\bspawn\(|\bexecFile\(/);
 assert.doesNotMatch(code,/GITHUB_TOKEN|OPENROUTER_API_KEY|RUNPOD_API_KEY/);
 assert.equal(assessAuthenticatedSharedBudgetReservation({maySpend:true}).reason,
  'SHARED_RUNPOD_OPENROUTER_ATOMIC_LEDGER_NOT_IMPLEMENTED');
});
