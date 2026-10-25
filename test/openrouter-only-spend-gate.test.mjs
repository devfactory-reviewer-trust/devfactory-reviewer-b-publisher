import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assessAuthenticatedOpenRouterSpendAuthorization}
 from '../scripts/openrouter-only-spend-gate.mjs';

test('OpenRouter-native 3 USD guard never trusts caller assertions or prior consent',()=>{
 for(const evidence of [
  undefined,null,{},true,
  {verified:true,maySpend:true,mayReserve:true},
  {runpodUsd:0,openrouterUsd:0,ownerConsent:true},
  {limitReset:'monthly',providerKeyLimitUsd:1,providerKeyRemainingUsd:1},
  {proof:{signature:'signed-looking',valid:true},priorFailureBilled:false},
  {budgetAuthorized:true,authenticatedGlobalBudgetVerified:true},
 ]){
  const a=assessAuthenticatedOpenRouterSpendAuthorization(evidence);
  assert.equal(a.policy,'reviewer-b-openrouter-native-cap-usd3-v1');
  assert.equal(a.monthlyCapUsd,3);
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

test('pure single-provider gate performs no network call and contains no raw secrets',()=>{
 const s=readFileSync(fileURLToPath(
  new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url)),'utf8');
 assert.doesNotMatch(s,/\b(fetch|spawn|execFile|writeFile|setTimeout)\s*\(/);
 assert.doesNotMatch(s,/RUNPOD_API_KEY|RUNPOD_CONTROL_API_KEY|OPENROUTER_API_KEY/);
});

test('native 3 USD Reviewer B attestation authorizes only verified first-attempt scope',async()=>{
 const K='sk-or-synthetic_123456789_abcdefghijkl';
 const model='qwen/qwen3-coder-30b-a3b-instruct';
 const {preflightOpenRouterKey}=await import('../scripts/openrouter-zdr-executor.mjs');
 const network=async(url,options)=>{
  assert.equal(options.method,'GET');
  let data;
  if(url==='https://openrouter.ai/api/v1/key')
   data={data:{limit:3,limit_reset:'monthly',limit_remaining:2.9,usage_monthly:0.1}};
  else if(url==='https://openrouter.ai/api/v1/models?zdr=true')
   data={data:[{id:model,supported_parameters:['structured_outputs'],
    pricing:{prompt:'0.00000007',completion:'0.00000028'}}]};
  else throw Error('UNEXPECTED_PAID_OR_UNTRUSTED_ENDPOINT');
  return {status:200,url,redirected:false,
   headers:new Headers({'content-type':'application/json'}),
   body:new Response(JSON.stringify(data)).body};
 };
 const p=await preflightOpenRouterKey({apiKey:K,model,fetchImpl:network});
 const args={apiKey:K,preflight:p,model,prNumber:941,headSha:'a'.repeat(40),
  consentVerified:true,uniqueFirstAttempt:true,now:Date.now()};
 const allowed=assessAuthenticatedOpenRouterSpendAuthorization(args);
 assert.equal(allowed.status,'AUTHORIZED_NATIVE_CAP');
 assert.equal(allowed.verified,true);
 assert.equal(allowed.maySpend,true);
 assert.equal(allowed.monthlyCapUsd,3);
 assert.equal(allowed.mayRetryAmbiguousRequest,false);
 for(const changes of [
  {preflight:{...p}},{apiKey:K+'other'},{consentVerified:false},
  {uniqueFirstAttempt:false},{prNumber:0},{headSha:'bad'},
  {model:'qwen/qwen3.6-35b-a3b'}
 ]){
  const blocked=assessAuthenticatedOpenRouterSpendAuthorization({...args,...changes});
  assert.equal(blocked.maySpend,false);
  assert.equal(blocked.verified,false);
 }
});
