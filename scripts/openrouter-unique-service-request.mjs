/**
 * Reviewer B: bounded read-only proof against paid Qwen duplicate attempts.
 * First issue_comment run only; later/manual/repeated attempts are rejected.
 * Old failed provider calls may have been billed without publishing a review.
 * This is defense in depth, NOT a monetary reservation or spend permit.
 */
const URL_BASE='https://api.github.com/repos/devfactory-reviewer-trust/devfactory-reviewer-b-publisher/issues/62/comments?per_page=100&page=';
const SERVICE='devfactory-reviewer-service',SERVICE_ID=340477389;
const CMD=/^\/review-b-openrouter ([1-9][0-9]{0,9}) ([0-9a-f]{40}) (qwen\/qwen3-coder-30b-a3b-instruct|qwen\/qwen3\.6-35b-a3b)$/;
const SHA=/^[a-f0-9]{40}$/;
const MAX_PAGES=20, PAGE_SIZE=100, MAX_BYTES=128*1024;
const deny=()=>{throw Error('OR_UNIQUE_SERVICE_REQUEST_NOT_PROVEN')};
const ALLOWED_ISSUE_PATHS=Object.freeze([
 '/repos/devfactory-reviewer-trust/devfactory-reviewer-b-publisher/issues/62/comments',
 '/repositories/1412898356/issues/62/comments',
]);
function allowedNextPageLink(raw,page){
 try{
  const u=new URL(raw);
  return u.origin==='https://api.github.com'&&
   u.username===''&&u.password===''&&u.hash===''&&
   ALLOWED_ISSUE_PATHS.includes(u.pathname)&&
   u.searchParams.size===2&&
   u.searchParams.getAll('page').length===1&&
   u.searchParams.getAll('per_page').length===1&&
   u.searchParams.get('page')===String(page+1)&&
   u.searchParams.get('per_page')==='100';
 }catch{return false}
}

export function assessUniqueOpenRouterServiceRequest({
 eventName,runAttempt,prNumber,headSha,model,commentId,comments
}={}){
 if(eventName!=='issue_comment'||runAttempt!=='1'||
    !Number.isSafeInteger(prNumber)||prNumber<1||prNumber>2147483647||
    typeof headSha!=='string'||!SHA.test(headSha)||
    !['qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b'].includes(model)||
    !Number.isSafeInteger(commentId)||commentId<1||
    !Array.isArray(comments)||comments.length<1||
    comments.length>MAX_PAGES*PAGE_SIZE)
    return Object.freeze({ok:false,reason:'OR_UNIQUE_SERVICE_REQUEST_NOT_PROVEN'});
 const matches=comments.filter(c=>{
   const match=typeof c?.body==='string'?CMD.exec(c.body):null;
   return c?.user?.login===SERVICE&&c?.user?.id===SERVICE_ID&&
      !!match&&Number(match[1])===prNumber&&match[2]===headSha;
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
    deny();
 const all=[];
 let complete=false;
 for(let page=1;page<=MAX_PAGES;page++){
  const url=URL_BASE+page;
  let r;
  try{
   r=await fetchImpl(url,{method:'GET',redirect:'error',
    cache:'no-store',signal:AbortSignal.timeout(12000),
    headers:{Accept:'application/vnd.github+json',
     'X-GitHub-Api-Version':'2022-11-28',
     'User-Agent':'devfactory-openrouter-first-attempt-readonly'}});
  }catch{deny()}
  if(r?.status!==200||r.redirected!==false||r.url!==url||
     typeof r.headers?.get!=='function'||
     !/^application\/(?:vnd\.github\+)?json(?:\s*;|$)/i.test(
       r.headers.get('content-type')||''))deny();
  const size=r.headers.get('content-length');
  if(size!==null&&(!/^\d+$/.test(size)||Number(size)>MAX_BYTES))deny();
  let raw;
  try{raw=await r.text()}catch{deny()}
  if(Buffer.byteLength(raw,'utf8')>MAX_BYTES)deny();
  let items;
  try{items=JSON.parse(raw)}catch{deny()}
  if(!Array.isArray(items)||items.length>PAGE_SIZE)deny();
  all.push(...items);
  const link=r.headers.get('link')||'';
  if(typeof link!=='string'||link.length>8192)deny();
  // GitHub Link can use repo name or canonical numeric repo ID. Parse
  // both strict same-repo URLs and only the exact NEXT page; no redirects
  // and never fetch a server-supplied URL directly.
  const mentionsNext=/\brel\s*=\s*"?next\b/i.test(link);
  const next=link.split(',').map(s=>s.trim()).filter(s=>
    /;\s*rel\s*=\s*"?next"?(?=\s*(?:;|$))/i.test(s));
  if(mentionsNext!==Boolean(next.length))deny();
  if(!mentionsNext){complete=true;break;}
  const nextUrl=next[0]?.match(/<([^<>]+)>/)?.[1];
  if(next.length!==1||!allowedNextPageLink(nextUrl,page)||
     page===MAX_PAGES||items.length!==PAGE_SIZE)deny();
 }
 if(!complete)deny();
 const assessment=assessUniqueOpenRouterServiceRequest({
  eventName,runAttempt,prNumber,headSha,model,commentId,comments:all});
 if(!assessment.ok)deny();
 return assessment;
}
