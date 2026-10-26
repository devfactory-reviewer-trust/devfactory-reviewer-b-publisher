/**
 * Explicit owner consent for PRIVATE code egress + native $13 split ($10/$3).
 * A workflow dispatch/service actor is NOT sufficient. The user must first
 * post a fresh exact-HEAD, model, month-bound comment as repository OWNER.
 * No code, keys or bearer tokens are ever returned or logged.
 */
const REPO='deenkids7-dev/deenkids';
const OWNER='deenkids7-dev',OWNER_ID=297379913;
const SHA40=/^[0-9a-f]{40}$/;
const MONTH=/^20[2-9][0-9]-(0[1-9]|1[0-2])$/;
const deny=c=>{throw Error(c)};
const MSG=(pr,head,model,month)=>
 '/devfactory-openrouter-consent '+pr+' '+head+' '+model+' '+month+' budget13usd';
// Legacy exact-head authorization remains immutable. A fresh, separately
// posted renewal is accepted for the ONE audited pre-payment recovery only.
const RECOVERY=Object.freeze({prNumber:955,
 headSha:'dd8bcdfebbfed5e2193c9328930499801ae916b5',
 model:'qwen/qwen3-coder-30b-a3b-instruct',month:'2026-10',
 abortedRunId:40350809327});
const RENEW=(pr,head,model,month)=>
 '/devfactory-openrouter-consent-renew '+pr+' '+head+' '+model+' '+month+
 ' budget13usd abort'+RECOVERY.abortedRunId;
const API='https://api.github.com/repos/'+REPO+'/issues/';
const MAX_BYTES=128*1024;
export function assessOwnerCloudConsent({items,prNumber,headSha,model,month,now}={}){
 if(!Number.isSafeInteger(prNumber)||prNumber<1||prNumber>2147483647||
    typeof headSha!=='string'||!SHA40.test(headSha)||
    !['qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b'].includes(model)||
    !MONTH.test(month)||!Number.isFinite(now)||
    !Array.isArray(items)||items.length>100)
    return Object.freeze({ok:false,reason:'OR_CONSENT_SCOPE_INVALID'});
 const expected=MSG(prNumber,headSha,model,month);
 const matching=items.filter(c=>c?.body===expected);
 if(matching.length!==1)
    return Object.freeze({ok:false,reason:'OR_CONSENT_MISSING_OR_DUPLICATE'});
 const original=matching[0],originalCreated=Date.parse(original?.created_at);
 const authenticatedOwner=c=>Number.isSafeInteger(c?.id)&&c.id>0&&
   c.user?.login===OWNER&&c.user?.id===OWNER_ID;
 if(!authenticatedOwner(original)||!Number.isFinite(originalCreated)||
    originalCreated>now+60_000||
    new Date(now).toISOString().slice(0,7)!==month)
    return Object.freeze({ok:false,reason:'OR_CONSENT_OWNER_OR_FRESHNESS_UNVERIFIED'});
 let c=original;
 const recoveryScope=prNumber===RECOVERY.prNumber&&headSha===RECOVERY.headSha&&
   model===RECOVERY.model&&month===RECOVERY.month;
 if(recoveryScope){
   const renewals=items.filter(v=>v?.body===RENEW(prNumber,headSha,model,month));
   if(renewals.length>1)
     return Object.freeze({ok:false,reason:'OR_CONSENT_RENEWAL_DUPLICATE'});
   if(renewals.length===1){
     const renewal=renewals[0],time=Date.parse(renewal?.created_at);
     if(!authenticatedOwner(renewal)||!Number.isFinite(time)||
        time<=originalCreated||time>now+60_000)
       return Object.freeze({ok:false,reason:'OR_CONSENT_RENEWAL_UNTRUSTED'});
     c=renewal;
   }
 }
 const created=Date.parse(c?.created_at);
 if(now-created>4*60*60*1000)
   return Object.freeze({ok:false,reason:'OR_CONSENT_OWNER_OR_FRESHNESS_UNVERIFIED'});
 return Object.freeze({ok:true,authorizedPr:prNumber,authorizedHead:headSha,
  authorizedModel:model,authorizedMonth:month,globalMonthlyBudgetUsd:13,
  ownerCommentId:c.id,independentReviewVerified:false,mayMerge:false});
}
export async function fetchAndVerifyOwnerCloudConsent({
 readToken,prNumber,headSha,model,now=Date.now(),fetchImpl=fetch
}={}){
 if(typeof readToken!=='string'||readToken.length<15||
    /[^-_A-Za-z0-9.]/.test(readToken)||
    !Number.isSafeInteger(prNumber)||prNumber<1||
    !SHA40.test(headSha)||typeof fetchImpl!=='function')
    deny('OR_CONSENT_READ_SCOPE_DENIED');
 const month=new Date(now).toISOString().slice(0,7);
 const url=API+prNumber+'/comments?per_page=100&page=1';
 let response;
 try{
  response=await fetchImpl(url,{method:'GET',redirect:'error',
   cache:'no-store',signal:AbortSignal.timeout(15000),
   headers:{Authorization:'Bearer '+readToken,Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'devfactory-reviewer-b-openrouter-consent'}});
 }catch{deny('OR_CONSENT_READ_NETWORK_FAILED')}
 if(response?.status!==200||response.redirected!==false||response.url!==url||
    typeof response.headers?.get!=='function'||
    !/^application\/(?:vnd\.github\+)?json(?:\s*;|$)/i.test(
      response.headers.get('content-type')||'')||
    response.headers.get('link')?.includes('rel="next"'))
    deny('OR_CONSENT_READ_UNVERIFIED');
 const reported=response.headers.get('content-length');
 if(reported!==null&&(!/^\d+$/.test(reported)||Number(reported)>MAX_BYTES))
    deny('OR_CONSENT_READ_TOO_LARGE');
 let raw;
 try{raw=await response.text()}catch{deny('OR_CONSENT_READ_FAILED')}
 if(Buffer.byteLength(raw,'utf8')>MAX_BYTES)deny('OR_CONSENT_READ_TOO_LARGE');
 let comments;
 try{comments=JSON.parse(raw)}catch{deny('OR_CONSENT_READ_INVALID_JSON')}
 const result=assessOwnerCloudConsent({
  items:comments,prNumber,headSha,model,month,now
 });
 if(!result.ok)deny(result.reason);
 return result;
}
export {MSG as formatExactOwnerCloudConsent,
 RENEW as formatOneTimeRecoveryOwnerConsent};
