/**
 * Read-only GitHub provenance preflight for shadow budget PROPOSALS.
 * Deliberately separate from Publisher paid workflow / PostgreSQL invoker.
 *
 * Three independently checked GitHub facts:
 *   (1) private PR exact HEAD + expected base and same repository;
 *   (2) 4-hour owner exact-HEAD/model/month private-egress consent;
 *   (3) unique first-attempt public Publisher service comment #62.
 *
 * Only a trusted operator with a read-scoped GitHub App installation token
 * may treat this as evidence; caller-supplied fetchImpl is TEST ONLY.
 * No model calls, no database connection, no prices, no maySpend authority.
 */
import {fetchAndVerifyOwnerCloudConsent}
  from './openrouter-owner-consent.mjs';
import {fetchAndVerifyUniqueOpenRouterServiceRequest}
  from './openrouter-unique-service-request.mjs';

const REPO='deenkids7-dev/deenkids';
const SHA=/^[a-f0-9]{40}$/;
const MODELS=new Set([
  'qwen/qwen3-coder-30b-a3b-instruct',
  'qwen/qwen3.6-35b-a3b',
]);
const MAX_BYTES=128*1024;
const deny=reason=>{throw Error(reason)};
const safe=(body,maxBytes)=>typeof body==='string'&&
  Buffer.byteLength(body,'utf8')<=maxBytes;

async function readBoundedGitHubJson(response){
  if(typeof response?.headers?.get!=='function')deny('SHADOW_GITHUB_RESPONSE_UNTRUSTED');
  const len=response.headers.get('content-length');
  if(len!==null&&(!/^(0|[1-9][0-9]*)$/.test(len)||
     Number(len)>MAX_BYTES)){
    try{Promise.resolve(response.body?.cancel?.()).catch(()=>{})}catch{}
    deny('SHADOW_GITHUB_RESPONSE_TOO_LARGE');
  }
  let text;
  if(typeof response.body?.getReader==='function'){
    const reader=response.body.getReader();
    const chunks=[];
    let size=0,completed=false;
    try{
      for(;;){
        const {done,value}=await reader.read();
        if(done){completed=true;break;}
        if(!(value instanceof Uint8Array))deny('SHADOW_GITHUB_RESPONSE_UNTRUSTED');
        size+=value.byteLength;
        if(size>MAX_BYTES)deny('SHADOW_GITHUB_RESPONSE_TOO_LARGE');
        chunks.push(Buffer.from(value));
      }
      try{text=new TextDecoder('utf-8',{fatal:true})
          .decode(Buffer.concat(chunks,size))}
      catch{deny('SHADOW_GITHUB_RESPONSE_NOT_UTF8')}
    }finally{
      if(!completed)try{Promise.resolve(reader.cancel()).catch(()=>{})}catch{}
      try{reader.releaseLock()}catch{}
    }
  }else{
    if(typeof response.text!=='function')deny('SHADOW_GITHUB_RESPONSE_UNTRUSTED');
    text=await response.text();
  }
  if(!safe(text,MAX_BYTES))deny('SHADOW_GITHUB_RESPONSE_TOO_LARGE');
  let result;
  try{result=JSON.parse(text)}
  catch{deny('SHADOW_GITHUB_RESPONSE_INVALID_JSON')}
  if(!result||typeof result!=='object'||Array.isArray(result))
    deny('SHADOW_GITHUB_RESPONSE_INVALID_JSON');
  return result;
}

export function assessExactPrivateGitHubHead({
  payload,prNumber,expectedHeadSha,
}={}){
  const valid=Number.isSafeInteger(prNumber)&&prNumber>0&&
    prNumber<=2147483647&&
    typeof expectedHeadSha==='string'&&SHA.test(expectedHeadSha)&&
    payload?.number===prNumber&&payload?.state==='open'&&
    payload?.merged===false&&typeof payload?.draft==='boolean'&&
    payload?.head?.sha===expectedHeadSha&&
    payload?.head?.repo?.full_name===REPO&&
    payload?.head?.repo?.fork===false&&
    payload?.base?.repo?.full_name===REPO&&
    payload?.base?.repo?.fork===false&&
    payload?.base?.ref==='master';
  if(!valid)return Object.freeze({
    ok:false,code:'SHADOW_PRIVATE_HEAD_NOT_VERIFIED',maySpend:false,
    mayReserve:false,mayMerge:false,
  });
  return Object.freeze({
    ok:true,headSha:expectedHeadSha,prNumber,
    source:'GITHUB_PRIVATE_PR_SAME_REPO_EXACT_MASTER_HEAD',
    maySpend:false,mayReserve:false,mayMerge:false,
  });
}

export async function fetchAndAssessShadowClaimProvenance({
  prNumber,expectedHeadSha,model,requestCommentId,runAttempt,
  eventName,readToken,now=Date.now(),fetchImpl=globalThis.fetch,
}={}){
  if(!Number.isSafeInteger(prNumber)||prNumber<1||
     prNumber>2147483647||
     typeof expectedHeadSha!=='string'||!SHA.test(expectedHeadSha)||
     !MODELS.has(model)||!Number.isSafeInteger(requestCommentId)||
     requestCommentId<1||eventName!=='issue_comment'||runAttempt!=='1'||
     !Number.isSafeInteger(now)||now<=0||now>8_640_000_000_000_000||
     typeof readToken!=='string'||readToken.length<15||
     !/^[-_A-Za-z0-9.]+$/.test(readToken)||
     typeof fetchImpl!=='function')
    deny('SHADOW_CLAIM_INPUT_UNTRUSTED');

  const url='https://api.github.com/repos/'+REPO+'/pulls/'+prNumber;
  let response;
  try{
    response=await fetchImpl(url,{
      method:'GET',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(12000),
      headers:{Authorization:'Bearer '+readToken,
        Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'reviewer-b-shadow-claim-identity'},
    });
  }catch{deny('SHADOW_PRIVATE_HEAD_GET_FAILED')}
  if(response?.status!==200||response.redirected!==false||
     response.url!==url||
     !/^application\/(?:vnd\.github\+)?json(?:\s*;|$)/i.test(
       response.headers?.get?.('content-type')||''))
    deny('SHADOW_PRIVATE_HEAD_RESPONSE_UNTRUSTED');

  let payload;
  try{payload=await readBoundedGitHubJson(response)}
  catch{deny('SHADOW_PRIVATE_HEAD_CONTENT_UNVERIFIED')}
  const privateHead=assessExactPrivateGitHubHead({
    payload,prNumber,expectedHeadSha});
  if(!privateHead.ok)deny(privateHead.code);

  let consent;
  try{
    consent=await fetchAndVerifyOwnerCloudConsent({
      readToken,prNumber,headSha:expectedHeadSha,model,now,fetchImpl,
    });
  }catch{deny('SHADOW_OWNER_CONSENT_UNVERIFIED')}
  if(consent?.ok!==true||consent?.globalMonthlyBudgetEur!==15||
     consent?.authorizedHead!==expectedHeadSha||
     consent?.authorizedModel!==model)
    deny('SHADOW_OWNER_CONSENT_UNVERIFIED');

  let request;
  try{
    request=await fetchAndVerifyUniqueOpenRouterServiceRequest({
      eventName,runAttempt,prNumber,headSha:expectedHeadSha,
      model,commentId:requestCommentId,fetchImpl,
    });
  }catch{deny('SHADOW_UNIQUE_SERVICE_REQUEST_UNVERIFIED')}
  if(request?.ok!==true||request?.uniqueFirstAttempt!==true||
     request?.requestCommentId!==requestCommentId||
     request?.headSha!==expectedHeadSha||request?.model!==model||
     request?.maySpend!==false)
    deny('SHADOW_UNIQUE_SERVICE_REQUEST_UNVERIFIED');

  // The output is only information for a FUTURE independently authenticated
  // shadow claim writer. It does NOT include price, signed attestation,
  // provider bills, FX, ZDR or database/spend authorization.
  return Object.freeze({
    ok:true,status:'SHADOW_GITHUB_READ_ONLY_PROVENANCE',
    repository:REPO,prNumber,headSha:expectedHeadSha,
    model,serviceCommentId:requestCommentId,
    ownerConsentCommentId:consent.ownerCommentId,
    evidenceMonthUtc:consent.authorizedMonth,
    privateHeadVerified:true,ownerConsentVerified:true,
    uniqueServiceRequestVerified:true,
    estimatedEurAuthenticated:false,providerBillingAuthenticated:false,
    independentReviewVerified:false,mayReserve:false,maySpend:false,
    mayPublish:false,mayMerge:false,
  });
}
