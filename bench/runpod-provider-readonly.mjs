/**
 * R141: owner-side RunPod REST v2 identity inspection.
 * READ-ONLY: never creates/resumes/stops a Pod; never imports PRIVATE source.
 * Auth is sourced ONLY from the local operator environment. Never log or
 * persist the key, response body, headers, SSH credentials, or error text.
 */
import {pathToFileURL} from 'node:url';

export const EXACT_RUNPOD_POD_ID='ao1z73um41h61i';
const ENDPOINT='https://api.runpod.io/v2/pods/'+EXACT_RUNPOD_POD_ID;
const deny=(reason)=>Object.freeze({
 ok:false,reason,mode:'READ_ONLY',
 podId:EXACT_RUNPOD_POD_ID,mayStartPod:false,maySpend:false,
 mayReviewPrivateCode:false,mayPublishReview:false,
});
const isPlainObject=x=>x!==null&&typeof x==='object'&&
 !Array.isArray(x);
const safeStatus=x=>typeof x==='string'&&
 /^(RUNNING|EXITED|STOPPED|PENDING|STARTING|STOPPING|UNKNOWN)$/.test(x);
export function summarizeVerifiedPod(payload){
 const data=payload?.pod&&isPlainObject(payload.pod)?payload.pod:payload;
 if(!isPlainObject(data)||data.id!==EXACT_RUNPOD_POD_ID)
  return deny('GPU_CURRENT_POD_IDENTITY_UNVERIFIED');
 const state=data.desiredStatus??data.status??data.state;
 if(!safeStatus(state))return deny('GPU_POD_STATUS_UNKNOWN');
 return Object.freeze({
   ok:true,mode:'READ_ONLY',podId:EXACT_RUNPOD_POD_ID,status:state,
   gpuIdentityVerified:false,priceInEurVerified:false,
   monthlySpendVerified:false,storageChargesVerified:false,
   sshEndpointVerified:false,hostKeyVerified:false,
   independentlyEnforcedStopVerified:false,
   canRunPublicSynthetic:false,mayStartPod:false,maySpend:false,
   mayReviewPrivateCode:false,mayPublishReview:false,
   note:'Provider Pod identity/status alone cannot certify GPU, cost, stop, or PRIVATE code egress.',
 });
}
export async function probeOwnerRunPod({
 apiKey,fetchImpl=fetch,signal=AbortSignal.timeout(8000),
}={}){
 if(typeof apiKey!=='string'||apiKey.length<16||
    /[\r\n\0]/.test(apiKey)||apiKey.length>512)
   return deny('GPU_RUNPOD_API_KEY_NOT_CONFIGURED');
 let response;
 try{
   response=await fetchImpl(ENDPOINT,{
    method:'GET',
    headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'},
    redirect:'error',signal,
   });
 }catch{
   return deny('GPU_RUNPOD_API_UNAVAILABLE');
 }
 if(response?.status===401||response?.status===403)
  return deny('GPU_RUNPOD_CREDENTIAL_SCOPE_DENIED');
 if(response?.ok!==true)return deny('GPU_RUNPOD_QUERY_FAILED');
 const length=Number(response.headers?.get?.('content-length')??0);
 if(!Number.isSafeInteger(length)||length<0||length>65536)
  return deny('GPU_RUNPOD_RESPONSE_OVERSIZED');
 let payload;
 try{payload=await response.json()}catch{
  return deny('GPU_RUNPOD_RESPONSE_INVALID');
 }
 return summarizeVerifiedPod(payload);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--read-only'){
  console.error('GPU_READONLY_INVALID_MODE');process.exitCode=2;
 }else{
  const output=await probeOwnerRunPod({apiKey:process.env.RUNPOD_API_KEY});
  console.log(JSON.stringify(output));
  if(!output.ok)process.exitCode=1;
 }
}
