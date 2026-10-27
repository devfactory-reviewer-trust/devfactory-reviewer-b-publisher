import assert from 'node:assert/strict';
import test from 'node:test';
import {stopExactRunPod} from '../bench/runpod-provider-stop.mjs';
import {EXACT_RUNPOD_POD_ID as POD} from '../bench/runpod-provider-readonly.mjs';
const TOKEN='rpa_'+'q'.repeat(46);
const URL='https://api.runpod.io/v2/pods/'+POD;
const jsonResponse=body=>({
 ok:true,status:200,headers:{get:()=>null},json:async()=>body,
});
const state=status=>({id:POD,desiredStatus:status});
const checkInvariant=x=>{
 assert.equal(x.mayStartPod,false);
 assert.equal(x.maySpend,false);
 assert.equal(x.mayReviewPrivateCode,false);
 assert.equal(x.mayPublishReview,false);
 assert.equal(JSON.stringify(x).includes(TOKEN),false);
};
test('R142 exactly one POST stop, then authenticated exact-id STOPPED proof',async()=>{
 const requestMethods=[];
 let gets=0;
 const result=await stopExactRunPod({
  apiKey:TOKEN,confirmation:'STOP '+POD,
  fetchImpl:async(url,opts)=>{
   assert.equal(url,URL);
   assert.equal(opts.redirect,'error');
   assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
   requestMethods.push(opts.method);
   if(opts.method==='GET')return jsonResponse(state(gets++===0?'RUNNING':'EXITED'));
   assert.equal(opts.method,'POST');
   assert.deepEqual(JSON.parse(opts.body),{action:'stop'});
   return jsonResponse({pod:state('STOPPING')});
  },sleepImpl:async()=>{},
 });
 assert.equal(result.ok,true);
 assert.equal(result.providerStopVerified,true);
 assert.equal(result.alreadyStopped,false);
 assert.deepEqual(requestMethods,['GET','POST','GET']);
 checkInvariant(result);
});
test('R142 stopped Pod is GET-only, never POST',async()=>{
 let calls=0;
 const r=await stopExactRunPod({apiKey:TOKEN,confirmation:'STOP '+POD,
  fetchImpl:async(url,opts)=>{
   calls++;assert.equal(opts.method,'GET');
   return jsonResponse(state('EXITED'));
  }});
 assert.equal(r.ok,true);assert.equal(r.alreadyStopped,true);
 assert.equal(calls,1);checkInvariant(r);
});
test('R142 no exact confirmation or key means zero network requests',async()=>{
 for(const config of [
  {confirmation:undefined,apiKey:TOKEN},
  {confirmation:'STOP foreign',apiKey:TOKEN},
  {confirmation:'STOP '+POD+' now',apiKey:TOKEN},
  {confirmation:'STOP '+POD,apiKey:null},
  {confirmation:'STOP '+POD,apiKey:'too-short'},
  {confirmation:'STOP '+POD,apiKey:TOKEN+'\n'},
 ]){
  let calls=0;
  const r=await stopExactRunPod({...config,fetchImpl:async()=>{
   calls++;throw Error('must never call provider');
  }});
  assert.equal(r.ok,false);
  assert.equal(calls,0);checkInvariant(r);
 }
});
test('R142 cannot stop foreign Pod or Pod with unknown state',async()=>{
 for(const first of [{id:'65d120da1098',desiredStatus:'RUNNING'},
   {id:POD,desiredStatus:'BROKEN'},{id:POD,desiredStatus:'STARTING'}]){
  let calls=0;
  const r=await stopExactRunPod({apiKey:TOKEN,confirmation:'STOP '+POD,
   fetchImpl:async(url,opts)=>{
    calls++;assert.equal(opts.method,'GET');return jsonResponse(first);
   }});
  assert.equal(r.ok,false);assert.equal(calls,1);checkInvariant(r);
 }
});
test('R142 foreign stop acknowledgement cannot be treated as verified stop',async()=>{
 let calls=0;
 const r=await stopExactRunPod({apiKey:TOKEN,confirmation:'STOP '+POD,
  fetchImpl:async(url,opts)=>{
   calls++;return opts.method==='GET'
    ?jsonResponse(state('RUNNING'))
    :jsonResponse({id:'65d120da1098',desiredStatus:'EXITED'});
  }});
 assert.equal(calls,2);assert.equal(r.ok,false);
 assert.equal(r.reason,'GPU_RUNPOD_STOP_ACK_FOREIGN_POD');
 checkInvariant(r);
});
test('R142 asynchronous STOPPING transitions are bounded and retried',async()=>{
 let gets=0,posts=0,sleeps=0;
 const r=await stopExactRunPod({apiKey:TOKEN,confirmation:'STOP '+POD,
  sleepImpl:async()=>{sleeps++},
  fetchImpl:async(url,opts)=>{
   if(opts.method==='POST'){posts++;return jsonResponse(state('STOPPING'))}
   gets++;return jsonResponse(state(gets===1?'RUNNING':gets<4?'STOPPING':'STOPPED'));
  }});
 assert.equal(r.ok,true);
 assert.equal(posts,1);assert.equal(sleeps,2);
 assert.equal(r.providerStopVerified,true);checkInvariant(r);
});
test('R142 sustained RUNNING after stop ACK fails closed',async()=>{
 let posts=0,gets=0;
 const r=await stopExactRunPod({apiKey:TOKEN,confirmation:'STOP '+POD,
  sleepImpl:async()=>{},
  fetchImpl:async(url,opts)=>{
   if(opts.method==='POST'){posts++;return jsonResponse(state('STOPPING'))}
   gets++;return jsonResponse(state('RUNNING'));
  }});
 assert.equal(r.ok,false);assert.equal(r.reason,'GPU_RUNPOD_POSTSTOP_NOT_CONFIRMED');
 assert.equal(posts,1);assert.equal(gets,5);checkInvariant(r);
});
test('R142 provider or HTTP failure returns static redacted errors',async()=>{
 for(const scenario of ['pre-http','stop-http','stop-throw','post-throw','stop-oversized']){
  let calls=0;
  const r=await stopExactRunPod({apiKey:TOKEN,confirmation:'STOP '+POD,
   sleepImpl:async()=>{},
   fetchImpl:async(url,opts)=>{
    calls++;
    if(scenario==='pre-http')return {status:401,ok:false};
    if(calls===1)return jsonResponse(state('RUNNING'));
    if(calls===2){
     if(scenario==='stop-http')return {status:403,ok:false};
     if(scenario==='stop-throw')throw Error('secret '+TOKEN);
     if(scenario==='stop-oversized')
      return {status:200,ok:true,headers:{get:()=>999999}};
     return jsonResponse(state('STOPPING'));
    }
    throw Error('secret '+TOKEN);
   }});
  assert.equal(r.ok,false,scenario);
  checkInvariant(r);
 }
});
test('R142 no Pod create, restart, or private review method is ever called',async()=>{
 const methods=[];
 const r=await stopExactRunPod({apiKey:TOKEN,confirmation:'STOP '+POD,
  fetchImpl:async(url,opts)=>{
   assert.equal(url,URL);
   methods.push(opts.method);
   return opts.method==='GET'?jsonResponse(state('EXITED')):jsonResponse(state('STOPPING'));
  }});
 assert.deepEqual(methods,['GET']);
 checkInvariant(r);
});