import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPublicGpuResidency} from '../bench/runpod-gpu-residency.mjs';

const URL='http://127.0.0.1:11434/api/ps';
const MODEL='qwen3.6:35b-a3b-coding';
const good={name:MODEL,size:23000000000,size_vram:23500000000};
function response(models,{status=200,url=URL,type='application/json'}={}){
 const r=new Response(JSON.stringify({models}),{status,headers:{'content-type':type}});
 Object.defineProperty(r,'url',{value:url});
 return r;
}
test('R147 proves fully-in-VRAM model only via fixed local GET',async()=>{
 let count=0;
 const r=await verifyPublicGpuResidency({fetchImpl:async(url,opts)=>{
  count++;
  assert.equal(url,URL);
  assert.equal(opts.method,'GET');
  assert.equal(opts.body,undefined);
  assert.equal(opts.redirect,'error');
  return response([good]);
 }});
 assert.equal(count,1);
 assert.equal(r.gpuResidencyVerified,true);
 assert.equal(r.ollamaReportedFullyInVram,true);
 assert.equal(r.privateSourceReviewed,false);
 assert.equal(r.approvalAuthorized,false);
 assert.equal(r.mayMerge,false);
});
test('R147 rejects absent, duplicate, different, CPU-offloaded or invalid models',async()=>{
 for(const models of [
  [],[good,good],[{...good,name:'wrong'}],
  [{...good,size_vram:0}],
  [{...good,size_vram:good.size-1}],
  [{...good,size:'23000000000'}],
  [{...good,size_vram:NaN}]
 ]){
  await assert.rejects(()=>verifyPublicGpuResidency({
   fetchImpl:async()=>response(models)
  }),/^Error: GPU_RESIDENCY_/);
 }
});
test('R147 refuses redirect, external URL, MIME, status and oversized reply',async()=>{
 for(const opts of [
  {url:'https://somewhere.example/api/ps'},
  {type:'text/html'},
  {status:503}
 ]){
  await assert.rejects(()=>verifyPublicGpuResidency({
   fetchImpl:async()=>response([good],opts)
  }),/GPU_RESIDENCY_ENDPOINT_UNVERIFIED/);
 }
 await assert.rejects(()=>verifyPublicGpuResidency({
  fetchImpl:async()=>response([{...good,unused:'x'.repeat(17000)}])
 }),/GPU_RESIDENCY_RESPONSE_OVERSIZED/);
});
test('R147 never uses caller-selected model, provider or leaked errors',async()=>{
 let calls=0;
 await assert.rejects(()=>verifyPublicGpuResidency({
  model:'qwen3.5:9b',fetchImpl:async()=>{calls++;return response([good]);}
 }),/GPU_RESIDENCY_MODEL_UNTRUSTED/);
 assert.equal(calls,0);
 await assert.rejects(()=>verifyPublicGpuResidency({
  fetchImpl:async()=>{throw new Error('PRIVATE_SECRET_FROM_NETWORK');}
 }),/GPU_RESIDENCY_REQUEST_FAILED/);
});
