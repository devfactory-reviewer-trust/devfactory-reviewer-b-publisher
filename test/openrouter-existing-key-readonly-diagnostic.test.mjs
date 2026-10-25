import test from 'node:test';
import assert from 'node:assert/strict';
import {runExistingOpenRouterKeyReadOnlyDiagnostic} from '../scripts/openrouter-existing-key-readonly-diagnostic.mjs';

const KEY='sk-or-abc_123_456_789_abcdefghijklmno';
const KEY_URL='https://openrouter.ai/api/v1/key';
const ZDR_URL='https://openrouter.ai/api/v1/models?zdr=true';
const MODEL='qwen/qwen3-coder-30b-a3b-instruct';
const CONTEXT={
  GITHUB_REPOSITORY:'devfactory-reviewer-trust/devfactory-reviewer-b-publisher',
  GITHUB_REF:'refs/heads/main',
  GITHUB_ACTOR:'devfactory-reviewer-service',
  GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_WORKFLOW_REF:'devfactory-reviewer-trust/devfactory-reviewer-b-publisher/.github/workflows/reviewer-b-openrouter-key-readonly.yml@refs/heads/main',
  GITHUB_RUN_ATTEMPT:'1',
  REVIEWER_B_OPENROUTER_API_KEY:KEY,
};
function network({limit=3,reset='monthly',zdr=true}={}){
  const requests=[];
  const fetchImpl=async(url,opts)=>{
    requests.push({url,method:opts.method,body:opts.body,authorization:opts.headers.Authorization});
    assert.equal(opts.method,'GET','diagnostic may never send paid POST');
    assert.equal(opts.body,undefined,'diagnostic may never send a request body');
    let obj;
    if(url===KEY_URL) obj={data:{limit,limit_reset:reset,limit_remaining:Math.min(2.8,limit),usage_monthly:0.2}};
    else if(url===ZDR_URL) obj={data: zdr ? [{id:MODEL,supported_parameters:['structured_outputs'],pricing:{prompt:'0.00000007',completion:'0.00000028'}}] : []};
    else assert.fail('unexpected network endpoint');
    return {url,status:200,redirected:false,headers:new Headers({'content-type':'application/json'}),body:new Response(JSON.stringify(obj)).body};
  };
  return {fetchImpl,requests};
}
test('existing protected $3 key checked with exactly two GETs, no paid call or private data',async()=>{
  const net=network();
  const out=await runExistingOpenRouterKeyReadOnlyDiagnostic({env:CONTEXT,fetchImpl:net.fetchImpl});
  assert.deepEqual(out,{ok:true,code:'EXISTING_KEY_CAP_LE_3_AND_ZDR_CANDIDATE_VERIFIED',maySpend:false,mayMerge:false,mayStart:false});
  assert.deepEqual(net.requests.map(v=>v.url),[KEY_URL,ZDR_URL]);
  assert.equal(net.requests[0].authorization,'Bearer '+KEY);
  assert.equal(net.requests[1].authorization,undefined);
  assert.doesNotMatch(JSON.stringify(out),/sk-or-|PRIVATE|Bearer/);
});
test('wrong actor, ref, workflow, event, rerun or missing key refuse before network',async()=>{
  for(const patch of [
    {GITHUB_ACTOR:'deenkids7-dev'},{GITHUB_REF:'refs/heads/feature'},
    {GITHUB_WORKFLOW_REF:'other'},{GITHUB_EVENT_NAME:'push'},
    {GITHUB_RUN_ATTEMPT:'2'},{REVIEWER_B_OPENROUTER_API_KEY:undefined},
  ]){
    const net=network();
    const out=await runExistingOpenRouterKeyReadOnlyDiagnostic({env:{...CONTEXT,...patch},fetchImpl:net.fetchImpl});
    assert.equal(out.ok,false);
    assert.equal(out.maySpend,false);
    assert.deepEqual(net.requests,[]);
  }
});
test('unlimited or above $3 and nonmonthly keys fail after first GET only',async()=>{
  for(const props of [{limit:10},{limit:Infinity},{reset:'daily'}]){
    const net=network(props);
    const out=await runExistingOpenRouterKeyReadOnlyDiagnostic({env:CONTEXT,fetchImpl:net.fetchImpl});
    assert.equal(out.ok,false);
    assert.deepEqual(net.requests.map(v=>v.url),[KEY_URL]);
  }
});
test('model not present in ZDR eligible list refuses without paid inference',async()=>{
  const net=network({zdr:false});
  const out=await runExistingOpenRouterKeyReadOnlyDiagnostic({env:CONTEXT,fetchImpl:net.fetchImpl});
  assert.equal(out.ok,false);
  assert.equal(out.maySpend,false);
  assert.deepEqual(net.requests.map(v=>v.url),[KEY_URL,ZDR_URL]);
});
