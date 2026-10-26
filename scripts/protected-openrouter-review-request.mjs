/**
 * R171 — narrow service-authenticated PUBLIC Publisher issue #62 request.
 * This command never grants private egress, payment, native publication or
 * merge. It only supplies immutable launch parameters to protected MAIN.
 *
 * One comment: /review-b-openrouter <PR> <40hex_HEAD> <allowlisted_Qwen_model>
 * The separate, fresh OWNER consent must still be verified from the PR
 * before any private source is sent to OpenRouter.
 */
import {readFileSync,statSync,appendFileSync} from 'node:fs';
import {EXACT_RECOVERY_COMMAND} from './openrouter-prepay-recovery.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const REPO='devfactory-reviewer-trust/devfactory-reviewer-b-publisher';
const REPO_ID=1412898356, ISSUE=62;
const SERVICE='devfactory-reviewer-service',SERVICE_ID=340477389;
const SHA40=/^[0-9a-f]{40}$/;
const PR=/^[1-9][0-9]{0,9}$/;
const MODELS=Object.freeze([
 'qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b'
]);
const CMD=/^\/review-b-openrouter ([1-9][0-9]{0,9}) ([0-9a-f]{40}) (qwen\/qwen3-coder-30b-a3b-instruct|qwen\/qwen3\.6-35b-a3b)$/;
const deny=()=>{throw Error('CLOUD_REVIEW_REQUEST_INVALID')};
const validPr=v=>typeof v==='string'&&PR.test(v)&&Number(v)<=2147483647;
function vetted({prNumber,headSha,model}){
 if(!validPr(prNumber)||typeof headSha!=='string'||!SHA40.test(headSha)||
    !MODELS.includes(model))deny();
 return Object.freeze({prNumber,headSha,model});
}
export function resolveProtectedOpenRouterReviewRequest({
 eventName,actor,repository,ref,event,
 dispatchPr,dispatchHead,dispatchModel
}={}){
 if(repository!==REPO||ref!=='refs/heads/main'||actor!==SERVICE)deny();
 if(eventName==='workflow_dispatch'){
  return vetted({prNumber:dispatchPr,headSha:dispatchHead,model:dispatchModel});
 }
 if(eventName!=='issue_comment'||!event||
    typeof event!=='object'||Array.isArray(event)||
    event.action!=='created'||
    event.repository?.full_name!==REPO||
    event.repository?.id!==REPO_ID||
    event.issue?.number!==ISSUE||
    Object.hasOwn(event.issue||{},'pull_request')||
    event.comment?.user?.login!==SERVICE||
    event.comment?.user?.id!==SERVICE_ID||
    event.sender?.login!==SERVICE||
    event.sender?.id!==SERVICE_ID||
    !Number.isSafeInteger(event.comment?.id)||
    event.comment.id<1||
    typeof event.comment.body!=='string'||
    event.comment.body.length>170)deny();
 const match=CMD.exec(event.comment.body);
 if(match)return vetted({prNumber:match[1],headSha:match[2],model:match[3]});
 // Only the one audited pre-payment historical failure is eligible for
 // a second, one-shot service-owned recovery command. Readback and the
 // authenticated old GitHub Actions log must still prove no provider POST.
 if(event.comment.body===EXACT_RECOVERY_COMMAND)
   return vetted({prNumber:'955',
    headSha:'dd8bcdfebbfed5e2193c9328930499801ae916b5',
    model:'qwen/qwen3-coder-30b-a3b-instruct'});
 deny();
}
function main(){
 try{
  const e=process.env;
  let event=null;
  if(e.GITHUB_EVENT_NAME==='issue_comment'){
   if(typeof e.GITHUB_EVENT_PATH!=='string'||
      !e.GITHUB_EVENT_PATH.startsWith('/home/runner/work/_temp/'))deny();
   const stat=statSync(e.GITHUB_EVENT_PATH);
   if(!stat.isFile()||stat.size<50||stat.size>128*1024)deny();
   event=JSON.parse(readFileSync(e.GITHUB_EVENT_PATH,'utf8'));
  }
  const result=resolveProtectedOpenRouterReviewRequest({
   eventName:e.GITHUB_EVENT_NAME,
   actor:e.GITHUB_ACTOR,repository:e.GITHUB_REPOSITORY,ref:e.GITHUB_REF,
   event,dispatchPr:e.REVIEWER_B_DISPATCH_PR,
   dispatchHead:e.REVIEWER_B_DISPATCH_HEAD,
   dispatchModel:e.REVIEWER_B_DISPATCH_MODEL
  });
  if(typeof e.GITHUB_OUTPUT!=='string'||
     !e.GITHUB_OUTPUT.startsWith('/home/runner/work/_temp/'))deny();
  appendFileSync(e.GITHUB_OUTPUT,
   'pr_number='+result.prNumber+'\n'+
   'expected_head='+result.headSha+'\n'+
   'model='+result.model+'\n'+
   'verified=true\n'+
   'request_comment_id='+(event===null?'':event.comment.id)+'\n',
   {encoding:'utf8'});
  console.log('PROTECTED_CLOUD_REVIEW_REQUEST_ACCEPTED');
 }catch{
  console.log('PROTECTED_CLOUD_REVIEW_REQUEST_DENIED');
  process.exitCode=1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main();
