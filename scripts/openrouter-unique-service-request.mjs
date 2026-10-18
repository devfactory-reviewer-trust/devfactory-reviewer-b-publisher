/**
 * OpenRouter Reviewer B: read-only, exact public service request uniqueness.
 *
 * Applies BEFORE any paid operation, even when there is no existing native
 * review. A failed Qwen attempt may be billed, so workflow reruns are DENIED.
 * Only first-run issue_comment events are allowed; workflow_dispatch cannot
 * bypass this check. A second exact PR/HEAD request is never an automatic
 * retry. This is defense in depth and NOT an atomic monetary reservation.
 */
const ISSUE_URL='https://api.github.com/repos/devfactory-reviewer-trust/devfactory-reviewer-b-publisher/issues/62/comments?per_page=100&page=1';
const OWNER='devfactory-reviewer-service',OWNER_ID=340477389;
const COMMAND=/^\/review-b-openrouter ([1-9][0-9]{0,9}) ([0-9a-f]{40}) (qwen\/qwen3-coder-30b-a3b-instruct|qwen\/qwen3\.6-35b-a3b)$/;
const SHA=/^[a-f0-9]{40}$/;
const fail=()=>{throw Error('OR_UNIQUE_SERVICE_REQUEST_NOT_PROVEN')};

export function assessUniqueOpenRouterServiceRequest({
 eventName,runAttempt,prNumber,headSha,model,commentId,comments
}={}){
 if(eventName!=='issue_comment'||runAttempt!=='1'||
    !Number.isSafeInteger(prNumber)||prNumber<1||prNumber>2147483647||
    typeof headSha!=='string'||!SHA.test(headSha)||
    !['qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b'].includes(model)||
    !Number.isSafeInteger(commentId)||commentId<1||
    !Array.isArray(comments)||comments.length<1||comments.length>100)
    return Object.freeze({ok:false,reason:'OR_UNIQUE_SERVICE_REQUEST_NOT_PROVEN'});
 const matches=comments.filter(c=>{
   const parsed=typeof c?.body==='string'?COMMAND.exec(c.body):null;
   return c?.user?.login===OWNER&&c.user.id===OWNER_ID&&
      !!parsed&&Number(parsed[1])===prNumber&&parsed[2]===headSha;
 });
 if(matches.length!==1||matches[0].id!==commentId||
    matches[0].body!==('/review-b-openrouter '+prNumber+' '+headSha+' '+model))
    return Object.freeze({ok:false,reason:'OR_UNIQUE_SERVICE_REQUEST_NOT_PROVEN'});
 return Object.freeze({ok:true,uniqueFirstAttempt:true,
   prNumber,headSha,model,requestCommentId:commentId,
   maySpend:false,mayMerge:false});
}
export async function fetchAndVerifyUniqueOpenRouterServiceRequest({
 eventName,runAttempt,prNumber,headSha,model,commentId,
 fetchImpl=globalThis.fetch
}={}){
 if(typeof fetchImpl!=='function'||eventName!=='issue_comment'||
    runAttempt!=='1'||!Number.isSafeInteger(commentId)||commentId<1)
    fail();
 let response;
 try{
  response=await fetchImpl(ISSUE_URL,{method:'GET',redirect:'error',
   cache:'no-store',signal:AbortSignal.timeout(12000),
   headers:{'Accept':'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'devfactory-openrouter-first-attempt-readonly'}});
 }catch{fail()}
 if(response?.status!==200||response.redirected!==false||
    response.url!==ISSUE_URL||typeof response.headers?.get!=='function'||
    !/^application\/(?:vnd\.github\+)?json(?:\s*;|$)/i.test(
      response.headers.get('content-type')||'')||
    response.headers.get('link')?.includes('rel="next"'))
    fail();
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>128*1024))fail();
 let body;
 try{body=await response.text()}catch{fail()}
 if(Buffer.byteLength(body,'utf8')>128*1024)fail();
 let comments;
 try{comments=JSON.parse(body)}catch{fail()}
 const proof=assessUniqueOpenRouterServiceRequest({
  eventName,runAttempt,prNumber,headSha,model,commentId,comments});
 if(!proof.ok)fail();
 return proof;
}
