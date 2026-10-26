import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolveProtectedOpenRouterReviewRequest as resolveCloud}
 from '../scripts/protected-openrouter-review-request.mjs';
import {resolveProtectedReviewRequest as resolveLocal}
 from '../scripts/protected-review-request.mjs';
import {canRunProtectedOpenRouterReview}
 from '../scripts/protected-real-openrouter-review.mjs';

const REPO='devfactory-reviewer-trust/devfactory-reviewer-b-publisher';
const S='devfactory-reviewer-service';
const SH='a'.repeat(40),PR='932',MODEL='qwen/qwen3-coder-30b-a3b-instruct';
const base={eventName:'issue_comment',actor:S,repository:REPO,ref:'refs/heads/main'};
const ev=(changes={})=>({
 action:'created',
 repository:{full_name:REPO,id:1412898356},
 issue:{number:62},
 comment:{id:6200001234,user:{id:340477389,login:S},
  body:'/review-b-openrouter '+PR+' '+SH+' '+MODEL},
 sender:{id:340477389,login:S},
 ...changes
});
test('cloud queue #62 authentic service comment resolves immutable exact inputs',()=>{
 const r=resolveCloud({...base,event:ev()});
 assert.deepEqual(r,{prNumber:PR,headSha:SH,model:MODEL});
 assert.ok(Object.isFrozen(r));
});
test('cloud manual dispatch still requires strict PR, SHA, allowlisted model',()=>{
 const r=resolveCloud({eventName:'workflow_dispatch',actor:S,repository:REPO,
  ref:'refs/heads/main',dispatchPr:PR,dispatchHead:SH,dispatchModel:MODEL});
 assert.deepEqual(r,{prNumber:PR,headSha:SH,model:MODEL});
 for(const x of [
  {dispatchHead:'z'.repeat(40)},
  {dispatchModel:'openrouter/auto'},
  {dispatchPr:'0'},
  {dispatchPr:'932x'},
 ])assert.throws(()=>resolveCloud({eventName:'workflow_dispatch',actor:S,
  repository:REPO,ref:'refs/heads/main',dispatchPr:PR,
  dispatchHead:SH,dispatchModel:MODEL,...x}),/CLOUD_REVIEW_REQUEST_INVALID/);
});
test('cloud request rejects wrong event identity, issue, actor, sender, and PR comments',()=>{
 for(const e of [
  {actor:'deenkids7-dev'},
  {repository:'deenkids7-dev/deenkids'},
  {ref:'refs/heads/feature'},
  {event:ev({action:'edited'})},
  {event:ev({issue:{number:21}})},
  {event:ev({issue:{number:62,pull_request:{url:'x'}}})},
  {event:ev({repository:{full_name:REPO,id:1}})},
  {event:ev({comment:{...ev().comment,user:{login:S,id:10}}})},
  {event:ev({sender:{login:'attacker',id:10}})},
  {event:ev({comment:{...ev().comment,id:1.5}})},
 ]){
  assert.throws(()=>resolveCloud({...base,event:ev(),...e}),/CLOUD_REVIEW_REQUEST_INVALID/);
 }
});
test('cloud request denies extra commands, newlines, local command, other models and oversized PR',()=>{
 const original=ev();
 for(const body of [
  '/review-b '+PR+' '+SH,
  original.comment.body+'\n',
  original.comment.body+' extra',
  '/review-b-openrouter 0 '+SH+' '+MODEL,
  '/review-b-openrouter 2147483648 '+SH+' '+MODEL,
  '/review-b-openrouter '+PR+' '+SH+' openrouter/auto',
  '/review-b-openrouter '+PR+' '+SH+' qwen/qwen3.6-35b-a3b; echo bad',
  '/review-b-openrouter '+PR+' '+SH.toUpperCase()+' '+MODEL,
 ]){
  assert.throws(()=>resolveCloud({...base,event:ev({
   comment:{...original.comment,body}
  })}),/CLOUD_REVIEW_REQUEST_INVALID/);
 }
});
test('cloud command is NOT accepted by existing LOCAL Reviewer B queue #21',()=>{
 const cloudCommand=ev().comment.body;
 assert.throws(()=>resolveLocal({
  eventName:'issue_comment',actor:S,repository:REPO,ref:'refs/heads/main',
  event:ev({issue:{number:21},comment:{...ev().comment,body:cloudCommand}})
 }),/REVIEW_REQUEST_INVALID/);
});
test('cloud context fails closed without parser-verified request; no extra event kind',()=>{
 const e={
  GITHUB_REPOSITORY:REPO,GITHUB_REF:'refs/heads/main',
  GITHUB_EVENT_NAME:'issue_comment',GITHUB_ACTOR:S,
  GITHUB_SHA:'b'.repeat(40),GITHUB_RUN_ID:'4000',GITHUB_RUN_ATTEMPT:'1',
  GITHUB_WORKFLOW_REF:REPO+'/.github/workflows/reviewer-b-private-openrouter.yml@refs/heads/main',
  REVIEWER_B_TARGET_PR:PR,REVIEWER_B_EXPECTED_HEAD:SH,
  REVIEWER_B_OPENROUTER_MODEL:MODEL,
  REVIEWER_B_CLOUD_REQUEST_VERIFIED:'true',
  REVIEWER_B_CLOUD_POLICY_READY:'approved-protected-v1',
  REVIEWER_B_CLOUD_TARGET_REPOSITORY:'deenkids7-dev/deenkids'
 };
 assert.equal(canRunProtectedOpenRouterReview(e),true);
 assert.equal(canRunProtectedOpenRouterReview({...e,GITHUB_EVENT_NAME:'workflow_dispatch'}),true);
 for(const diff of [
  {REVIEWER_B_CLOUD_REQUEST_VERIFIED:undefined},
  {REVIEWER_B_CLOUD_REQUEST_VERIFIED:'false'},
  {REVIEWER_B_CLOUD_POLICY_READY:undefined},
  {GITHUB_ACTOR:'deenkids7-dev'},
  {GITHUB_EVENT_NAME:'pull_request'},
  {GITHUB_REF:'refs/heads/unreviewed'},
  {REVIEWER_B_OPENROUTER_MODEL:'openrouter/auto'},
 ])assert.equal(canRunProtectedOpenRouterReview({...e,...diff}),false);
});
test('protected workflow authenticates strict service request before PRIVATE credentials',()=>{
 const source=readFileSync(fileURLToPath(new URL(
  '../.github/workflows/reviewer-b-private-openrouter.yml',import.meta.url)),'utf8').replace(/\r\n/g,'\n');
 assert.match(source,/issue_comment:\n\s+types: \[created\]/);
 assert.match(source,/github\.event\.issue\.number == 62/);
 assert.doesNotMatch(source,/github\.event\.issue\.number == 21/);
 const request=source.indexOf('node source/scripts/protected-openrouter-review-request.mjs');
 const privateStep=source.indexOf('- name: Protected exact-head owner-consented cloud analysis');
 assert.ok(request>0&&privateStep>request);
 assert.match(source,/REVIEWER_B_CLOUD_REQUEST_VERIFIED: \$\{\{ steps\.cloud_request\.outputs\.verified \}\}/);
 assert.match(source,/environment: reviewer-b-publish/);
 assert.match(source,/^permissions:\n  actions: read(?:\s*#.*)?\n/m);
 assert.match(source,/REVIEWER_B_PUBLISHER_ACTIONS_READ_TOKEN: \$\{\{ github\.token \}\}/);
 assert.doesNotMatch(source,/\b(?:contents|issues|pull-requests|id-token|attestations):\s*write\b/);
 assert.equal((source.match(/^permissions\s*:/gm)||[]).length,1);
 assert.doesNotMatch(source,/^[ \t]+permissions\s*:/m);
 const granted=source.match(/^permissions:\n((?: {2}[^\n]+\n)+)/m)?.[1];
 assert.match(granted||'',/^  actions: read(?:\s*#.*)?\n$/);
 assert.doesNotMatch(source,/\bwrite-all\b/);
 assert.match(source,/cancel-in-progress: false/);
});
