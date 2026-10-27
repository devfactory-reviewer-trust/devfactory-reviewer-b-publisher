import assert from 'node:assert/strict';
import test from 'node:test';
import {
 EXACT_RUNPOD_POD_ID,probeOwnerRunPod,summarizeVerifiedPod,
} from '../bench/runpod-provider-readonly.mjs';
const TOKEN='rpa_'+'x'.repeat(45);
const payload=()=>({id:EXACT_RUNPOD_POD_ID,desiredStatus:'EXITED',
 costPerHr:0.59,apiKey:'NEVER_LOG_CREDENTIAL',privateHost:'private.example.com'});
function goodResponse(data=payload()){
 return {ok:true,status:200,headers:{get:()=>null},json:async()=>data};
}
test('R141 GET only, exact Pod, credentials not emitted and no permission for spending',async()=>{
 let requests=0;
 const result=await probeOwnerRunPod({apiKey:TOKEN,fetchImpl:async(url,options)=>{
  requests++;
  assert.equal(url,'https://api.runpod.io/v2/pods/ao1z73um41h61i');
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
  return goodResponse();
 }});
 assert.equal(requests,1);
 assert.equal(result.ok,true);
 assert.equal(result.status,'EXITED');
 assert.equal(result.maySpend,false);
 assert.equal(result.mayStartPod,false);
 assert.equal(result.mayReviewPrivateCode,false);
 assert.equal(result.priceInEurVerified,false);
 assert.equal(result.independentlyEnforcedStopVerified,false);
 assert.equal(JSON.stringify(result).includes(TOKEN),false);
 assert.equal(JSON.stringify(result).includes('private.example.com'),false);
 assert.equal(JSON.stringify(result).includes('NEVER_LOG_CREDENTIAL'),false);
});
test('R141 no key prevents network access',async()=>{
 let calls=0;
 for(const key of ['',undefined,'short','rpa_\nSECRET']){
  const r=await probeOwnerRunPod({apiKey:key,fetchImpl:async()=>{calls++;throw Error('not called')}});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'GPU_RUNPOD_API_KEY_NOT_CONFIGURED');
 }
 assert.equal(calls,0);
});
test('R141 foreign Pod ID and unknown provider status fail closed',()=>{
 for(const bad of [
 {id:'65d120da1098',desiredStatus:'EXITED'},
 {id:EXACT_RUNPOD_POD_ID,desiredStatus:'OVERDUE'},
 {id:EXACT_RUNPOD_POD_ID},
 {},
 [],null,{pod:{id:'impostor',desiredStatus:'RUNNING'}},
 ]){
  const result=summarizeVerifiedPod(bad);
  assert.equal(result.ok,false);
  assert.equal(result.mayStartPod,false);
 }
});
test('R141 failed HTTP and network errors report only fixed, non-sensitive reasons',async()=>{
 const scenarios=[
 async()=>({status:401,ok:false}),
 async()=>({status:403,ok:false}),
 async()=>({status:500,ok:false}),
 async()=>{throw Error('secret '+TOKEN)},
 async()=>({status:200,ok:true,headers:{get:()=>70000}}),
 async()=>({status:200,ok:true,headers:{get:()=>null},
   json:async()=>{throw Error(TOKEN)}}),
 ];
 for(const fetchImpl of scenarios){
  const result=await probeOwnerRunPod({apiKey:TOKEN,fetchImpl});
  assert.equal(result.ok,false);
  assert.equal(result.maySpend,false);
  assert.equal(JSON.stringify(result).includes(TOKEN),false);
 }
});
test('R141 POD status does not imply a verified GPU or price',()=>{
 const result=summarizeVerifiedPod({pod:{id:EXACT_RUNPOD_POD_ID,status:'RUNNING',
   billing:'$0.01/hr',gpus:[{name:'NVIDIA'}]}});
 assert.equal(result.ok,true);
 assert.equal(result.status,'RUNNING');
 assert.equal(result.gpuIdentityVerified,false);
 assert.equal(result.priceInEurVerified,false);
 assert.equal(result.canRunPublicSynthetic,false);
});
