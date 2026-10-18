import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assessAuthenticatedOpenRouterSpendAuthorization}
 from '../scripts/openrouter-only-spend-gate.mjs';

test('OpenRouter-only EUR15 guard never trusts caller assertions or prior consent',()=>{
 for(const evidence of [
  undefined,null,{},true,
  {verified:true,maySpend:true,mayReserve:true},
  {runpodUsd:0,openrouterUsd:0,ownerConsent:true},
  {limitReset:'monthly',providerKeyLimitUsd:1,providerKeyRemainingUsd:1},
  {proof:{signature:'signed-looking',valid:true},priorFailureBilled:false},
  {budgetAuthorized:true,authenticatedGlobalBudgetVerified:true},
 ]){
  const a=assessAuthenticatedOpenRouterSpendAuthorization(evidence);
  assert.equal(a.policy,'reviewer-b-openrouter-only-eur15-v1');
  assert.equal(a.monthlyCapEur,15);
  assert.equal(a.status,'BLOCKED');
  assert.equal(a.verified,false);
  assert.equal(a.maySpend,false);
  assert.equal(a.mayReserve,false);
  assert.equal(a.mayRetryAmbiguousRequest,false);
  assert.ok(Object.isFrozen(a));
 }
});

test('protected entrypoint blocks after owner consent and BEFORE paid inference',()=>{
 const p=readFileSync(fileURLToPath(
  new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url)),'utf8');
 const consent=p.indexOf('const consent=await fetchAndVerifyOwnerCloudConsent');
 const proof=p.indexOf('const budget=assessAuthenticatedOpenRouterSpendAuthorization');
 const block=p.indexOf("deny('CLOUD_OPENROUTER_ONLY_BUDGET_NOT_PROVEN')");
 const network=p.indexOf('const cloud=await executeCompleteOpenRouterSemanticReview');
 assert.ok(consent>=0&&consent<proof&&proof<block&&block<network);
 assert.match(p,/stage='OPENROUTER_BUDGET'/);
 assert.match(p,/budget\.verified\s*!==\s*true\s*\|\|\s*budget\.maySpend\s*!==\s*true/);
 assert.match(p,/authenticatedGlobalBudgetVerified\s*:\s*budget\.verified\s*&&\s*budget\.maySpend/);
 assert.doesNotMatch(p,/authenticatedGlobalBudgetVerified\s*:\s*true/);
 assert.doesNotMatch(p,/assessAuthenticatedSharedBudgetReservation/);
});

test('all RunPod start/read workflow lanes are dead and emergency-stop remains',()=>{
 const base=new URL('../.github/workflows/',import.meta.url);
 for(const name of [
  'runpod-control-bounded-start.yml',
  'runpod-control-readonly-scope-test.yml',
  'runpod-control-readonly-diagnostics.yml',
  'runpod-gpu-readonly-preflight.yml',
 ]){
  const src=readFileSync(fileURLToPath(new URL(name,base)),'utf8');
  assert.match(src,/^\s+if:\s*\$\{\{\s*false\s*\}\}\s*$/m, name);
  assert.doesNotMatch(src,/^\s+if:.*DEVFACTORY_RUNPOD_/m,name);
 }
 const stop=readFileSync(fileURLToPath(
  new URL('runpod-control-stop-and-watchdog.yml',base)),'utf8');
 assert.match(stop,/DEVFACTORY_RUNPOD_STOP_EXACT_R162/);
 assert.match(stop,/DEVFACTORY_RUNPOD_WATCHDOG_ARM_R163/);
});

test('pure single-provider guard never calls a model or grants authority',()=>{
 const s=readFileSync(fileURLToPath(
  new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url)),'utf8');
 assert.doesNotMatch(s,/\b(fetch|spawn|execFile|writeFile|setTimeout)\s*\(/);
 assert.doesNotMatch(s,/RUNPOD_API_KEY|RUNPOD_CONTROL_API_KEY|OPENROUTER_API_KEY/);
});
