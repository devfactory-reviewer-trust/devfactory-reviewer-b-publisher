/**
 * R138: PUBLIC SYNTHETIC-ONLY benchmark through a pinned SSH tunnel.
 * Manual operator CLI. Does NOT resume/stop a RunPod Pod, obtain secrets,
 * read the private repository, or grant reviewer/merge authority.
 * This local process teardown is NOT an independent provider billing cap.
 */
import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {planPinnedSyntheticSshTunnel} from './runpod-gpu-ssh-plan.mjs';
import {verifyPublicGpuResidency} from './runpod-gpu-residency.mjs';

const deny=code=>{throw Error(code)};
const permitted=Object.freeze(['podId','host','port','sshPrivateKeyPath',
 'knownHostsPath','budgetQuote','model','externalProviderStopProof',
 'providerPortExposureVerified']);
export function validateSyntheticBridgeConfig(config,stats=fs){
 if(!config||typeof config!=='object'||Array.isArray(config)||
   Object.keys(config).some(k=>!permitted.includes(k)))deny('GPU_CONFIG_SCHEMA_INVALID');
 const plan=planPinnedSyntheticSshTunnel(config);
 if(!plan.ok)deny(plan.reason);
 for(const file of [config.sshPrivateKeyPath,config.knownHostsPath]){
  const s=stats.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.size===0)deny('GPU_PINNED_CREDENTIAL_FILE_INVALID');
 }
 const key=stats.statSync(config.sshPrivateKeyPath);
 if(key.mode&0o077)deny('GPU_PRIVATE_SSH_KEY_PERMISSIONS');
 return plan;
}

export function sanitizePublicSyntheticResult(raw,expectedModel='qwen3.6:35b-a3b-coding') {
 if(!['qwen3.6:35b-a3b-coding','qwen2.5-coder:7b'].includes(expectedModel)||
   !raw||typeof raw!=='object'||raw.model!==expectedModel||
   raw.privateSourceReviewed!==false||raw.approvalAuthorized!==false||
   raw.independentReviewerProvenanceVerified!==false||
   !Number.isSafeInteger(raw.testsCompleted)||raw.testsCompleted<10||
   typeof raw.syntheticQualityGatePassed!=='boolean')
   deny('GPU_BENCHMARK_RESULT_INVALID');
 const p=raw.performanceMetrics;
 if(!p||p.private_source_processed!==false||
   !Number.isFinite(p.wall_seconds)||p.wall_seconds<0)
   deny('GPU_BENCHMARK_RESULT_INVALID');
 return Object.freeze({
  model:raw.model,testsCompleted:raw.testsCompleted,
  syntheticQualityGatePassed:raw.syntheticQualityGatePassed,
  modelQualityCertified:false,privateSourceReviewed:false,
  approvalAuthorized:false,
  wallSeconds:p.wall_seconds,
  p50Seconds:p.request_p50_seconds,
  p95Seconds:p.request_p95_seconds,
  tokensPerSecond:p.ollama_reported_tokens_per_second,
  gpuResidencyVerified:false,
 });
}
async function canConnect(port){
 return new Promise(resolve=>{
  const sock=net.createConnection({host:'127.0.0.1',port});
  let done=false;
  const finish=v=>{if(done)return;done=true;sock.destroy();resolve(v)};
  sock.once('connect',()=>finish(true));
  sock.once('error',()=>finish(false));
  sock.setTimeout(1000,()=>finish(false));
 });
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function awaitHealthyTunnel(tunnel){
 for(let i=0;i<25;i++){
  if(tunnel.exitCode!==null||tunnel.signalCode!==null)deny('GPU_SSH_TUNNEL_DIED');
  if(await canConnect(11434)){
   try{
    const response=await fetch('http://127.0.0.1:11434/api/tags',{
     signal:AbortSignal.timeout(3000),redirect:'error'});
    if(response.ok){
     const models=await response.json();
     if(Array.isArray(models?.models)&&models.models.some(
        x=>x.name==='qwen3.6:35b-a3b-coding'))
       return;
    }
   }catch{}
  }
  await sleep(800);
 }
 deny('GPU_SSH_MODEL_LOOPBACK_UNAVAILABLE');
}
async function capturePublicBenchmark(child,maxMs,expectedModel){
 const stdout=[];
 let size=0,aborted=false;
 const timeout=setTimeout(()=>{aborted=true;child.kill('SIGKILL')},maxMs);
 try {
  child.stdout.on('data',v=>{
   size+=v.length;
   if(size>256*1024) {aborted=true;child.kill('SIGKILL')}
   else stdout.push(v);
  });
  // Never echo arbitrary remote errors, even on public synthetic tests.
  const exit=await new Promise((resolve,reject)=>{
   child.once('error',reject);
   child.once('exit',(code,signal)=>resolve({code,signal}));
  });
  if(aborted)deny('GPU_SYNTHETIC_DEADLINE_OR_OUTPUT_LIMIT');
  if(exit.code!==0)deny('GPU_SYNTHETIC_BENCHMARK_FAILED');
  let parsed;
  try{parsed=JSON.parse(Buffer.concat(stdout).toString('utf8'))}
  catch{deny('GPU_SYNTHETIC_INVALID_RESULT')}
  return sanitizePublicSyntheticResult(parsed,expectedModel);
 }finally{clearTimeout(timeout)}
}
export async function runPublicSyntheticPinnedTunnel(plan,{
 spawnImpl=spawn,connectCheck=canConnect,
 waitForTunnel=awaitHealthyTunnel,benchmarkTimeoutMs,
 residencyCheck=verifyPublicGpuResidency,
}={}){
 if(!plan?.ok||plan.canReviewPrivateCode!==false||
    plan.mayStartPod!==false||plan.mayPublishReview!==false||
    !Object.isFrozen(plan.args))
  deny('GPU_UNVERIFIED_SSH_PLAN');
 if(await connectCheck(11434))deny('GPU_LOCAL_PORT_ALREADY_OCCUPIED');
 const maxMs=Math.min(30*60000,plan.plannedMinutes*60000);
 if(!Number.isSafeInteger(maxMs)||maxMs<60000)deny('GPU_SESSION_BUDGET_INVALID');
 let tunnel,bench;
 let externalAbort=false;
 const abort=()=>{
  externalAbort=true;
  if(bench&&!bench.killed)bench.kill('SIGKILL');
  if(tunnel&&!tunnel.killed)tunnel.kill('SIGTERM');
 };
 process.once('SIGINT',abort);process.once('SIGTERM',abort);
 const watchdog=setTimeout(abort,maxMs);
 try{
  tunnel=spawnImpl(plan.executable,plan.args,{stdio:'ignore'});
  await waitForTunnel(tunnel);
  if(externalAbort)deny('GPU_SESSION_INTERRUPTED');
  bench=spawnImpl(process.execPath,plan.benchmarkArgs,{
   cwd:new URL('../',import.meta.url).pathname,
   stdio:['ignore','pipe','ignore'],
   env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_NO_CLOUD:'1'}
  });
  const result=await capturePublicBenchmark(bench,benchmarkTimeoutMs??maxMs,plan.model);
  if(externalAbort)deny('GPU_SESSION_INTERRUPTED');
  // GET-only model memory proof from the pinned SSH loopback after the public
  // holdout. CPU-offloaded, absent or unverified models fail closed.
  const proof=await residencyCheck({model:plan.model});
  if(proof?.gpuResidencyVerified!==true||
     proof?.ollamaReportedFullyInVram!==true||
     proof?.model!==plan.model||
     proof?.privateSourceReviewed!==false||
     proof?.approvalAuthorized!==false||
     proof?.mayStartPod!==false||
     proof?.mayPublishReview!==false||
     proof?.mayMerge!==false)
    deny('GPU_RESIDENCY_PROOF_UNVERIFIED');
  if(externalAbort)deny('GPU_SESSION_INTERRUPTED');
  return Object.freeze({...result,
    gpuResidencyVerified:true,ollamaReportedFullyInVram:true});
 }finally{
  clearTimeout(watchdog);
  process.removeListener('SIGINT',abort);
  process.removeListener('SIGTERM',abort);
  if(bench&&!bench.killed)bench.kill('SIGKILL');
  if(tunnel&&!tunnel.killed)tunnel.kill('SIGTERM');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [mode,file,...rest]=process.argv.slice(2);
  if(rest.length||!['--dry-run','--run-public-synthetic'].includes(mode)||
    !file||!file.startsWith('/')||file.length>256)
    deny('GPU_CLI_ARGUMENT_INVALID');
  const raw=fs.readFileSync(file,'utf8');
  if(Buffer.byteLength(raw,'utf8')>8192)deny('GPU_CONFIG_OVERSIZED');
  const plan=validateSyntheticBridgeConfig(JSON.parse(raw));
  if(mode==='--dry-run'){
   console.log(JSON.stringify({readyForPublicSyntheticTunnel:true,podId:plan.podId,
    projectedMonthlySpendEur:plan.projectedMonthlySpendEur,
    mayStartPod:false,privateSourceReviewed:false,
    providerStopStillExternal:true}));
  }else{
   const result=await runPublicSyntheticPinnedTunnel(plan);
   console.log(JSON.stringify(result));
   if(!result.syntheticQualityGatePassed)process.exitCode=2;
  }
 }catch(error){
  const code=String(error?.message||'');
  console.error('GPU_PUBLIC_SYNTHETIC_BLOCKED:'+
   (/^GPU_[A-Z0-9_]+$/.test(code)?code:'GPU_UNCLASSIFIED_ERROR'));
  process.exitCode=1;
 }
}
