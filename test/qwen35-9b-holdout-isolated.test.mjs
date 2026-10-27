import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runSyntheticLocalOllamaBenchmark,scoreFixedSyntheticOracle} from '../bench/ollama-synthetic-benchmark.mjs';
import {HOLDOUT_SEMANTIC_FIXTURES,HOLDOUT_SEMANTIC_LABELS} from '../bench/ollama-holdout-fixtures.mjs';

const MODEL='qwen3.5:9b';
const ENDPOINT='http://127.0.0.1:11434/api/chat';
test('9B holdout is strictly ten new public scenarios with five planted defects',()=>{
 assert.equal(HOLDOUT_SEMANTIC_FIXTURES.length,10);
 assert.equal(HOLDOUT_SEMANTIC_FIXTURES.filter(f=>f.knownSemanticBug).length,5);
 assert.equal(HOLDOUT_SEMANTIC_FIXTURES.filter(f=>!f.knownSemanticBug).length,5);
 assert.equal(new Set(HOLDOUT_SEMANTIC_FIXTURES.map(f=>f.path)).size,10);
 assert.equal(new Set(HOLDOUT_SEMANTIC_FIXTURES.map(f=>f.label)).size,10);
 assert.equal(HOLDOUT_SEMANTIC_LABELS.length,5);
});
test('9B holdout sends ONLY twelve fixed public cases and forbids production approval',async()=>{
 const requests=[];
 const fakeFetch=async(url,options)=>{
   assert.equal(url,ENDPOINT);
   const request=JSON.parse(options.body);
   requests.push(request);
   const bytes=Buffer.from(JSON.stringify({
     model:MODEL,done:true,done_reason:'stop',
     message:{role:'assistant',content:'{"summary":"Public synthetic mock only","findings":[]}'},
     prompt_eval_count:100,eval_count:16,eval_duration:1_000_000_000
   }));
   return {url,status:200,redirected:false,
     headers:new Headers({'content-type':'application/json'}),
     body:new ReadableStream({start(c){c.enqueue(new Uint8Array(bytes));c.close();}})
   };
 };
 const report=await runSyntheticLocalOllamaBenchmark({
   fetchImpl:fakeFetch,model:MODEL,fixtureSet:'holdout'
 });
 assert.equal(report.fixtureSet,'holdout');
 assert.equal(report.testsCompleted,12);
 assert.equal(report.seededSemanticBugs,5);
 assert.equal(report.cleanFixtures,5);
 assert.equal(report.seededSemanticBugsDetected,0);
 assert.equal(report.syntheticQualityGatePassed,false);
 assert.equal(report.modelQualityCertified,false);
 assert.equal(report.approvalAuthorized,false);
 assert.equal(report.privateSourceReviewed,false);
 assert.equal(report.independentReviewerProvenanceVerified,false);
 assert.equal(requests.length,12);
 assert.equal(report.cases.filter(c=>c.seededStaticBlocker).length,2);
 for(const req of requests){
   assert.equal(req.model,MODEL);
   assert.equal(req.stream,false);
   assert.equal(req.think,false);
   assert.equal(req.keep_alive,'5m');
   assert.equal(req.options.num_ctx,8192);
 }
});
test('9B holdout scoring recognizes directionally valid public explanations only',()=>{
 for(const [label,msg] of [
  ['holdout password reset expiry inversion','Valid unexpired reset tokens are rejected.'],
  ['holdout tenant admin guard loosened','Non-admin users are granted access to tenant targets.'],
  ['holdout disabled account check inverted','Disabled accounts are allowed to authenticate.'],
  ['holdout exception handler fails open','The catch returns true on exceptions, failing open.'],
  ['holdout API key redaction removed','The API key is exposed without redaction.']
 ])assert.equal(scoreFixedSyntheticOracle(label,msg),true,label);
 for(const label of HOLDOUT_SEMANTIC_LABELS)
   assert.equal(scoreFixedSyntheticOracle(label,'No regression; this is a safe refactor.'),false,label);
 assert.equal(scoreFixedSyntheticOracle('holdout safe boolean reorder','Unauthorized access'),false);
});
test('9B holdout CI cannot grant privilege or launch other model benchmarks',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/reviewer-b-ollama-synthetic-canary.yml',import.meta.url),'utf8');
 const variants=[...workflow.matchAll(/'(\[\{\"model\":.*?\}\])'/g)].map(m=>JSON.parse(m[1]));
 assert.equal(variants.length,6);
 assert.deepEqual(variants[4],[{model:MODEL,cli_arg:'--qwen35-9b-holdout'}]);
 assert.match(workflow,/reviewer-b-benchmark-qwen35-9b-holdout/);
 assert.match(workflow,/SYNTHETIC_FIXTURE_SET_MISMATCH/);
 assert.match(workflow,/timeout-minutes:\s*45/);
 assert.match(workflow,/^\s*contents:\s*read\s*$/m);
 assert.doesNotMatch(workflow,/secrets\.|pull_request_target|security-events:\s*write/);
});
