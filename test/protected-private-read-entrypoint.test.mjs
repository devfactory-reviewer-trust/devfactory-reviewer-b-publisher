import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {approvedReadOnlyExecutionContext,executeProtectedReadOnlyPreflight,
  assessProtectedReadOnlyResult}
  from '../scripts/protected-private-read-entrypoint.mjs';
const workflow=readFileSync(resolve(import.meta.dirname,
 '../.github/workflows/reviewer-b-private-readonly-preflight.yml'),'utf8').replace(/\r\n/g,'\n');
const context=()=>({
 GITHUB_REPOSITORY:'devfactory-reviewer-trust/devfactory-reviewer-b-publisher',
 GITHUB_REF:'refs/heads/main',
 GITHUB_ACTOR:'devfactory-reviewer-service',
 GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_SHA:'a'.repeat(40),
 GITHUB_RUN_ID:'123456789',GITHUB_RUN_ATTEMPT:'1',
 REVIEWER_B_TARGET_PR:'898'
});
test('manual, actor, protected branch and immutable identity are required',()=>{
 assert.equal(approvedReadOnlyExecutionContext(context()),true);
 const patches=[
  {GITHUB_REPOSITORY:'attacker/public'},
  {GITHUB_REF:'refs/heads/feature'},
  {GITHUB_ACTOR:'deenkids7-dev'},
  {GITHUB_EVENT_NAME:'pull_request'},
  {GITHUB_SHA:'bad'},
  {GITHUB_RUN_ID:'1; echo secret'},
  {GITHUB_RUN_ATTEMPT:'0'},
  {REVIEWER_B_TARGET_PR:'../898'},
  {REVIEWER_B_TARGET_PR:'0'},
  {REVIEWER_B_TARGET_PR:'2147483648'}
 ];
 for(const patch of patches)
  assert.equal(approvedReadOnlyExecutionContext({...context(),...patch}),false);
});
test('one-shot push accepts only exact protected PR #899 and service actor',()=>{
 const canary={...context(),GITHUB_EVENT_NAME:'push',REVIEWER_B_TARGET_PR:'899'};
 assert.equal(approvedReadOnlyExecutionContext(canary),true);
 for(const patch of [{REVIEWER_B_TARGET_PR:'898'},{GITHUB_ACTOR:'deenkids7-dev'},
   {GITHUB_REF:'refs/heads/feature'},{GITHUB_REPOSITORY:'other/public'},
   {GITHUB_EVENT_NAME:'pull_request'}])
   assert.equal(approvedReadOnlyExecutionContext({...canary,...patch}),false);
});
test('service issue command requires a valid pinned head in protected context',()=>{
 const cmd={...context(),GITHUB_EVENT_NAME:'issue_comment',
   REVIEWER_B_TARGET_PR:'901',REVIEWER_B_EXPECTED_HEAD:'b'.repeat(40)};
 assert.equal(approvedReadOnlyExecutionContext(cmd),true);
 for(const patch of [
   {GITHUB_ACTOR:'deenkids7-dev'},
   {REVIEWER_B_EXPECTED_HEAD:null},
   {REVIEWER_B_EXPECTED_HEAD:''},
   {REVIEWER_B_EXPECTED_HEAD:'A'.repeat(40)},
   {REVIEWER_B_TARGET_PR:'0'}
 ])assert.equal(approvedReadOnlyExecutionContext({...cmd,...patch}),false);
});
test('explicit null and invalid context never throw or access ambient credentials',async()=>{
 for(const invalid of [null,undefined,[],true,'text',42]){
  assert.equal(approvedReadOnlyExecutionContext(invalid),false);
  assert.deepEqual(await executeProtectedReadOnlyPreflight(invalid),{
   code:'CONTEXT_DENIED',ok:false
  });
  assert.deepEqual(await executeProtectedReadOnlyPreflight({env:invalid}),{
   code:'CONTEXT_DENIED',ok:false
  });
 }
});
test('null options with a valid protected context are denied before PEM access',async()=>{
 const values=[{...context(),REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM:null},context()];
 for(const env of values){
  const result=await executeProtectedReadOnlyPreflight({env,fetchImpl:null});
  assert.equal(result.code,'CREDENTIAL_NOT_PROVISIONED');
  assert.equal(result.ok,false);
 }
});
test('malformed or contradictory dependency proof cannot claim release',()=>{
 for(const result of [null,undefined,0,[],{}, {approvalAuthorized:false,
    publishEvent:null,independentReviewVerified:false,
    blockingFindings:'0',staticDisposition:'INCONCLUSIVE'},
    {approvalAuthorized:false,publishEvent:null,independentReviewVerified:false,
    blockingFindings:0,staticDisposition:'FAIL'},
    {approvalAuthorized:false,publishEvent:null,independentReviewVerified:false,
    blockingFindings:1,staticDisposition:'INCONCLUSIVE'}]){
   const verdict=assessProtectedReadOnlyResult(result);
   assert.equal(verdict.code,'READ_PROOF_FAILED');
   assert.equal(verdict.ok,false);
 }
 const unauthorized=assessProtectedReadOnlyResult({
   approvalAuthorized:true,publishEvent:'APPROVE',
   independentReviewVerified:false,blockingFindings:0,
   staticDisposition:'INCONCLUSIVE'
 });
 assert.deepEqual(unauthorized,{code:'FORBIDDEN_AUTHORITY',ok:false});
 assert.deepEqual(assessProtectedReadOnlyResult({
   approvalAuthorized:false,publishEvent:null,
   independentReviewVerified:false,blockingFindings:0,
   staticDisposition:'INCONCLUSIVE'
 }),{code:'INCONCLUSIVE_NOT_REVIEWED',ok:true,reviewApproved:false});
 assert.deepEqual(assessProtectedReadOnlyResult({
   approvalAuthorized:false,publishEvent:null,
   independentReviewVerified:false,blockingFindings:1,
   staticDisposition:'FAIL'
 }),{code:'STATIC_FINDINGS_BLOCK',ok:false,reviewApproved:false});
});
test('no secret refuses and invokes neither HTTP nor model',async()=>{
 let calls=0;
 const result=await executeProtectedReadOnlyPreflight({
  env:context(),fetchImpl:async()=>{calls++;throw Error('forbidden');}
 });
 assert.deepEqual(result,{code:'CREDENTIAL_NOT_PROVISIONED',ok:false});
 assert.equal(calls,0);
});
test('malformed key is sanitized; no private failure reason leaks',async()=>{
 const result=await executeProtectedReadOnlyPreflight({
  env:{...context(),REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM:'fake'.repeat(80)},
  fetchImpl:async()=>{throw Error('never include token: SENSITIVE_VALUE');}
 });
 assert.deepEqual(result,{code:'READ_PROOF_FAILED',ok:false});
 assert.ok(!JSON.stringify(result).includes('SENSITIVE_VALUE'));
});
test('failed identity cannot even attempt to parse private credentials',async()=>{
 const result=await executeProtectedReadOnlyPreflight({
  env:{...context(),GITHUB_ACTOR:'other',
    REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM:'fake'.repeat(80)},
  fetchImpl:async()=>{throw Error('MUST_NOT_CALL_NETWORK');}
 });
 assert.deepEqual(result,{code:'CONTEXT_DENIED',ok:false});
});
test('protected workflow triggers only from main and a fixed actor',()=>{
 assert.match(workflow,/^on:\n  workflow_dispatch:/m);
 assert.match(workflow,/environment:\s*reviewer-b-publish/);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/github\.actor == 'devfactory-reviewer-service'/);
 assert.match(workflow,/github\.repository == 'devfactory-reviewer-trust\/devfactory-reviewer-b-publisher'/);
 assert.match(workflow,/github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'/);
 assert.match(workflow,/^  push:\n    branches:\n      - main\n    paths:\n      - docs\/reviewer-b-private-read-once-20261011\.marker\n/m);
 assert.match(workflow,/REVIEWER_B_TARGET_PR: \$\{\{ github\.event_name == 'push' && '899' \|\| inputs\.pr_number \}\}/);
 assert.match(workflow,/^permissions: \{\}\n/m);
 assert.doesNotMatch(workflow,/(?:GH_READ_TOKEN|github\.token|Authorization: Bearer)/);
 assert.match(workflow,/--proto '=https' --proto-redir '=https'/);
 assert.match(workflow,/--max-time 45 --max-filesize 8388608/);
 assert.doesNotMatch(workflow,/\b(?:pull_request_target|workflow_run|schedule)\s*:/);
 assert.doesNotMatch(workflow,/\b[A-Za-z-]+\s*:\s*write\b/);
 assert.doesNotMatch(workflow,/\b(?:actions\/checkout|secrets\.GITHUB_TOKEN|id-token|attestations)\b/);
});
test('only one protected PEM secret and no PR source checkout or GitHub reviews',()=>{
 assert.equal((workflow.match(/secrets\./g)||[]).length,1);
 assert.match(workflow,/secrets\.REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM/);
 assert.match(workflow,/tarball\/\$\{GH_SHA\}/);
 assert.doesNotMatch(workflow,/(?:POST|PATCH|PUT|DELETE)\s+https:\/\/api\.github\.com/);
 assert.doesNotMatch(workflow,/\b(?:merg|approve|review POST|curl -X)\b/i);
});
