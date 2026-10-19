import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {planPinnedSyntheticSshTunnel} from '../bench/runpod-gpu-ssh-plan.mjs';
import {verifyPublicGpuResidency} from '../bench/runpod-gpu-residency.mjs';
import {resolveRunPodGpuSyntheticSelector} from '../bench/ollama-synthetic-benchmark.mjs';
import {sanitizePublicSyntheticResult,
 runPublicSyntheticPinnedTunnel} from '../bench/runpod-gpu-synthetic-ssh.mjs';

const MODEL='qwen2.5-coder:7b';
const config=()=>({
 podId:'ao1z73um41h61i',host:'gpu-tcp.runpod.net',port:21053,
 sshPrivateKeyPath:'/home/test/.ssh/id_runpod',
 knownHostsPath:'/home/test/.ssh/known_hosts',
 model:MODEL,externalProviderStopProof:true,
 providerPortExposureVerified:true,
 budgetQuote:{spentToDateEur:0.2,providerGpuEurPerHour:0.6,
  providerStorageEurPerHour:0.1,extraEur:0.1,standbyEur:0.1,
  proposedMinutes:10,independentlyEnforcedStop:true,
  quoteVerified:true,availableEuroBalanceVerified:true}
});
const publicBench=model=>({
 model,testsCompleted:12,syntheticQualityGatePassed:true,
 privateSourceReviewed:false,approvalAuthorized:false,
 independentReviewerProvenanceVerified:false,
 performanceMetrics:{wall_seconds:30,private_source_processed:false,
  request_p50_seconds:2,request_p95_seconds:5,
  ollama_reported_tokens_per_second:64}
});
const proof=model=>({
 model,ollamaReportedFullyInVram:true,gpuResidencyVerified:true,
 privateSourceReviewed:false,approvalAuthorized:false,
 mayStartPod:false,mayPublishReview:false,mayMerge:false
});
test('R148 keeps production Qwen 7B identity for optional PUBLIC GPU holdout',()=>{
 const v=planPinnedSyntheticSshTunnel(config());
 assert.equal(v.ok,true,v.reason);
 assert.deepEqual(v.benchmarkArgs,
  ['bench/ollama-synthetic-benchmark.mjs','--runpod-7b-holdout']);
 assert.equal(v.model,MODEL);
 assert.equal(v.canReviewPrivateCode,false);
 assert.equal(v.mayStartPod,false);
 assert.equal(v.mayMerge,false);
 assert.equal(v.mayPublishReview,false);
 assert.throws(()=>sanitizePublicSyntheticResult(
  publicBench('qwen3.6:35b-a3b-coding'),MODEL),/GPU_BENCHMARK_RESULT_INVALID/);
 assert.equal(sanitizePublicSyntheticResult(publicBench(MODEL),MODEL).model,MODEL);
});
test('R148 reads the same GPU memory proof for exact 7B via loopback GET only',async()=>{
 const r=new Response(JSON.stringify({
  models:[{name:MODEL,size:4400000000,size_vram:4500000000}]
 }),{status:200,headers:{'content-type':'application/json'}});
 Object.defineProperty(r,'url',{value:'http://127.0.0.1:11434/api/ps'});
 let calls=0;
 const x=await verifyPublicGpuResidency({model:MODEL,fetchImpl:async(url,o)=>{
  calls++;assert.equal(o.method,'GET');assert.equal(o.body,undefined);
  assert.equal(url,'http://127.0.0.1:11434/api/ps');
  return r;
 }});
 assert.equal(calls,1);
 assert.equal(x.model,MODEL);
 assert.equal(x.ollamaReportedFullyInVram,true);
 assert.equal(x.privateSourceReviewed,false);
});
test('R148 public 7B benchmark selects holdout and tears down SSH',async()=>{
 const plan=planPinnedSyntheticSshTunnel(config());
 const started=[];
 const spawnImpl=(bin,args,opts)=>{
  const child=new EventEmitter();
  child.killed=false;child.exitCode=null;child.signalCode=null;
  child.kill=()=>{child.killed=true;return true};
  child.stdout=new PassThrough();
  started.push({bin,args,opts,child});
  if(started.length===2)process.nextTick(()=>{
   child.stdout.write(JSON.stringify(publicBench(MODEL)));
   child.stdout.end();child.exitCode=0;child.emit('exit',0,null);
  });
  return child;
 };
 const output=await runPublicSyntheticPinnedTunnel(plan,{
  spawnImpl,connectCheck:async()=>false,waitForTunnel:async()=>{},
  benchmarkTimeoutMs:2000,residencyCheck:async({model})=>proof(model)
 });
 assert.equal(started.length,2);
 assert.equal(started[0].bin,'ssh');
 assert.deepEqual(started[1].args,
  ['bench/ollama-synthetic-benchmark.mjs','--runpod-7b-holdout']);
 assert.equal(started[0].child.killed,true);
 assert.equal(output.model,MODEL);
 assert.equal(output.gpuResidencyVerified,true);
 assert.equal(output.approvalAuthorized,false);
});


test('R148 exact CLI selection never aliases 7B to 35B',()=>{
 const seven=resolveRunPodGpuSyntheticSelector('--runpod-7b-holdout');
 assert.deepEqual(seven,{model:'qwen2.5-coder:7b',fixtureSet:'holdout'});
 assert.deepEqual(resolveRunPodGpuSyntheticSelector('--runpod-35b-holdout'),
  {model:'qwen3.6:35b-a3b-coding',fixtureSet:'holdout'});
 assert.deepEqual(resolveRunPodGpuSyntheticSelector('--runpod-35b-synthetic'),
  {model:'qwen3.6:35b-a3b-coding',fixtureSet:'reference'});
 for(const input of ['--runpod-35b-holdout ', '--runpod-7b', '', null,
  '--qwen35-synthetic', '--runpod-7b-holdout;echo untrusted'])
  assert.equal(resolveRunPodGpuSyntheticSelector(input),null);
});
