import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { HOLDOUT_SEMANTIC_FIXTURES } from './ollama-holdout-fixtures.mjs';
import { performance } from 'node:perf_hooks';
import { runFailOnlyStaticDiffAudit } from '../candidate/fail-only-static-audit.mjs';
import { prepareBoundedSemanticReview } from '../candidate/semantic-review-request.mjs';
import {
  prepareOfflineOllamaCandidate,validateOfflineOllamaCompletion
} from '../candidate/ollama-offline-contract.mjs';
import { combineReviewerFindings } from '../candidate/combine-findings.mjs';

// BENCHMARK ONLY. Never reads repositories, env vars, secrets, or user files.
// An Ollama server MUST be local to an independently operated test worker.
const OLLAMA='http://127.0.0.1:11434/api/chat';
const RUN='synthetic-local-quality-benchmark-001';
const WORKFLOW_PATH='.github/workflows/fake-synthetic.yml';
const AUTH_PATH='src/auth-synthetic.mjs';
const SHA=value=>createHash('sha256').update(value).digest('hex');
const FIXTURES=Object.freeze([
  Object.freeze({label:'static risky trigger',path:WORKFLOW_PATH,
    before:'on: [push, pull_request]',source:'on: [push, pull_request_target]',
    knownStaticBlocker:true,knownSemanticBug:false}),
  Object.freeze({label:'read-only permission hardening',path:WORKFLOW_PATH,
    before:'    contents: write',source:'    contents: read',
    knownStaticBlocker:false,knownSemanticBug:false}),
  Object.freeze({label:'removed authorization check',path:AUTH_PATH,
    before:"function isAuthorized(user) { return user?.role === 'admin'; }",
    source:'function isAuthorized(user) { return true; }',
    knownStaticBlocker:false,knownSemanticBug:true,
    oraclePattern:/(?:always returns? [`]?true[`]?|returns? true for all (?:inputs|users)|bypass(?:es|ed|ing)? (?:the )?(?:original )?(?:authorization|admin|role|requirement)|authorization (?:check )?bypass(?:ed|es|ing)?|unauthorized access)/i}),
  Object.freeze({label:'safe null-checked authorization',path:AUTH_PATH,
    before:"function isAuthorized(user) { return user.role === 'admin'; }",
    source:"function isAuthorized(user) { return user?.role === 'admin'; }",
    knownStaticBlocker:false,knownSemanticBug:false}),
  Object.freeze({label:'broad workflow write permission introduced',path:WORKFLOW_PATH,
    before:'    contents: read',source:'    contents: write',
    knownStaticBlocker:true,knownSemanticBug:false}),
  Object.freeze({label:'removed HTML escaping',path:'src/render-synthetic.mjs',
    before:'const rendered = escapeHtml(userInput);',
    source:'const rendered = userInput;',
    knownStaticBlocker:false,knownSemanticBug:true,
    oraclePattern:/(?:xss|cross.site scripting|unescaped html|html escaping|html escape|injection|no longer escap(?:ed|ing).{0,80}(?:render|html|javascript)|arbitrary html(?:\/javascript)? execution)/i}),
  Object.freeze({label:'negative amount validation weakened',path:'src/payment-synthetic.mjs',
    before:"if (amount < 0) throw new Error('invalid');",
    source:"if (amount < -100) throw new Error('invalid');",
    knownStaticBlocker:false,knownSemanticBug:true,
    oraclePattern:/(?:allow(?:s|ed|ing)? (?:previously (?:rejected|invalid) )?negative|accept(?:s|ed|ing)? negative|negative (?:amounts?|values?) (?:are |were |can be |now )?(?:now )?(?:accepted|allowed)|negative.{0,35}not rejected|allow(?:s|ed|ing)?.{0,60}(?:negative values?|values between -100 and 0).{0,45}bypass validation)/i}),
  Object.freeze({label:'session token check inverted',path:'src/session-synthetic.mjs',
    before:'if (token !== session.token) return false;',
    source:'if (token === session.token) return false;',
    knownStaticBlocker:false,knownSemanticBug:true,
    oraclePattern:/(?:valid (?:session )?tokens? (?:are |is |to be )?(?:rejected|denied)|(?:reject|deny)(?:s|ing)? (?:the )?valid (?:session )?token|invalid (?:session )?tokens? (?:are |is |to be )?(?:accepted|allowed)|(?:accept|allow)(?:s|ing)? invalid (?:session )?token)/i}),
  Object.freeze({label:'safe nonnegative clamp',path:'src/bounds-synthetic.mjs',
    before:'const limit = Math.min(amount, max);',
    source:'const limit = Math.max(0, Math.min(amount, max));',
    knownStaticBlocker:false,knownSemanticBug:false}),
  Object.freeze({label:'safe immutable config',path:'src/config-synthetic.mjs',
    before:'return config;',source:'return Object.freeze(config);',
    knownStaticBlocker:false,knownSemanticBug:false}),
  // OLD-side-only security defect: formerly impossible to cite using v1.
  Object.freeze({label:'deleted authorization guard without replacement',
    path:'src/auth-deletion-synthetic.mjs',
    before:'if (!user.isAdmin) return false;',source:null,deletionOnly:true,
    knownStaticBlocker:false,knownSemanticBug:true,
    oraclePattern:/(?:removed|removal|deleted|deletion|missing|absent|bypass(?:ed|es|ing)?|without).{0,60}(?:admin|authoriz|access|guard)|(?:admin|authoriz|access|guard).{0,60}(?:removed|removal|deleted|deletion|missing|absent|bypass(?:ed|es|ing)?|without)/i}),
  // Legitimate OLD-side deletion that must not cause a blocking false alert.
  Object.freeze({label:'removed inert diagnostic logging',
    path:'src/diagnostic-synthetic.mjs',
    before:'console.debug("entered validation");',source:null,deletionOnly:true,
    knownStaticBlocker:false,knownSemanticBug:false})
]);
const HOLDOUT_FIXTURES=Object.freeze([FIXTURES[0],
  ...HOLDOUT_SEMANTIC_FIXTURES.slice(0,3),FIXTURES[4],
  ...HOLDOUT_SEMANTIC_FIXTURES.slice(3)]);
// Fixed PUBLIC synthetic-only oracle; do not use it to score real private PRs.
export function scoreFixedSyntheticOracle(label,explanation){
  if(typeof label!=='string'||typeof explanation!=='string'||explanation.length>65536)return false;
  // A statement that denies removal of an authorization guard cannot earn credit.
  if(label==='deleted authorization guard without replacement'&&
     /\b(?:no|not|never)\b.{0,75}\b(?:check|guard)\b.{0,25}\b(?:removed|deleted|bypassed)\b/i.test(explanation))return false;
  const fixture=FIXTURES.find(f=>f.label===label)||
    HOLDOUT_FIXTURES.find(f=>f.label===label);
  return Boolean(fixture?.knownSemanticBug&&fixture.oraclePattern.test(explanation));
}
function deny(code){throw Error(code);}
// Whitelisted diagnostic codes only. NEVER echo arbitrary model/API errors.
export function safeBenchmarkErrorCode(error){
  const message=error?.message;
  return typeof message==='string' &&
    /^(?:OLLAMA|REVIEW|SEMANTIC|STATIC|COMBINED)_[A-Z0-9_]{3,80}$/.test(message)?
    message:'UNCLASSIFIED';
}
/**
 * Synthetic-only, deliberately STRICT readiness check. This never authorizes
 * private-source processing, real review publication, model independence or
 * a merge. No alert on safe diffs and all seeded bugs correctly described.
 */
export function evaluateSyntheticReviewQuality({
  seededSemanticBugs,seededSemanticBugsDetected,cleanFixtures,
  cleanFixtureFalseAlerts,cleanFixtureBlockingFalseAlerts
}={}){
  const fields=[seededSemanticBugs,seededSemanticBugsDetected,cleanFixtures,
    cleanFixtureFalseAlerts,cleanFixtureBlockingFalseAlerts];
  // Expected counts come from the immutable, locally defined benchmark cases,
  // not from provider-reported metrics or a caller-supplied expectation.
  const expectedSemantic=FIXTURES.filter(f=>f.knownSemanticBug).length;
  const expectedClean=FIXTURES.filter(f=>
    !f.knownStaticBlocker&&!f.knownSemanticBug).length;
  if(expectedSemantic<1||expectedClean<1||
     fields.some(n=>!Number.isSafeInteger(n)||n<0)||
     seededSemanticBugs!==expectedSemantic||cleanFixtures!==expectedClean||
     seededSemanticBugsDetected>seededSemanticBugs||
     cleanFixtureFalseAlerts>cleanFixtures||
     cleanFixtureBlockingFalseAlerts>cleanFixtureFalseAlerts)
    deny('OLLAMA_SYNTHETIC_QUALITY_METRICS_INVALID');
  const blockers=[];
  if(seededSemanticBugsDetected!==seededSemanticBugs)
    blockers.push('MISSED_SEEDED_SEMANTIC_DEFECT');
  if(cleanFixtureFalseAlerts!==0)
    blockers.push('FALSE_ALERT_ON_SAFE_CHANGE');
  if(cleanFixtureBlockingFalseAlerts!==0)
    blockers.push('FALSE_BLOCKER_ON_SAFE_CHANGE');
  return Object.freeze({
    syntheticQualityGatePassed:blockers.length===0,
    blockers:Object.freeze(blockers),
    modelQualityCertified:false,independentReviewerProvenanceVerified:false,
    approvalAuthorized:false,publishEvent:null
  });
}

function diff(fixture) {
  const path=fixture.path;
  const head='diff --git a/'+path+' b/'+path+'\n'+
    'index 1234567..abcdef0 100644\n--- a/'+path+'\n'+
    '+++ b/'+path+'\n';
  if(fixture.deletionOnly===true){
    if(fixture.source!==null)deny('OLLAMA_BENCHMARK_DELETION_FIXTURE_INVALID');
    return Buffer.from(head+'@@ -1 +0,0 @@\n-'+fixture.before+'\n');
  }
  return Buffer.from(head+'@@ -1 +1 @@\n-'+fixture.before+'\n+'+fixture.source+'\n');
}
function planFor(bytes) {
  return prepareBoundedSemanticReview({
    snapshot:{
      repository:'deenkids7-dev/deenkids',repository_id:1282086207,
      pr_number:898,head_sha:'a'.repeat(40),base_sha:'b'.repeat(40),
      diff_sha256:SHA(bytes)
    },rawDiffBytes:bytes
  });
}
async function boundedJson(response) {
  if(response?.status!==200||response?.redirected!==false||
    response?.url!==OLLAMA||
    !/^application\/json(?:;|$)/i.test(response.headers?.get('content-type')||'')||
    !response.body?.getReader)deny('OLLAMA_BENCHMARK_HTTP_REJECTED');
  const reader=response.body.getReader();
  const chunks=[];let n=0;
  try {
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))deny('OLLAMA_BENCHMARK_BAD_CHUNK');
      n+=value.length;
      if(n>128*1024)deny('OLLAMA_BENCHMARK_RESPONSE_OVERSIZED');
      chunks.push(Buffer.from(value));
    }
  }catch{deny('OLLAMA_BENCHMARK_READ_FAILED');}
  finally{reader.releaseLock();}
  const body=Buffer.concat(chunks,n);
  const raw=body.toString('utf8');
  if(!Buffer.from(raw).equals(body))deny('OLLAMA_BENCHMARK_ENCODING_INVALID');
  try{return JSON.parse(raw);}catch{deny('OLLAMA_BENCHMARK_INVALID_JSON');}
}
/**
 * Actually invokes a LOCAL model, but ONLY with synthetic public-safe samples.
 * Uses existing fail-closed review modules; NEVER grants independence or PASS.
 */
export async function runSyntheticLocalOllamaBenchmark({
  fetchImpl=fetch,model='qwen2.5-coder:7b',fixtureSet='reference'
}={}) {
  if(typeof fetchImpl!=='function')deny('OLLAMA_BENCHMARK_FETCH_MISSING');
  if(!['reference','holdout'].includes(fixtureSet))deny('OLLAMA_BENCHMARK_UNSUPPORTED_FIXTURES');
  const fixtures=fixtureSet==='holdout'?HOLDOUT_FIXTURES:FIXTURES;
  const cases=[];
  const elapsedMilliseconds=[];
  let totalGeneratedTokens=0,totalEvalNanos=0,validEvalNanos=0;
  const start=performance.now();
  for(const fixture of fixtures){
    const bytes=diff(fixture);
    const plan=planFor(bytes);
    const candidate=prepareOfflineOllamaCandidate({
      plan,model,maxOutputTokens:model==='qwen2.5-coder:1.5b'?512:2048,
      syntheticGpuBenchmark:model==='qwen3.6:35b-a3b-coding'
    });
    const staticAudit=runFailOnlyStaticDiffAudit({diffBytes:bytes,runId:RUN});
    if((staticAudit.blockingFindings>0)!==fixture.knownStaticBlocker)
      deny('OLLAMA_BENCHMARK_STATIC_ORACLE_FAILED');
    // Public, FIXED synthetic cases ONLY: retain weights on ephemeral runner
    // between examples. Production private-source request stays keep_alive:0.
    const syntheticRequest=JSON.parse(candidate.privateRequestJson);
    if(syntheticRequest.keep_alive!==0)deny('OLLAMA_BENCHMARK_UNSAFE_REQUEST');
    syntheticRequest.keep_alive='5m';
    let response;
    const requestStart=performance.now();
    try{
      response=await fetchImpl(OLLAMA,{
        method:'POST',redirect:'error',cache:'no-store',
        signal:AbortSignal.timeout(180000),
        headers:{'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify(syntheticRequest)
      });
    }catch{deny('OLLAMA_BENCHMARK_LOCAL_UNAVAILABLE');}
    const raw=await boundedJson(response);
    const elapsedMs=Math.max(0,performance.now()-requestStart);
    elapsedMilliseconds.push(elapsedMs);
    if(Number.isSafeInteger(raw.eval_count)&&raw.eval_count>=0){
      totalGeneratedTokens+=raw.eval_count;
      if(Number.isSafeInteger(raw.eval_duration)&&raw.eval_duration>0){
        totalEvalNanos+=raw.eval_duration;
        validEvalNanos++;
      }
    }
    const completion=validateOfflineOllamaCompletion({
      response:raw,expectedModel:candidate.model,runId:RUN,
      trustedChangedPaths:plan.changedPaths,
      trustedDiffBytes:bytes,expectedDiffSha256:SHA(bytes),
      maxPromptTokens:8192,maxCompletionTokens:candidate.maxOutputTokens,
      syntheticGpuBenchmark:model==='qwen3.6:35b-a3b-coding'
    });
    const combined=combineReviewerFindings({
      staticReportBytes:staticAudit.reportBytes,
      semanticReportBytes:completion.privateCanonicalReportBytes,
      changedPaths:plan.changedPaths
    });
    if(fixture.knownStaticBlocker&&combined.provisionalState!=='FAIL')
      deny('OLLAMA_BENCHMARK_STATIC_FINDING_LOST');
    // BENCHMARK FIXTURES ARE PUBLIC AND FIXED: expose only short, normalized
    // model explanations so quality failures can be audited. NEVER reuse
    // this console output path with private PR input or authorization tokens.
    const syntheticReport=JSON.parse(completion.privateCanonicalReportBytes.toString('utf8'));
    const modelMessages=syntheticReport.findings.map(f=>
      Object.freeze({severity:f.severity,explanation:f.message.slice(0,160)}));
    const modelText=syntheticReport.findings.map(f=>
      (f.message+' '+f.evidence).toLowerCase()).join(' ');
    const semanticOracleHit=fixture.knownSemanticBug &&
      completion.findingCount>0 && scoreFixedSyntheticOracle(fixture.label,modelText);
    cases.push(Object.freeze({
      label:fixture.label,seededStaticBlocker:fixture.knownStaticBlocker,
      modelMessages:Object.freeze(modelMessages),
      seededSemanticBug:fixture.knownSemanticBug,
      semanticOracleHit,
      semanticFindingDetected:completion.findingCount>0,
      semanticFindingCount:completion.findingCount,
      combinedBlockingCount:combined.blockingFindings,
      provisionalState:combined.provisionalState,
      approvalAuthorized:false,independenceVerified:false
    }));
  }
  const semanticBugCases=cases.filter(c=>c.seededSemanticBug);
  const cleanCases=cases.filter(c=>!c.seededStaticBlocker&&!c.seededSemanticBug);
  const sorted=[...elapsedMilliseconds].sort((a,b)=>a-b);
  const quantile=q=>Number((sorted[Math.ceil(sorted.length*q)-1]/1000).toFixed(3));
  const performanceMetrics=Object.freeze({
    wall_seconds:Number(((performance.now()-start)/1000).toFixed(3)),
    requests:sorted.length,
    request_p50_seconds:quantile(.5),
    request_p95_seconds:quantile(.95),
    request_max_seconds:quantile(1),
    ollama_reported_generated_tokens:totalGeneratedTokens,
    // Null means Ollama omitted eval_duration; never infer a throughput.
    ollama_reported_tokens_per_second:validEvalNanos===sorted.length && totalEvalNanos>0?
      Number((totalGeneratedTokens/(totalEvalNanos/1e9)).toFixed(2)):null,
    gpu_residency_verified:false,
    private_source_processed:false,
  });
  const quality=evaluateSyntheticReviewQuality({
    seededSemanticBugs:semanticBugCases.length,
    seededSemanticBugsDetected:semanticBugCases.filter(c=>c.semanticOracleHit).length,
    cleanFixtures:cleanCases.length,
    cleanFixtureFalseAlerts:cleanCases.filter(c=>c.semanticFindingDetected).length,
    cleanFixtureBlockingFalseAlerts:cleanCases.filter(c=>c.combinedBlockingCount>0).length
  });
  return Object.freeze({
    benchmark:'synthetic-local-ollama-v2',
    qualityGate:quality,
    syntheticQualityGatePassed:quality.syntheticQualityGatePassed,
    testsCompleted:cases.length,model,
    ...(fixtureSet==='holdout'?{fixtureSet:'holdout'}:{}),
    performanceMetrics,
    seededSemanticBugs:semanticBugCases.length,
    seededSemanticBugsDetected:semanticBugCases.filter(c=>c.semanticOracleHit).length,
    cleanFixtures:cleanCases.length,
    cleanFixtureFalseAlerts:cleanCases.filter(c=>c.semanticFindingDetected).length,
    cleanFixtureBlockingFalseAlerts:cleanCases.filter(c=>c.combinedBlockingCount>0).length,
    syntheticMetricsMeetTargets:semanticBugCases.every(c=>c.semanticOracleHit) &&
      cleanCases.every(c=>!c.semanticFindingDetected),
    modelQualityCertified:false,
    cases:Object.freeze(cases),
    independentReviewerProvenanceVerified:false,
    privateSourceReviewed:false,
    approvalAuthorized:false,publishEvent:null
  });
}
/**
 * Keep the optional fixed PUBLIC GPU modes distinct. The previous 7B mode
 * was accidentally selected as Qwen 35B by the CLI ternary.
 * Pure selector: no fetch, no shell, no GPU spending or private diff.
 */
export function resolveRunPodGpuSyntheticSelector(flag){
 if(flag==='--runpod-7b-holdout')
  return Object.freeze({model:'qwen2.5-coder:7b',fixtureSet:'holdout'});
 if(flag==='--runpod-35b-holdout')
  return Object.freeze({model:'qwen3.6:35b-a3b-coding',fixtureSet:'holdout'});
 if(flag==='--runpod-35b-synthetic')
  return Object.freeze({model:'qwen3.6:35b-a3b-coding',fixtureSet:'reference'});
 return null;
}

// This explicit, operator-run CLI only outputs aggregate synthetic metrics.
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    if(process.argv.length>3 ||
      (process.argv[2] &&
        !['--small-synthetic','--large-synthetic','--qwen3-synthetic','--qwen35-synthetic','--qwen35-9b-synthetic','--qwen35-9b-holdout','--coder-30b-synthetic','--runpod-35b-synthetic','--runpod-35b-holdout','--runpod-7b-holdout'].includes(process.argv[2])))
      deny('OLLAMA_BENCHMARK_UNSUPPORTED_ARGUMENT');
    const gpuSelection=resolveRunPodGpuSyntheticSelector(process.argv[2]);
    const model=process.argv[2]==='--small-synthetic'?
      'qwen2.5-coder:1.5b':
      process.argv[2]==='--large-synthetic'?
      'qwen2.5-coder:14b':
      process.argv[2]==='--qwen3-synthetic'? 'qwen3:8b':
      process.argv[2]==='--qwen35-synthetic'? 'qwen3.5:4b':
      ['--qwen35-9b-synthetic','--qwen35-9b-holdout'].includes(process.argv[2])? 'qwen3.5:9b':
      process.argv[2]==='--coder-30b-synthetic'? 'qwen3-coder:30b':
      gpuSelection?.model ?? 'qwen2.5-coder:7b';
    const summary=await runSyntheticLocalOllamaBenchmark({model,
      fixtureSet:gpuSelection?.fixtureSet ??
       (process.argv[2]==='--qwen35-9b-holdout'?'holdout':'reference')});
    process.stdout.write(JSON.stringify(summary)+'\n');
  }catch(error){
    process.stderr.write('LOCAL_SYNTHETIC_BENCHMARK_BLOCKED:'+safeBenchmarkErrorCode(error)+'\n');
    process.exitCode=1;
  }
}
