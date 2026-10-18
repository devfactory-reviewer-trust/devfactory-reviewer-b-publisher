import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assessUniqueOpenRouterServiceRequest,fetchAndVerifyUniqueOpenRouterServiceRequest}
 from '../scripts/openrouter-unique-service-request.mjs';
const sha='a'.repeat(40),model='qwen/qwen3-coder-30b-a3b-instruct';
const command='/review-b-openrouter 939 '+sha+' '+model;
const item=(id=55,pr=939,head=sha,mod=model,who='devfactory-reviewer-service',whoId=340477389)=>({
 id,user:{login:who,id:whoId},
 body:'/review-b-openrouter '+pr+' '+head+' '+mod
});
const args={eventName:'issue_comment',runAttempt:'1',prNumber:939,headSha:sha,
 model,commentId:55};
const uri='https://api.github.com/repos/devfactory-reviewer-trust/devfactory-reviewer-b-publisher/issues/62/comments?per_page=100&page=1';
const fake=(data,{link=null,url=uri,status=200,contentType='application/json'}={})=>
 async (request,options)=>{
  assert.equal(request,uri);
  assert.equal(options.method,'GET');
  assert.equal(options.cache,'no-store');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,undefined);
  return {status,redirected:false,url,
   headers:{get:k=>k==='content-type'?contentType:k==='link'?link:null},
   text:async()=>JSON.stringify(data)};
 };

test('only one exact authenticated service command is first-run read-only evidence',()=>{
 const proof=assessUniqueOpenRouterServiceRequest({...args,comments:[item()]});
 assert.equal(proof.ok,true);
 assert.equal(proof.uniqueFirstAttempt,true);
 assert.equal(proof.maySpend,false);
 assert.equal(proof.mayMerge,false);
 assert.ok(Object.isFrozen(proof));
});
test('deny rerun, workflow_dispatch, service spoof and duplicate model commands',()=>{
 const attacks=[
  {...args,runAttempt:'2',comments:[item()]},
  {...args,runAttempt:'0',comments:[item()]},
  {...args,eventName:'workflow_dispatch',comments:[item()]},
  {...args,commentId:56,comments:[item()]},
  {...args,comments:[item(),item(56)]},
  {...args,comments:[item(),item(56,939,sha,'qwen/qwen3.6-35b-a3b')]},
  {...args,comments:[item(55,939,sha,model,'attacker',340477389)]},
  {...args,comments:[item(55,939,sha,model,'devfactory-reviewer-service',1)]},
  {...args,comments:[item(55,938)]},
  {...args,comments:[item(55,939,'b'.repeat(40))]},
  {...args,comments:[]},
  {...args,comments:Array(101).fill(item())},
  {...args,comments:'[]'},
  {...args,comments:null},
 ];
 for(const attack of attacks){
  const result=assessUniqueOpenRouterServiceRequest(attack);
  assert.equal(result.ok,false,JSON.stringify({attempt:attack.runAttempt,commentId:attack.commentId}));
  assert.equal(result.reason,'OR_UNIQUE_SERVICE_REQUEST_NOT_PROVEN');
 }
});
test('authenticated public GitHub GET verified, no private credentials or payment',async()=>{
 const r=await fetchAndVerifyUniqueOpenRouterServiceRequest({...args,fetchImpl:fake([item()])});
 assert.equal(r.ok,true);
 assert.equal(r.maySpend,false);
});
test('fail closed on incomplete pagination, wrong origin, parse error and network failure',async()=>{
 const bad=[
  fake([item()],{link:'<https://api.github.com/next>; rel="next"'}),
  fake([item()],{url:'https://not-github.invalid'}),
  fake([item()],{status:403}),
  fake([item()],{contentType:'text/html'}),
  async()=>{throw Error('private-error-never-disclose')},
  async()=>({status:200,redirected:false,url:uri,headers:{get:()=>null},
    text:async()=>'not-json'}),
 ];
 for(const fetchImpl of bad){
  await assert.rejects(()=>fetchAndVerifyUniqueOpenRouterServiceRequest({
   ...args,fetchImpl}),/OR_UNIQUE_SERVICE_REQUEST_NOT_PROVEN/);
 }
});
test('paid entrypoint and workflow wire exactly the first-attempt evidence',()=>{
 const root=new URL('../',import.meta.url);
 const real=readFileSync(fileURLToPath(new URL('scripts/protected-real-openrouter-review.mjs',root)),'utf8');
 const request=readFileSync(fileURLToPath(new URL('scripts/protected-openrouter-review-request.mjs',root)),'utf8');
 const workflow=readFileSync(fileURLToPath(new URL('.github/workflows/reviewer-b-private-openrouter.yml',root)),'utf8');
 const first=real.indexOf('const requestProof=await fetchAndVerifyUniqueOpenRouterServiceRequest');
 const second=real.indexOf('const budget=assessAuthenticatedOpenRouterSpendAuthorization');
 const third=real.indexOf('const cloud=await executeCompleteOpenRouterSemanticReview');
 assert.ok(first>=0&&second>first&&third>second);
 assert.match(real,/stage='UNIQUE_REQUEST'/);
 assert.match(real,/runAttempt:env\.GITHUB_RUN_ATTEMPT/);
 assert.match(real,/commentId:Number\(env\.REVIEWER_B_REQUEST_COMMENT_ID\)/);
 assert.match(request,/request_comment_id=/);
 assert.match(workflow,/REVIEWER_B_REQUEST_COMMENT_ID:\s*\$\{\{ steps\.cloud_request\.outputs\.request_comment_id \}\}/);
 assert.doesNotMatch(workflow,/\b(?:pull_request|pull_request_target|schedule)\s*:/);
});
