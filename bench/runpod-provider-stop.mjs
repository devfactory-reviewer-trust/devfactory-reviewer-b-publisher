/**
 * R142: owner-only emergency stop for one EXISTING RunPod Pod.
 * No create/resume/modify, no private PR data, no status or review authority.
 * A REST "stop" ACK is NOT proof that GPU billing actually stopped:
 * follow with exact-identity authenticated GET and fail closed otherwise.
 */
import {pathToFileURL} from 'node:url';
import {EXACT_RUNPOD_POD_ID,probeOwnerRunPod} from './runpod-provider-readonly.mjs';

const URL='https://api.runpod.io/v2/pods/'+EXACT_RUNPOD_POD_ID;
const deny=(reason)=>Object.freeze({
 ok:false,reason,podId:EXACT_RUNPOD_POD_ID,
 mayStartPod:false,maySpend:false,mayReviewPrivateCode:false,
 mayPublishReview:false,providerStopVerified:false,
});
const keyValid=k=>typeof k==='string'&&k.length>=16&&k.length<=512&&
 !/[\r\n\0]/.test(k);
const stopped=status=>status==='EXITED'||status==='STOPPED';
export async function stopExactRunPod({
 apiKey,confirmation,fetchImpl=fetch,sleepImpl=ms=>new Promise(r=>setTimeout(r,ms)),
}={}){
 // No GET and especially no POST until two independent validations pass.
 if(confirmation!=='STOP '+EXACT_RUNPOD_POD_ID)
   return deny('GPU_EXACT_POD_STOP_NOT_CONFIRMED');
 if(!keyValid(apiKey))return deny('GPU_RUNPOD_STOP_CREDENTIAL_MISSING');
 const before=await probeOwnerRunPod({apiKey,fetchImpl});
 if(!before.ok)return deny('GPU_RUNPOD_PRESTOP_IDENTITY_UNVERIFIED');
 if(stopped(before.status))return Object.freeze({
  ok:true,podId:EXACT_RUNPOD_POD_ID,alreadyStopped:true,
  providerStopVerified:true,mode:'READ_ONLY_ALREADY_STOPPED',
  mayStartPod:false,maySpend:false,mayReviewPrivateCode:false,
  mayPublishReview:false,
 });
 if(before.status!=='RUNNING')return deny('GPU_RUNPOD_STOP_STATE_UNCERTAIN');
 let response;
 try{
  response=await fetchImpl(URL,{
   method:'POST',
   headers:{
    Authorization:'Bearer '+apiKey,Accept:'application/json',
    'Content-Type':'application/json',
   },
   body:JSON.stringify({action:'stop'}),
   redirect:'error',
   signal:AbortSignal.timeout(8000),
  });
 }catch{return deny('GPU_RUNPOD_STOP_REQUEST_FAILED')}
 if(response?.ok!==true)return deny('GPU_RUNPOD_STOP_HTTP_REJECTED');
 const length=Number(response.headers?.get?.('content-length')??0);
 if(!Number.isSafeInteger(length)||length<0||length>65536)
  return deny('GPU_RUNPOD_STOP_RESPONSE_OVERSIZED');
 let data;
 try{data=await response.json()}
 catch{return deny('GPU_RUNPOD_STOP_RESPONSE_INVALID')}
 // Never trust an ACK without checking an explicit exact ID.
 const pod=data?.pod&&typeof data.pod==='object'?data.pod:data;
 if(pod?.id!==EXACT_RUNPOD_POD_ID)
  return deny('GPU_RUNPOD_STOP_ACK_FOREIGN_POD');
 for(const delay of [0,1200,2300,4000]){
  if(delay)await sleepImpl(delay);
  const check=await probeOwnerRunPod({apiKey,fetchImpl});
  if(!check.ok)return deny('GPU_RUNPOD_POSTSTOP_IDENTITY_UNVERIFIED');
  if(stopped(check.status))return Object.freeze({
   ok:true,podId:EXACT_RUNPOD_POD_ID,alreadyStopped:false,
   providerStopVerified:true,mode:'EXACT_PROVIDER_STOP_CONFIRMED',
   mayStartPod:false,maySpend:false,mayReviewPrivateCode:false,
   mayPublishReview:false,
  });
  if(check.status!=='STOPPING'&&check.status!=='RUNNING')
   return deny('GPU_RUNPOD_POSTSTOP_STATUS_UNEXPECTED');
 }
 return deny('GPU_RUNPOD_POSTSTOP_NOT_CONFIRMED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [mode,exact,...rest]=process.argv.slice(2);
 if(rest.length||mode!=='--stop-existing-pod'||
     exact!==EXACT_RUNPOD_POD_ID){
  console.error('GPU_PROVIDER_STOP_MODE_REJECTED');process.exitCode=2;
 }else{
  const result=await stopExactRunPod({
   apiKey:process.env.RUNPOD_API_KEY,
   confirmation:process.env.RUNPOD_EXACT_STOP_CONFIRMATION,
  });
  console.log(JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
 }
}