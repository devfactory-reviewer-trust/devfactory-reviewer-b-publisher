import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {canRunProtectedNativeComment,executeNativeCommentOnlyCanary}
  from '../scripts/protected-native-comment-entrypoint.mjs';

const wf=readFileSync(resolve(import.meta.dirname,
  '../.github/workflows/reviewer-b-native-comment-once.yml'),'utf8').replace(/\r\n/g,'\n');
const context=()=>({
 GITHUB_REPOSITORY:'devfactory-reviewer-trust/devfactory-reviewer-b-publisher',
 GITHUB_REF:'refs/heads/main',
 GITHUB_ACTOR:'devfactory-reviewer-service',
 GITHUB_EVENT_NAME:'push',
 GITHUB_SHA:'a'.repeat(40),
 GITHUB_RUN_ID:'38140023698',GITHUB_RUN_ATTEMPT:'1',
 REVIEWER_B_TARGET_PR:'899'
});
test('native COMMENT canary requires fixed service identity and only PR #899',()=>{
 assert.equal(canRunProtectedNativeComment(context()),true);
 for(const patch of [{GITHUB_REPOSITORY:'attacker/repo'},
   {GITHUB_REF:'refs/heads/feature'}, {GITHUB_ACTOR:'deenkids7-dev'},
   {GITHUB_EVENT_NAME:'workflow_dispatch'}, {GITHUB_EVENT_NAME:'pull_request'},
   {REVIEWER_B_TARGET_PR:'898'},{REVIEWER_B_TARGET_PR:'899\nsecret'},
   {GITHUB_SHA:'bad'},{GITHUB_RUN_ID:'1; echo secret'}])
   assert.equal(canRunProtectedNativeComment({...context(),...patch}),false);
});
test('denied context does not call HTTP or even inspect fake PEM',async()=>{
 for(const env of [null,{},[],{...context(),GITHUB_ACTOR:'other'}]){
  let touched=false;
  const result=await executeNativeCommentOnlyCanary({
   env,fetchImpl:async()=>{touched=true;throw Error('SHOULD_NEVER_CALL');}
  });
  assert.deepEqual(result,{ok:false,code:'CONTEXT_DENIED'});
  assert.equal(touched,false);
 }
});
test('no protected PEM means no HTTP, COMMENT or private source read',async()=>{
 let touched=false;
 for(const env of [context(),{...context(),REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM:null}]){
  const result=await executeNativeCommentOnlyCanary({
   env,fetchImpl:async()=>{touched=true;throw Error('SHOULD_NEVER_CALL');}
  });
  assert.deepEqual(result,{ok:false,code:'CREDENTIAL_NOT_PROVISIONED'});
 }
 assert.equal(touched,false);
});
test('invalid protected RSA PEM is sanitized and cannot publish',async()=>{
 let calls=0;
 const result=await executeNativeCommentOnlyCanary({
  env:{...context(),REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM:'PRIVATE_FAKE_KEY_'.repeat(40)},
  fetchImpl:async()=>{calls++;throw Error('SECRET_PRIVATE_PATH');}
 });
 assert.deepEqual(result,{ok:false,code:'NATIVE_COMMENT_PROOF_FAILED'});
 assert.equal(calls,0);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_FAKE_KEY_|SECRET_PRIVATE_PATH/);
});
test('workflow itself contains only an exact one-shot protected canary',()=>{
 assert.match(wf,/^permissions: \{\}\n/m);
 assert.match(wf,/^concurrency:\n  group: reviewer-b-native-comment-only-pr899\n  cancel-in-progress: false\n/m);
 assert.match(wf,/reviewer-b-publish/);
 assert.match(wf,/REVIEWER_B_TARGET_PR: '899'/);
 assert.match(wf,/node scripts\/protected-native-comment-entrypoint\.mjs/);
 assert.doesNotMatch(wf,/pull_request_target:|workflow_run:/);
});
