import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSyntheticLocalOllamaBenchmark,safeBenchmarkErrorCode,evaluateSyntheticReviewQuality,scoreFixedSyntheticOracle }
  from '../bench/ollama-synthetic-benchmark.mjs';

const ENDPOINT='http://127.0.0.1:11434/api/chat';
function response(url,body,status=200,redirected=false){
 const bytes=Buffer.from(JSON.stringify(body));
 return {status,url,redirected,
  headers:new Headers({'content-type':'application/json'}),
  body:new ReadableStream({start(controller){
   controller.enqueue(new Uint8Array(bytes));controller.close();
  }})
 };
}
function mock(options={}){
 const calls=[];
 const fetchImpl=async (url,config)=>{
  calls.push({url,config});
  if(options.throwNetwork)throw Error('Never echo unsafe networking exceptions');
  const requestedPath=JSON.parse(JSON.parse(config.body).messages[1].content)
    .changed_paths[0];
  const wrongDirection=options.wrongDirection &&
    requestedPath==='src/payment-synthetic.mjs';
  const authAlt=options.authAlternative && requestedPath==='src/auth-synthetic.mjs' &&
    JSON.parse(JSON.parse(config.body).messages[1].content).untrusted_unified_diff
      .includes('+function isAuthorized(user) { return true; }');
  const findings=authAlt?[{
    severity:'high',path:requestedPath,line:1,
    message:'Authorization check bypassed',
    evidence:'isAuthorized now always returns true for guests'
  }]:wrongDirection?[{
    severity:'high',path:requestedPath,line:1,
    message:'Negative amount may prevent valid transactions',
    evidence:'This may prevent valid payments'
  }]:[];
  const content=JSON.stringify({summary:'Only synthetic input',findings});
  return response(options.url||url,{
   model:options.model||'qwen2.5-coder:7b',
   done:true,done_reason:'stop',
   message:{role:'assistant',content},
   prompt_eval_count:500,eval_count:120
  },options.status||200,options.redirected||false);
 };
 return {fetchImpl,calls};
}
test('free local benchmark runs twelve FIXED synthetic examples without GitHub or secrets',async()=>{
 const f=mock();
 const result=await runSyntheticLocalOllamaBenchmark({fetchImpl:f.fetchImpl});
 assert.equal(f.calls.length,12);
 assert.equal(result.testsCompleted,12);
 assert.equal(result.seededSemanticBugs,5);
 assert.equal(result.cleanFixtures,5);
 assert.equal(result.cleanFixtureBlockingFalseAlerts,0);
 assert.equal(result.modelQualityCertified,false);
 assert.equal(result.syntheticMetricsMeetTargets,false);
 assert.ok(result.cases.every(c=>Array.isArray(c.modelMessages)));
 assert.ok(result.cases.every(c=>c.modelMessages.length===0));
 assert.equal(result.cases[0].provisionalState,'FAIL');
 assert.equal(result.cases[1].provisionalState,'INCONCLUSIVE');
 assert.equal(result.privateSourceReviewed,false);
 assert.equal(result.independentReviewerProvenanceVerified,false);
 assert.equal(result.approvalAuthorized,false);
 for(const call of f.calls){
  assert.equal(call.url,ENDPOINT);
  assert.equal(call.config.method,'POST');
  assert.equal(call.config.redirect,'error');
  assert.equal(call.config.headers.Accept,'application/json');
  assert.doesNotMatch(call.config.body,/PRIVATE KEY|GITHUB_TOKEN|ghp_/);
  const request=JSON.parse(call.config.body);
  assert.equal(request.model,'qwen2.5-coder:7b');
  assert.equal(request.keep_alive,'5m');
  assert.equal(request.stream,false);
  const payload=JSON.parse(request.messages[1].content);
  assert.equal(payload.changed_paths.length,1);
  assert.match(payload.changed_paths[0],
    /^(?:\.github\/workflows\/fake-synthetic\.yml|src\/[a-z-]+-synthetic\.mjs)$/);
 }
});
test('no remote endpoints, redirects, wrong model or failed HTTP are accepted',async()=>{
 for(const options of [
  {url:'https://example.com/model'},
  {redirected:true},{status:403},{model:'unknown'}
 ]){
  const f=mock(options);
  await assert.rejects(
   ()=>runSyntheticLocalOllamaBenchmark({fetchImpl:f.fetchImpl}),
   /OLLAMA_BENCHMARK_HTTP_REJECTED|OLLAMA_COMPLETION_UNVERIFIED/
  );
 }
});
test('local model unavailable fails closed without exposing request contents',async()=>{
 const f=mock({throwNetwork:true});
 await assert.rejects(
  ()=>runSyntheticLocalOllamaBenchmark({fetchImpl:f.fetchImpl}),
  e=>e.message==='OLLAMA_BENCHMARK_LOCAL_UNAVAILABLE'
 );
 assert.equal(f.calls.length,1);
});

test('optional small public synthetic model is pinned, not a release approval',async()=>{
 const f=mock({model:'qwen2.5-coder:1.5b'});
 const r=await runSyntheticLocalOllamaBenchmark({
  fetchImpl:f.fetchImpl,model:'qwen2.5-coder:1.5b'
 });
 assert.equal(r.model,'qwen2.5-coder:1.5b');
 assert.equal(r.approvalAuthorized,false);
 assert.equal(r.independentReviewerProvenanceVerified,false);
 assert.equal(f.calls.length,12);
 for(const call of f.calls){
  const req=JSON.parse(call.config.body);
  assert.equal(req.model,'qwen2.5-coder:1.5b');
  assert.equal(req.options.num_predict,512);
 }
});

test('benchmark failures expose only allowlisted codes, never private contents',()=>{
 assert.equal(safeBenchmarkErrorCode(new Error('OLLAMA_COMPLETION_UNVERIFIED')),
  'OLLAMA_COMPLETION_UNVERIFIED');
 assert.equal(safeBenchmarkErrorCode(new Error('Bearer UNTRUSTED_SECRET_VALUE')),
  'UNCLASSIFIED');
 assert.equal(safeBenchmarkErrorCode(new Error('OLLAMA_X secret=123')),
  'UNCLASSIFIED');
});

test('14B synthetic selection stays bounded, identity-pinned and nonauthorizing',async()=>{
 const f=mock({model:'qwen2.5-coder:14b'});
 const x=await runSyntheticLocalOllamaBenchmark({
   fetchImpl:f.fetchImpl,model:'qwen2.5-coder:14b'
 });
 assert.equal(x.model,'qwen2.5-coder:14b');
 assert.equal(x.testsCompleted,12);
 assert.equal(x.approvalAuthorized,false);
 assert.equal(x.modelQualityCertified,false);
 assert.equal(f.calls.length,12);
 for(const call of f.calls){
   assert.equal(JSON.parse(call.config.body).model,'qwen2.5-coder:14b');
 }
});

test('hosted synthetic gate checks ten cases rather than a stale four-case count',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/reviewer-b-ollama-synthetic-canary.yml',
   import.meta.url),'utf8');
 assert.match(workflow,/r\.testsCompleted!==12/);
 assert.match(workflow,/r\.cases\.length!==12/);
 assert.doesNotMatch(workflow,/r\.cases\.length!==4/);
});

test('model does not earn a detected-bug score for a backwards or generic explanation',async()=>{
 const f=mock({wrongDirection:true});
 const r=await runSyntheticLocalOllamaBenchmark({fetchImpl:f.fetchImpl});
 assert.equal(r.seededSemanticBugs,5);
 assert.equal(r.seededSemanticBugsDetected,0);
 const negative=r.cases.find(x=>x.label==='negative amount validation weakened');
 assert.equal(negative.semanticFindingCount,1);
 assert.equal(negative.semanticOracleHit,false);
 assert.equal(r.modelQualityCertified,false);
 assert.equal(r.approvalAuthorized,false);
});

test('synthetic quality gate refuses false alerts and missed regressions',()=>{
 const standard={
  seededSemanticBugs:5,seededSemanticBugsDetected:5,
  cleanFixtures:5,cleanFixtureFalseAlerts:0,cleanFixtureBlockingFalseAlerts:0
 };
 const ok=evaluateSyntheticReviewQuality(standard);
 assert.equal(ok.syntheticQualityGatePassed,true);
 assert.equal(ok.modelQualityCertified,false);
 assert.equal(ok.approvalAuthorized,false);
 const missed=evaluateSyntheticReviewQuality({...standard,seededSemanticBugsDetected:4});
 assert.equal(missed.syntheticQualityGatePassed,false);
 assert.ok(missed.blockers.includes('MISSED_SEEDED_SEMANTIC_DEFECT'));
 const noisy=evaluateSyntheticReviewQuality({...standard,cleanFixtureFalseAlerts:2,
  cleanFixtureBlockingFalseAlerts:1});
 assert.equal(noisy.syntheticQualityGatePassed,false);
 assert.ok(noisy.blockers.includes('FALSE_ALERT_ON_SAFE_CHANGE'));
 assert.ok(noisy.blockers.includes('FALSE_BLOCKER_ON_SAFE_CHANGE'));
 assert.throws(()=>evaluateSyntheticReviewQuality({...standard,
  cleanFixtureBlockingFalseAlerts:1}),/OLLAMA_SYNTHETIC_QUALITY_METRICS_INVALID/);
});
test('hosted synthetic workflow cannot report PASS on poor inference quality',()=>{
 const y=readFileSync(new URL('../.github/workflows/reviewer-b-ollama-synthetic-canary.yml',
  import.meta.url),'utf8');
 assert.match(y,/r\.syntheticQualityGatePassed!==true/);
 assert.match(y,/MODEL_QUALITY_GATE_FAILED_NOT_PRODUCTION_READY/);
});

test('directional oracle recognizes authorization-check-bypassed without a vague PASS',async()=>{
 const f=mock({authAlternative:true});
 const r=await runSyntheticLocalOllamaBenchmark({fetchImpl:f.fetchImpl});
 assert.equal(r.seededSemanticBugsDetected,1);
 assert.equal(r.syntheticQualityGatePassed,false);
 assert.equal(r.approvalAuthorized,false);
});

test('third free Qwen3 8B candidate is strictly local and cannot bypass review quality',async()=>{
 const f=mock({model:'qwen3:8b'});
 const result=await runSyntheticLocalOllamaBenchmark({
  fetchImpl:f.fetchImpl,model:'qwen3:8b'
 });
 assert.equal(result.model,'qwen3:8b');
 assert.equal(result.testsCompleted,12);
 assert.equal(result.modelQualityCertified,false);
 assert.equal(result.approvalAuthorized,false);
 assert.equal(result.independentReviewerProvenanceVerified,false);
 for(const c of f.calls){
  const request=JSON.parse(c.config.body);
  assert.equal(request.model,'qwen3:8b');
  assert.equal(request.think,false);
  assert.equal(request.keep_alive,'5m');
  assert.equal(request.options.num_ctx,8192);
  assert.equal(c.url,ENDPOINT);
 }
});
test('experimental Qwen 3.5 4B runs the same 12 synthetic fixtures, never private source',async()=>{
 const f=mock({model:'qwen3.5:4b'});
 const result=await runSyntheticLocalOllamaBenchmark({fetchImpl:f.fetchImpl,model:'qwen3.5:4b'});
 assert.equal(result.model,'qwen3.5:4b');
 assert.equal(result.testsCompleted,12);
 assert.equal(result.modelQualityCertified,false);
 assert.equal(result.approvalAuthorized,false);
 assert.equal(result.independentReviewerProvenanceVerified,false);
 assert.equal(result.privateSourceReviewed,false);
 assert.equal(f.calls.length,12);
 for(const c of f.calls){
  const req=JSON.parse(c.config.body);
  assert.equal(req.model,'qwen3.5:4b');
  assert.equal(req.think,false);
  assert.equal(req.keep_alive,'5m');
  assert.equal(req.options.num_ctx,8192);
  assert.equal(c.url,ENDPOINT);
 }
});

test('opt-in Qwen3 CI must run only synthetic cases with no privileged permissions',()=>{
 const y=readFileSync(new URL('../.github/workflows/reviewer-b-ollama-synthetic-canary.yml',
  import.meta.url),'utf8');
 assert.match(y,/fromJSON\(/);
 assert.match(y,/"model":"qwen3:8b"/);
 assert.match(y,/"cli_arg":"--qwen3-synthetic"/);
 assert.match(y,/reviewer-b-benchmark-qwen3/);
 assert.match(y,/reviewer-b-benchmark-7b/);
 assert.match(y,/contains\(github\.event\.pull_request\.labels\.\*\.name, 'reviewer-b-benchmark'\)/);
 assert.doesNotMatch(y,/security-events:\s*write|secrets\./);
});

test('opt-in Qwen3 and Qwen3.5 benchmarks select their respective models while preserving full comparison label',()=>{
 const y=readFileSync(new URL('../.github/workflows/reviewer-b-ollama-synthetic-canary.yml',import.meta.url),'utf8');
 const options=[...y.matchAll(/'(\[\{"model":.*?\}\])'/g)].map(x=>JSON.parse(x[1]));
 assert.equal(options.length,6);
 assert.deepEqual(options[0],[{model:'qwen2.5-coder:7b',cli_arg:''}]);
 assert.deepEqual(options[1],[{model:'qwen3:8b',cli_arg:'--qwen3-synthetic'}]);
 assert.deepEqual(options[2],[{model:'qwen3.5:4b',cli_arg:'--qwen35-synthetic'}]);
 assert.deepEqual(options[3],[{model:'qwen3.5:9b',cli_arg:'--qwen35-9b-synthetic'}]);
 assert.deepEqual(options[4],[{model:'qwen3.5:9b',cli_arg:'--qwen35-9b-holdout'}]);
 assert.deepEqual(options[5].map(x=>x.model),
  ['qwen2.5-coder:7b','qwen2.5-coder:14b','qwen3:8b']);
 assert.match(y,/reviewer-b-benchmark-qwen35/);
 assert.match(y,/--qwen35-synthetic/);
 assert.match(y,/contains\(github\.event\.pull_request\.labels\.\*\.name, 'reviewer-b-benchmark-qwen3'\)/);
 assert.match(y,/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
 assert.match(y,/^\s*contents:\s*read\s*$/m);
});

test('30B model can be selected manually for fixed synthetic local benchmark only',async()=>{
 const f=mock({model:'qwen3-coder:30b'});
 const x=await runSyntheticLocalOllamaBenchmark({fetchImpl:f.fetchImpl,model:'qwen3-coder:30b'});
 assert.equal(x.model,'qwen3-coder:30b');
 assert.equal(x.testsCompleted,12);
 assert.equal(x.approvalAuthorized,false);
 assert.equal(x.modelQualityCertified,false);
 assert.equal(x.independentReviewerProvenanceVerified,false);
 assert.equal(f.calls.length,12);
 for(const c of f.calls){
  const req=JSON.parse(c.config.body);
  assert.equal(req.model,'qwen3-coder:30b');
  assert.equal(req.keep_alive,'5m');
  assert.equal(c.url,ENDPOINT);
 }
 const workflow=readFileSync(new URL('../.github/workflows/reviewer-b-ollama-synthetic-canary.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow,/model:\s*qwen3-coder:30b/);
 assert.doesNotMatch(workflow,/"model":"qwen3-coder:30b"/);
});

test('synthetic gate cannot pass on caller-forged zero-case metrics',()=>{
 for(const fake of [
  {seededSemanticBugs:0,seededSemanticBugsDetected:0,cleanFixtures:0,
   cleanFixtureFalseAlerts:0,cleanFixtureBlockingFalseAlerts:0},
  {seededSemanticBugs:5,seededSemanticBugsDetected:5,cleanFixtures:0,
   cleanFixtureFalseAlerts:0,cleanFixtureBlockingFalseAlerts:0},
  {seededSemanticBugs:0,seededSemanticBugsDetected:0,cleanFixtures:5,
   cleanFixtureFalseAlerts:0,cleanFixtureBlockingFalseAlerts:0}
 ]){
  assert.throws(()=>evaluateSyntheticReviewQuality(fake),
   e=>e.message==='OLLAMA_SYNTHETIC_QUALITY_METRICS_INVALID');
 }
});

test('R76 benchmark exercises OLD-side deletion grammar on both benign and unsafe changes',async()=>{
 const f=mock();
 const result=await runSyntheticLocalOllamaBenchmark({fetchImpl:f.fetchImpl});
 assert.equal(result.testsCompleted,12);
 assert.equal(result.seededSemanticBugs,5);
 assert.equal(result.cleanFixtures,5);
 const cases=f.calls.map(x=>JSON.parse(x.config.body));
 const old=cases.filter(x=>JSON.parse(x.messages[1].content)
   .untrusted_unified_diff.includes('@@ -1 +0,0 @@'));
 assert.equal(old.length,2);
 for(const item of old){
  const payload=JSON.parse(item.messages[1].content);
  assert.equal(payload.untrusted_unified_diff.includes('+null'),false);
  assert.deepEqual(item.format.properties.findings.items.properties.side.enum,['OLD']);
  assert.deepEqual(item.format.properties.findings.items.properties.line.enum,[1]);
  assert.ok(item.format.properties.findings.items.required.includes('side'));
 }
 const deleted=result.cases.find(x=>
  x.label==='deleted authorization guard without replacement');
 const harmless=result.cases.find(x=>
  x.label==='removed inert diagnostic logging');
 assert.equal(deleted.seededSemanticBug,true);
 assert.equal(deleted.semanticOracleHit,false);
 assert.equal(harmless.seededSemanticBug,false);
 assert.equal(harmless.semanticFindingDetected,false);
 assert.equal(result.syntheticQualityGatePassed,false);
 assert.equal(result.approvalAuthorized,false);
});

test('historical public 4B descriptions are directionally valid, reverse claims stay rejected',()=>{
  const realCorrect=[
    ['removed authorization check',"The function now returns true for all inputs, bypassing the original requirement that only users with role 'admin' are authorized."],
    ['removed authorization check','The isAuthorized function now always returns `true`, bypassing any authorization checks.'],
    ['removed HTML escaping','User input is no longer escaped before rendering, allowing arbitrary HTML/JavaScript execution.'],
    ['negative amount validation weakened','The condition amount < -100 is less restrictive than before, allowing values between -100 and 0 to bypass validation.'],
    ['negative amount validation weakened','Lowering the threshold to -100 may allow previously rejected negative amounts.'],
    ['session token check inverted','Logic inversion causes valid tokens to be rejected and invalid tokens to be accepted.'],
    ['deleted authorization guard without replacement','Removal of isAdmin check allows non-admin users to delete resources.']
  ];
  for(const [label,explanation] of realCorrect)
    assert.equal(scoreFixedSyntheticOracle(label,explanation),true,label);
  const incorrect=[
    ['negative amount validation weakened','Increasing the threshold to -100 may allow valid payments to be incorrectly rejected.'],
    ['session token check inverted','The condition incorrectly accepts a matching token, allowing unauthorized access.'],
    ['removed authorization check','This change now enforces role-based authorization.'],
    ['removed HTML escaping','The change escapes more HTML and is safer.'],
    ['deleted authorization guard without replacement','No authorization check was removed or bypassed.']
  ];
  for(const [label,explanation] of incorrect)
    assert.equal(scoreFixedSyntheticOracle(label,explanation),false,label);
  assert.equal(scoreFixedSyntheticOracle('safe null-checked authorization',
    'Optional chaining may allow unauthorized access.'),false);
  const gate=evaluateSyntheticReviewQuality({
    seededSemanticBugs:5,seededSemanticBugsDetected:5,
    cleanFixtures:5,cleanFixtureFalseAlerts:2,cleanFixtureBlockingFalseAlerts:1
  });
  assert.equal(gate.syntheticQualityGatePassed,false);
  assert.equal(gate.approvalAuthorized,false);
});

test('experimental Qwen 3.5 9B stays PUBLIC synthetic-only and strict fail-closed',async()=>{
 const f=mock({model:'qwen3.5:9b'});
 const result=await runSyntheticLocalOllamaBenchmark({fetchImpl:f.fetchImpl,model:'qwen3.5:9b'});
 assert.equal(result.model,'qwen3.5:9b');
 assert.equal(result.testsCompleted,12);
 assert.equal(result.modelQualityCertified,false);
 assert.equal(result.approvalAuthorized,false);
 assert.equal(result.privateSourceReviewed,false);
 assert.equal(result.independentReviewerProvenanceVerified,false);
 assert.equal(f.calls.length,12);
 for(const call of f.calls){
   const request=JSON.parse(call.config.body);
   assert.equal(request.model,'qwen3.5:9b');
   assert.equal(request.think,false);
   assert.equal(request.options.num_ctx,8192);
   assert.equal(request.keep_alive,'5m');
   assert.equal(call.url,ENDPOINT);
 }
 const yaml=readFileSync(new URL('../.github/workflows/reviewer-b-ollama-synthetic-canary.yml',import.meta.url),'utf8');
 assert.match(yaml,/reviewer-b-benchmark-qwen35-9b/);
 assert.match(yaml,/--qwen35-9b-synthetic/);
 assert.match(yaml,/^\s*contents:\s*read\s*$/m);
 assert.doesNotMatch(yaml,/secrets\.|pull_request_target|contents:\s*write/);
});

test('RunPod 35B is benchmark-only, uses fixed synthetic diffs and preserves native-release denial',async()=>{
 const model='qwen3.6:35b-a3b-coding';
 const f=mock({model});
 const result=await runSyntheticLocalOllamaBenchmark({
   fetchImpl:f.fetchImpl,model
 });
 assert.equal(f.calls.length,12);
 assert.equal(result.model,model);
 assert.equal(result.testsCompleted,12);
 assert.equal(result.modelQualityCertified,false);
 assert.equal(result.approvalAuthorized,false);
 assert.equal(result.privateSourceReviewed,false);
 assert.equal(result.independentReviewerProvenanceVerified,false);
 assert.equal(result.publishEvent,null);
 assert.ok(result.performanceMetrics.wall_seconds>=0);
 assert.ok(result.performanceMetrics.request_p95_seconds>=0);
 assert.equal(result.performanceMetrics.requests,12);
 assert.equal(result.performanceMetrics.gpu_residency_verified,false);
 assert.equal(result.performanceMetrics.ollama_reported_tokens_per_second,null);
 for(const call of f.calls){
   assert.equal(call.url,'http://127.0.0.1:11434/api/chat');
   assert.equal(JSON.parse(call.config.body).model,model);
   assert.equal(JSON.parse(call.config.body).keep_alive,'5m');
   assert.doesNotMatch(call.config.body,/GITHUB_TOKEN|PRIVATE KEY|ghp_/);
 }
 const production=requireProductionWorkflow();
 assert.match(production,/REVIEWER_B_EXPECTED_MODEL: 'qwen2\.5-coder:7b'/);
 assert.doesNotMatch(production,/qwen3\.6:35b-a3b-coding/);
});
function requireProductionWorkflow(){
 return readFileSync(new URL('../.github/workflows/reviewer-b-private-semantic.yml',import.meta.url),'utf8');
}

test('RunPod 35B holdout uses unseen synthetic cases and never promotes a clean model to PASS',async()=>{
 const model='qwen3.6:35b-a3b-coding';
 const f=mock({model});
 const result=await runSyntheticLocalOllamaBenchmark({
   fetchImpl:f.fetchImpl,model,fixtureSet:'holdout'
 });
 assert.equal(result.model,model);
 assert.equal(result.fixtureSet,'holdout');
 assert.equal(result.testsCompleted,12);
 assert.equal(f.calls.length,12);
 assert.equal(result.modelQualityCertified,false);
 assert.equal(result.approvalAuthorized,false);
 assert.equal(result.privateSourceReviewed,false);
 assert.equal(result.independentReviewerProvenanceVerified,false);
 assert.equal(result.publishEvent,null);
 assert.equal(result.performanceMetrics.requests,12);
 for(const call of f.calls){
   assert.equal(call.url,ENDPOINT);
   assert.equal(JSON.parse(call.config.body).model,model);
 }
});
