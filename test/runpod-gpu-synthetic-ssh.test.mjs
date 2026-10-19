import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {planPinnedSyntheticSshTunnel} from '../bench/runpod-gpu-ssh-plan.mjs';
import {
 validateSyntheticBridgeConfig, sanitizePublicSyntheticResult,
 runPublicSyntheticPinnedTunnel
} from '../bench/runpod-gpu-synthetic-ssh.mjs';
const inputs=()=>({
 podId:'ao1z73um41h61i',host:'gpu-tcp.runpod.net',port:21053,
 sshPrivateKeyPath:'/home/test/.ssh/id_runpod',
 knownHostsPath:'/home/test/.ssh/known_hosts',
 model:'qwen3.6:35b-a3b-coding',
 externalProviderStopProof:true,providerPortExposureVerified:true,
 budgetQuote:{spentToDateEur:0.2,providerGpuEurPerHour:0.6,
  providerStorageEurPerHour:0.1,extraEur:0.1,standbyEur:0.1,
  proposedMinutes:10,independentlyEnforcedStop:true,
  quoteVerified:true,availableEuroBalanceVerified:true}
});
const stats={
 lstatSync:file=>({isFile:()=>true,isSymbolicLink:()=>false,size:320}),
 statSync:file=>({mode:file.includes('id_runpod')?0o100600:0o100644})
};
test('missing key, loose permissions, and unknown config fields fail before network',()=>{
 assert.equal(validateSyntheticBridgeConfig(inputs(),stats).ok,true);
 assert.throws(()=>validateSyntheticBridgeConfig({...inputs(),unknown:'injected'},stats),
  /GPU_CONFIG_SCHEMA_INVALID/);
 assert.throws(()=>validateSyntheticBridgeConfig(inputs(),{
  ...stats,lstatSync:()=>({isFile:()=>false,isSymbolicLink:()=>true,size:55})}),
  /GPU_PINNED_CREDENTIAL_FILE_INVALID/);
 assert.throws(()=>validateSyntheticBridgeConfig(inputs(),{
  ...stats,statSync:()=>({mode:0o100644})}),
  /GPU_PRIVATE_SSH_KEY_PERMISSIONS/);
});
test('synthetic result always denies private review and rejects forged private claims',()=>{
 const raw={
  model:'qwen3.6:35b-a3b-coding',testsCompleted:12,
  privateSourceReviewed:false,approvalAuthorized:false,
  independentReviewerProvenanceVerified:false,
  syntheticQualityGatePassed:true,
  performanceMetrics:{private_source_processed:false,wall_seconds:22,
   request_p50_seconds:1,request_p95_seconds:3,
   ollama_reported_tokens_per_second:70}
 };
 const result=sanitizePublicSyntheticResult(raw);
 assert.equal(result.approvalAuthorized,false);
 assert.equal(result.privateSourceReviewed,false);
 assert.equal(result.gpuResidencyVerified,false);
 for(const fake of [{privateSourceReviewed:true},{approvalAuthorized:true},
  {model:'foreign'},{testsCompleted:0}])
  assert.throws(()=>sanitizePublicSyntheticResult({...raw,...fake}),
   /GPU_BENCHMARK_RESULT_INVALID/);
});
test('public bridge never spawns SSH when local Ollama port is occupied',async()=>{
 const plan=planPinnedSyntheticSshTunnel(inputs());
 let count=0;
 await assert.rejects(()=>runPublicSyntheticPinnedTunnel(plan,{
  spawnImpl:()=>{count++;throw Error('must never start')},
  connectCheck:async()=>true,
 }),/GPU_LOCAL_PORT_ALREADY_OCCUPIED/);
 assert.equal(count,0);
});
test('public bridge runs only synthetic fixtures and tears down SSH afterwards',async()=>{
 const plan=planPinnedSyntheticSshTunnel(inputs());
 const started=[];
 const spawnImpl=(bin,args,opts)=>{
  const child=new EventEmitter();
  child.killed=false;child.exitCode=null;child.signalCode=null;
  child.kill=()=>{child.killed=true;return true;};
  child.stdout=new PassThrough();
  started.push({bin,args,opts,child});
  if(started.length===2){
   process.nextTick(()=>{
    child.stdout.write(JSON.stringify({
     model:'qwen3.6:35b-a3b-coding',
     testsCompleted:12,syntheticQualityGatePassed:true,
     privateSourceReviewed:false,approvalAuthorized:false,
     independentReviewerProvenanceVerified:false,
     performanceMetrics:{wall_seconds:30,private_source_processed:false,
       request_p50_seconds:2,request_p95_seconds:5,
       ollama_reported_tokens_per_second:64}
    }));
    child.stdout.end();child.exitCode=0;child.emit('exit',0,null);
   });
  }
  return child;
 };
 const result=await runPublicSyntheticPinnedTunnel(plan,{
  spawnImpl,connectCheck:async()=>false,waitForTunnel:async()=>{},
  benchmarkTimeoutMs:2000,
  residencyCheck:async({model})=>({
   model,gpuResidencyVerified:true,ollamaReportedFullyInVram:true,
   approvalAuthorized:false,privateSourceReviewed:false,
   mayStartPod:false,mayPublishReview:false,mayMerge:false
  })
 });
 assert.equal(started.length,2);
 assert.equal(started[0].bin,'ssh');
 assert.equal(started[1].bin,process.execPath);
 assert.deepEqual(started[1].args,
  ['bench/ollama-synthetic-benchmark.mjs','--runpod-35b-holdout']);
 assert.equal(started[0].child.killed,true);
 assert.equal(result.syntheticQualityGatePassed,true);
 assert.equal(result.gpuResidencyVerified,true);
 assert.equal(result.approvalAuthorized,false);
 // A forged public benchmark success without live GPU residency must
 // still FAIL and must tear down the SSH tunnel. No model call is trusted.
 started.length=0;
 await assert.rejects(()=>runPublicSyntheticPinnedTunnel(plan,{
  spawnImpl,connectCheck:async()=>false,waitForTunnel:async()=>{},
  benchmarkTimeoutMs:2000,
  residencyCheck:async({model})=>({
   model,gpuResidencyVerified:false,ollamaReportedFullyInVram:false,
   approvalAuthorized:false,privateSourceReviewed:false,
   mayStartPod:false,mayPublishReview:false,mayMerge:false
  })
 }),/GPU_RESIDENCY_PROOF_UNVERIFIED/);
 assert.equal(started[0].child.killed,true);
});
