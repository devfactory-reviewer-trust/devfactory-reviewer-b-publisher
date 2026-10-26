import test from 'node:test';
import assert from 'node:assert/strict';
import {EXACT_RECOVERY_COMMAND,assessOneTimeRecoveryComments,
 verifyOneTimeRecoveryPrepayEvidence}
 from '../scripts/openrouter-prepay-recovery.mjs';
import {assessUniqueOpenRouterServiceRequest,
 fetchAndVerifyUniqueOpenRouterServiceRequest}
 from '../scripts/openrouter-unique-service-request.mjs';
import {resolveProtectedOpenRouterReviewRequest}
 from '../scripts/protected-openrouter-review-request.mjs';

const HEAD='dd8bcdfebbfed5e2193c9328930499801ae916b5';
const MODEL='qwen/qwen3-coder-30b-a3b-instruct';
const PUBLISHER='devfactory-reviewer-trust/devfactory-reviewer-b-publisher';
const API='https://api.github.com/repos/'+PUBLISHER;
const COMMENT_URL=API+'/issues/62/comments?per_page=100&page=1';
const RUN_URL=API+'/actions/runs/40350809327';
const JOBS_URL=RUN_URL+'/jobs?per_page=100';
const LOG_URL=API+'/actions/jobs/121670017999/logs';
const SIGNED='https://productionresultssa.blob.core.windows.net/logs/download?sig=TEST';
const old={id:6420110835,user:{login:'devfactory-reviewer-service',id:340477389},
 body:'/review-b-openrouter 955 '+HEAD+' '+MODEL,created_at:'2026-10-26T15:35:22Z'};
const fresh={id:6421234567,user:{...old.user},body:EXACT_RECOVERY_COMMAND,
 created_at:'2026-10-26T18:00:00Z'};
const ARG={eventName:'issue_comment',runAttempt:'1',
 prNumber:955,headSha:HEAD,model:MODEL,commentId:fresh.id};
const RUN={id:40350809327,workflow_id:385921562,head_sha:'20f6d9dcf6acea8bd3ac5436fbde4a5a8e9ff2f8',
 event:'issue_comment',run_attempt:1,status:'completed',conclusion:'failure',
 actor:{login:'devfactory-reviewer-service',id:340477389}};
const JOB={id:121670017999,run_id:40350809327,conclusion:'failure',status:'completed',
 steps:[
  {name:'Fetch exact protected PUBLIC publisher source (no untrusted checkout)',conclusion:'success'},
  {name:'Verify exact service-owned cloud request BEFORE PRIVATE credentials',conclusion:'success'},
  {name:'Protected exact-head owner-consented cloud analysis',conclusion:'failure'}
 ]};
const LOG='2026-10-26T15:37:02.9788155Z OPENROUTER_PROTECTED_PREFLIGHT_FAILED_CLOSED\n'+
 '2026-10-26T15:37:02.9788991Z OPENROUTER_PROTECTED_CLOUD_PREFLIGHT_FAILED_CLOSED\n'+
 '##[error]Process completed with exit code 1.\n';
function response(url,content,{status=200,contentType='application/json',
 location=null,authorization=false}={}){
 return {status,redirected:false,url,headers:{get(k){
   if(k==='content-type')return contentType;
   if(k==='location')return location;
   return null;
 }},text:async()=>typeof content==='string'?content:JSON.stringify(content)};
}
function mock({comments=[old,fresh],run=RUN,jobs={total_count:1,jobs:[JOB]},log=LOG,
 logLocation=SIGNED,logContentType='text/plain'}={}){
 const requested=[];
 const fetchImpl=async(url,opts)=>{
  requested.push({url,method:opts.method,authorized:Boolean(opts.headers?.Authorization)});
  if(url===COMMENT_URL)return response(url,comments);
  if(url===RUN_URL)return response(url,run);
  if(url===JOBS_URL)return response(url,jobs);
  if(url===LOG_URL)return response(url,'',{status:302,location:logLocation});
  if(url===logLocation)return response(url,log,{contentType:logContentType});
  throw Error('unexpected URL');
 };
 return {fetchImpl,requested};
}
const args={...ARG,actionsReadToken:'ghu_test_read_only_token_123456789'};
const PUBLISHER_REQUEST={
 eventName:'issue_comment',actor:'devfactory-reviewer-service',
 repository:PUBLISHER,ref:'refs/heads/main',
 event:{action:'created',repository:{full_name:PUBLISHER,id:1412898356},
 issue:{number:62},comment:{id:fresh.id,user:old.user,body:EXACT_RECOVERY_COMMAND},
 sender:old.user}
};
test('unique exact authenticated recovery is only a candidate until old run attestation',()=>{
 const p=assessOneTimeRecoveryComments({comments:[old,fresh],commentId:fresh.id,
  prNumber:955,headSha:HEAD,model:MODEL});
 assert.equal(p.ok,true);
 const candidate=assessUniqueOpenRouterServiceRequest({...ARG,comments:[old,fresh]});
 assert.equal(candidate.ok,true);
 assert.equal(candidate.oneTimeRecoveryCandidate,true);
 assert.equal(candidate.uniqueFirstAttempt,false);
 assert.equal(candidate.maySpend,false);
});
test('fresh service comment parsed as the ONLY supported recovery command',()=>{
 const p=resolveProtectedOpenRouterReviewRequest(PUBLISHER_REQUEST);
 assert.deepEqual(p,{prNumber:'955',headSha:HEAD,model:MODEL});
 for(const body of [EXACT_RECOVERY_COMMAND+'\n',EXACT_RECOVERY_COMMAND+' ',
  EXACT_RECOVERY_COMMAND.replace('955','956'),
  EXACT_RECOVERY_COMMAND.replace('40350809327','40350809328')]){
  assert.throws(()=>resolveProtectedOpenRouterReviewRequest({...PUBLISHER_REQUEST,
   event:{...PUBLISHER_REQUEST.event,
    comment:{...PUBLISHER_REQUEST.event.comment,body}}}),/CLOUD_REVIEW_REQUEST_INVALID/);
 }
});
test('verified GitHub run, exact steps and logs permit one recovery, never merge',async()=>{
 const f=mock();
 const p=await fetchAndVerifyUniqueOpenRouterServiceRequest({...args,fetchImpl:f.fetchImpl});
 assert.equal(p.ok,true);
 assert.equal(p.uniqueFirstAttempt,true);
 assert.equal(p.oneTimeRecoveryVerified,true);
 assert.equal(p.maySpend,false);
 assert.equal(p.mayMerge,false);
 assert.equal(f.requested.length,5);
 assert.ok(f.requested.slice(1,4).every(v=>v.authorized));
 assert.equal(f.requested[4].authorized,false,'signed blob must not receive GitHub token');
});
test('prepay proof separately readable and does not authorize spending',async()=>{
 const p=await verifyOneTimeRecoveryPrepayEvidence({
  apiReadToken:args.actionsReadToken,fetchImpl:mock().fetchImpl});
 assert.equal(p.ok,true);
 assert.equal(p.verifiedPrepaymentFailure,true);
 assert.equal(p.maySpend,false);
});
test('replays, duplicate recovery, provider/model drift or forged actor rejected',async()=>{
 for(const items of [
  [old,fresh,fresh],
  [old,{...fresh,id:fresh.id+1}],
  [old,{...fresh,user:{login:'untrusted',id:340477389}}],
  [old,{...fresh,body:EXACT_RECOVERY_COMMAND.replace('40350809327','40350809328')}],
  [old,{...fresh,body:EXACT_RECOVERY_COMMAND.replace(MODEL,'qwen/qwen3.6-35b-a3b')}],
  [fresh],
  [old,fresh,{...old,id:1234}],
 ]){
  assert.equal(assessOneTimeRecoveryComments({comments:items,commentId:fresh.id,
   prNumber:955,headSha:HEAD,model:MODEL}).ok,false);
 }
 for(const mutation of [{runAttempt:'2'},{eventName:'workflow_dispatch'},
  {actionsReadToken:null},{headSha:'a'.repeat(40)}]){
  await assert.rejects(()=>fetchAndVerifyUniqueOpenRouterServiceRequest({
   ...args,...mutation,fetchImpl:mock().fetchImpl}),/OR_UNIQUE_SERVICE_REQUEST_NOT_PROVEN|OR_PREPAY_RECOVERY_NOT_PROVEN/);
 }
});
test('wrong old run, missing job, missing preflight marker, redirect abuse always deny',async()=>{
 const scenarios=[
  {run:{...RUN,run_attempt:2}},
  {run:{...RUN,head_sha:'f'.repeat(40)}},
  {run:{...RUN,conclusion:'success'}},
  {run:{...RUN,actor:{...RUN.actor,id:999}}},
  {jobs:{total_count:1,jobs:[{...JOB,steps:[{name:'Protected exact-head owner-consented cloud analysis',conclusion:'failure'}]}]}},
  {jobs:{total_count:1,jobs:[{...JOB,conclusion:'success'}]}},
  {log:LOG.replace('PREFLIGHT_FAILED_CLOSED','OPENROUTER_FAILED_CLOSED')},
  {log:LOG+'OPENROUTER_PROTECTED_OPENROUTER_FAILED_CLOSED'},
  {logLocation:'https://attacker.invalid/steal'},
  {logContentType:'text/html'}
 ];
 for(const config of scenarios){
  await assert.rejects(()=>fetchAndVerifyUniqueOpenRouterServiceRequest({
   ...args,fetchImpl:mock(config).fetchImpl}),
   /OR_PREPAY_RECOVERY_NOT_PROVEN/);
 }
});
test('recovery cannot use an ordinary new command and cannot alter other PRs',()=>{
 assert.equal(assessOneTimeRecoveryComments({comments:[old,fresh],commentId:fresh.id,
  prNumber:956,headSha:HEAD,model:MODEL}).ok,false);
 assert.equal(assessUniqueOpenRouterServiceRequest({...ARG,commentId:old.id,
  comments:[old,fresh]}).ok,true,'historical command still uniquely identified, no new event/replay');
 assert.equal(assessUniqueOpenRouterServiceRequest({...ARG,commentId:fresh.id,
  model:'qwen/qwen3.6-35b-a3b',comments:[old,fresh]}).ok,false);
});
