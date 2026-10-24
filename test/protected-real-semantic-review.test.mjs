import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from 'node:util';
import {readFileSync} from 'node:fs';
import {canRunRealSemanticReview,prepareRealSemanticComment,
  publishRealSemanticComment,executeProtectedRealSemanticReview,
  classifyProtectedReviewFailure}
  from '../scripts/protected-real-semantic-review.mjs';
import * as protectedScript from '../scripts/protected-real-semantic-review.mjs';

const HEAD='a'.repeat(40),BASE='b'.repeat(40),DIFF='c'.repeat(64);
const RUN='gh-38140023698-1', PR=899;
const URL='https://api.github.com/repos/deenkids7-dev/deenkids/pulls/899';
const READ='test-read-token-98765432',WRITE='test-write-token-12345678';
const env=()=>({
 GITHUB_REPOSITORY:'devfactory-reviewer-trust/devfactory-reviewer-b-publisher',
 GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_ACTOR:'devfactory-reviewer-service',
 GITHUB_SHA:'f'.repeat(40),GITHUB_RUN_ID:'38140023698',
 GITHUB_RUN_ATTEMPT:'1',REVIEWER_B_TARGET_PR:'899',
 GITHUB_WORKFLOW_REF:'devfactory-reviewer-trust/devfactory-reviewer-b-publisher/.github/workflows/reviewer-b-private-semantic.yml@refs/heads/main',
 REVIEWER_B_EXPECTED_MODEL:'qwen2.5-coder:7b'
});
const preflight=()=>({
 target:{repository:'deenkids7-dev/deenkids',repositoryId:1282086207,
  prNumber:PR,headSha:HEAD,baseSha:BASE,diffSha256:DIFF},
 staticDisposition:'INCONCLUSIVE',blockingFindings:0,
 approvalAuthorized:false,independentReviewVerified:false,publishEvent:null,
 privateSemanticPlan:{changedPaths:['src/a.mjs']}
});
const report=(findings=[])=>Buffer.from(JSON.stringify({
 schema:'devfactory.reviewer-b.findings.v1',run_id:RUN,
 summary:'A real-model structured report from a PRIVATE test diff.',findings
}));
const local=(findings=[])=>({
 model:'qwen2.5-coder:7b',localModelExecuted:true,
 rawByteCoverageProven:true,originalDiffSha256:DIFF,processedShardCount:2,
 provisionalState:findings.length?'FAIL':'INCONCLUSIVE',
 findingCount:findings.length,localResponseSha256:'d'.repeat(64),
 privateCanonicalReportBytes:report(findings),
 approvalAuthorized:false,independentReviewVerified:false,publishEvent:null
});
const finding=()=>({severity:'high',path:'src/a.mjs',line:4,
 message:'Access check accepts a non-owner',evidence:'Specified test input bypasses guard',
 fingerprint:'e'.repeat(64)});
const prepared=()=>prepareRealSemanticComment({preflight:preflight(),local:local(),runId:RUN});
test('protected execution requires exact trusted main, workflow, actor and MODEL',()=>{
 assert.equal(canRunRealSemanticReview(env()),true);
 assert.equal(canRunRealSemanticReview({...env(),GITHUB_EVENT_NAME:'push',
  REVIEWER_B_TARGET_PR:'899'}),true);
 assert.equal(canRunRealSemanticReview({...env(),GITHUB_EVENT_NAME:'issue_comment',
  REVIEWER_B_TARGET_PR:'901',REVIEWER_B_EXPECTED_HEAD:HEAD}),true);
 assert.equal(canRunRealSemanticReview({...env(),GITHUB_EVENT_NAME:'issue_comment',
  REVIEWER_B_TARGET_PR:'901',REVIEWER_B_EXPECTED_HEAD:'invalid'}),false);
 assert.equal(canRunRealSemanticReview({...env(),GITHUB_EVENT_NAME:'issue_comment',
  REVIEWER_B_TARGET_PR:'901',REVIEWER_B_EXPECTED_HEAD:null}),false);
 for(const patch of [
  {GITHUB_ACTOR:'deenkids7-dev'},{GITHUB_REF:'refs/heads/dev'},
  {GITHUB_EVENT_NAME:'pull_request'},
  {GITHUB_EVENT_NAME:'push',REVIEWER_B_TARGET_PR:'898'},
  {GITHUB_WORKFLOW_REF:'attacker/other'},
  {REVIEWER_B_TARGET_PR:'0'},{REVIEWER_B_TARGET_PR:'899;rm'},
  {REVIEWER_B_EXPECTED_MODEL:'gemini-expensive'},
  {GITHUB_SHA:'invalid'}
 ])assert.equal(canRunRealSemanticReview({...env(),...patch}),false);
});
test('no protected environment key means no PRIVATE source or external HTTP',async()=>{
 let calls=0;
 for(const patch of [{},{REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM:null}]){
  const result=await executeProtectedRealSemanticReview({env:{...env(),...patch},
   fetchImpl:async()=>{calls++;throw Error('DO_NOT_CALL');}});
  assert.deepEqual(result,{ok:false,code:'CREDENTIAL_NOT_PROVISIONED'});
 }
 assert.equal(calls,0);
});
test('real LOCAL response is represented as COMMENT, never approval',()=>{
 const p=prepared();
 assert.equal(p.event,'COMMENT');
 assert.equal(p.approvalAuthorized,false);
 assert.equal(p.independentReviewVerified,false);
 assert.match(p.body,/INCONCLUSIVE/);
 assert.match(p.body,/Full-diff local model parts completed: 2/);
 assert.match(p.body,/Real local response SHA-256/);
 assert.match(p.body,/NO automated PASS/);
 assert.doesNotMatch(p.body,/event:\s*APPROVE/);
});
test('exact-head service issue may request stacked advisory, never dispatch or untrusted actor',()=>{
 const trusted={...env(),GITHUB_EVENT_NAME:'issue_comment',
  REVIEWER_B_EXPECTED_HEAD:HEAD};
 assert.equal(typeof protectedScript.selectAdvisoryStackedScope,'function');
 assert.equal(protectedScript.selectAdvisoryStackedScope(trusted),true);
 for(const candidate of [env(),{...trusted,GITHUB_EVENT_NAME:'workflow_dispatch'},
   {...trusted,REVIEWER_B_EXPECTED_HEAD:''},
   {...trusted,GITHUB_ACTOR:'deenkids7-dev'},
   {...trusted,GITHUB_REF:'refs/heads/development'},
   {...trusted,GITHUB_WORKFLOW_REF:'attacker/other'}])
  assert.equal(protectedScript.selectAdvisoryStackedScope(candidate),false);
});

test('stacked Qwen COMMENT clearly warns it is only an incremental branch delta',()=>{
 const review=prepareRealSemanticComment({
  preflight:{...preflight(),target:{...preflight().target,
    baseRef:'codex/openrouter-offline-startup-audit-20261021'}},
  local:local(),runId:RUN
 });
 assert.equal(review.event,'COMMENT');
 assert.match(review.body,/STACKED BRANCH DELTA ONLY/);
 assert.match(review.body,/codex\/openrouter-offline-startup-audit-20261021/);
 assert.match(review.body,/does not validate unmerged base ancestry/);
 assert.equal(review.approvalAuthorized,false);
 assert.equal(review.independentReviewVerified,false);
 const ordinary=prepared();
 assert.doesNotMatch(ordinary.body,/STACKED BRANCH DELTA ONLY/);
});
test('protected native Qwen report declares QUICK or DEEP and Gemini is NEVER a required gate',()=>{
 const quick=prepareRealSemanticComment({
  preflight:preflight(),local:{...local(),reviewMode:'QUICK',
   geminiAdvisoryRecommended:false},runId:RUN
 });
 assert.match(quick.body,/Local review lane: QUICK/);
 assert.match(quick.body,/Gemini supplemental review: NOT_REQUIRED/);
 const deep=prepareRealSemanticComment({
  preflight:preflight(),local:{...local(),reviewMode:'DEEP',
   geminiAdvisoryRecommended:true},runId:RUN
 });
 assert.match(deep.body,/Local review lane: DEEP/);
 assert.match(deep.body,/Gemini supplemental review: SUGGESTED_NON_BLOCKING/);
 assert.match(deep.body,/NO automated PASS or merge authority/);
 assert.equal(quick.approvalAuthorized,false);
 assert.equal(deep.independentReviewVerified,false);
 for(const patch of [
  {reviewMode:'SKIP'},
  {reviewMode:['DEEP']},
  {geminiAdvisoryRecommended:'true'},
  {reviewMode:'QUICK',geminiAdvisoryRecommended:true},
 ])assert.throws(()=>prepareRealSemanticComment({
  preflight:preflight(),local:{...local(),...patch},runId:RUN
 }),/REAL_SEMANTIC_PROOF_INVALID/);
});
test('exhaustive large real Qwen report still lists every finding as a bounded COMMENT',()=>{
 const alerts=Array.from({length:45},(_,i)=>({
   severity:'high',path:'src/a.mjs',line:4,
   message:'Concrete behavior regression '+String(i).padStart(2,'0')+' '+('m'.repeat(420)),
   evidence:'Actual input and failing outcome '+i+' '+('e'.repeat(850)),
   fingerprint:i.toString(16).padStart(64,'0')
 }));
 const large=report(alerts);
 assert.ok(large.length>16384&&large.length<96*1024);
 const result=prepareRealSemanticComment({
   preflight:preflight(),
   local:{...local(alerts),privateCanonicalReportBytes:large},
   runId:RUN
 });
 assert.equal(result.event,'COMMENT');
 assert.ok(result.body.length<=12000);
 assert.match(result.body,/45 of 45 authentic local Qwen findings listed/);
 assert.match(result.body,/COMPACT FINDING EXCERPTS/);
 assert.match(result.body,/Evidence excerpt:/);
 assert.match(result.body,/Actual input and failing outcome/);
 for(let i=0;i<45;i++)
   assert.match(result.body,new RegExp('Concrete behavior regression '+String(i).padStart(2,'0')));
 assert.equal(result.approvalAuthorized,false);
 assert.equal(result.independentReviewVerified,false);
 assert.doesNotMatch(result.body,/APPROVED|automated PASS granted/);
});
test('R69 noisy 47-finding native review contains readable evidence and no authority',()=>{
 const alerts=Array.from({length:47},(_,i)=>({
  severity:i%4===0?'critical':'high',path:'src/a.mjs',line:4,
  message:'Undefined symbol finding '+i+' requires checking imported declarations '+('m'.repeat(380)),
  evidence:'Claim based on isolated shard '+i+'; inspect complete source scope '+('e'.repeat(700)),
  fingerprint:i.toString(16).padStart(64,'0')
 }));
 const result=prepareRealSemanticComment({preflight:preflight(),
  local:{...local(alerts),privateCanonicalReportBytes:report(alerts)},runId:RUN});
 assert.equal(result.event,'COMMENT');
 assert.ok(result.body.length<=12000);
 assert.match(result.body,/47 of 47 authentic local Qwen findings listed/);
 assert.match(result.body,/Evidence excerpt:/);
 assert.match(result.body,/Undefined symbol finding/);
 assert.match(result.body,/Claim based on isolated shard/);
 for(let i=1;i<=47;i++)assert.ok(result.body.includes('- #'+i+' '));
 assert.equal(result.approvalAuthorized,false);
 assert.equal(result.independentReviewVerified,false);
});
test('R109 complete report with more than 50 findings is still publishable',()=>{
 const alerts=Array.from({length:65},(_,i)=>({
  severity:'high',path:'src/a.mjs',line:4,
  message:'Concrete synthetic issue '+i+' '+('m'.repeat(390)),
  evidence:'Verified synthetic failing input '+i+' '+('e'.repeat(690)),
  fingerprint:i.toString(16).padStart(64,'0')
 }));
 const bytes=report(alerts);
 assert.ok(bytes.length<96*1024);
 const result=prepareRealSemanticComment({
  preflight:preflight(),local:local(alerts),runId:RUN
 });
 assert.equal(result.event,'COMMENT');
 assert.equal(result.approvalAuthorized,false);
 assert.ok(result.body.length<=12000);
 assert.match(result.body,/65 of 65 authentic local Qwen findings listed/);
 for(let i=0;i<65;i++)assert.ok(result.body.includes('- #'+(i+1)+' '));
 assert.match(result.body,/Real local report SHA-256/);
});
test('R109 path legend indexes 128 findings with exact paths and no dropped entry',()=>{
 const paths=Array.from({length:9},(_,i)=>
  'src/very-long-authenticated-path-'+i+'-'+('p'.repeat(96))+'.mjs');
 const alerts=Array.from({length:128},(_,i)=>({
  severity:i%2===0?'high':'medium',path:paths[i%paths.length],line:i+1,
  message:'Synthetic issue '+i+' with a specific affected scenario',
  evidence:'Synthetic input '+i+' causes the wrong branch',
  fingerprint:i.toString(16).padStart(64,'0')
 }));
 const p={...preflight(),privateSemanticPlan:{changedPaths:paths}};
 const bytes=report(alerts);
 assert.ok(bytes.length<96*1024);
 const result=prepareRealSemanticComment({
  preflight:p,local:local(alerts),runId:RUN
 });
 assert.equal(result.event,'COMMENT');
 assert.ok(result.body.length<=12000);
 assert.match(result.body,/COMPLETE COMPACT FINDING INDEX: 128 of 128/);
 for(let i=0;i<128;i++)assert.ok(result.body.includes('- #'+(i+1)+' '));
 for(let i=0;i<9;i++)assert.ok(result.body.includes('P'+(i+1)+': '+paths[i]));
 assert.match(result.body,/Evidence:/);
 assert.equal(result.approvalAuthorized,false);
 assert.equal(result.independentReviewVerified,false);
});
test('R109 excessive report still fails closed instead of silently truncating',()=>{
 const alerts=Array.from({length:129},(_,i)=>({
  ...finding(),message:'Synthetic issue '+i,
  fingerprint:i.toString(16).padStart(64,'0')
 }));
 assert.throws(()=>prepareRealSemanticComment({
  preflight:preflight(),local:local(alerts),runId:RUN
 }),/REAL_SEMANTIC_REPORT_MISMATCH/);
});
test('oversized full Qwen report remains fail-closed instead of silently dropping findings',()=>{
 const over={...local(),privateCanonicalReportBytes:Buffer.alloc(96*1024+1,65)};
 assert.throws(()=>prepareRealSemanticComment({
   preflight:preflight(),local:over,runId:RUN
 }),/REAL_SEMANTIC_PRIVATE_REPORT_OVERSIZED/);
});
test('actual model finding is bounded, attributed to changed file, still not PASS',()=>{
 const p=prepareRealSemanticComment({preflight:preflight(),
   local:local([finding()]),runId:RUN});
 assert.match(p.body,/PROVISIONAL_FINDINGS/);
 assert.match(p.body,/src\/a.mjs:4/);
 assert.match(p.body,/Access check accepts a non-owner/);
 assert.equal(p.approvalAuthorized,false);
});
test('LOW nonblocking model finding remains INCONCLUSIVE but is not discarded',()=>{
 const f={...finding(),severity:'low'};
 const observed={...local([f]),provisionalState:'INCONCLUSIVE'};
 const p=prepareRealSemanticComment({preflight:preflight(),local:observed,runId:RUN});
 assert.match(p.body,/INCONCLUSIVE/);
 assert.match(p.body,/LOW src\/a.mjs:4/);
 assert.equal(p.approvalAuthorized,false);
});
test('unsafe model message cannot inject mentions, tags or markdown code fences',()=>{
 const f={...finding(),message:'@everyone <script> bad'+String.fromCharCode(96)+'payload'};
 const p=prepareRealSemanticComment({preflight:preflight(),
   local:local([f]),runId:RUN});
 assert.doesNotMatch(p.body,/@everyone|<script>|bad\x60payload/);
 assert.match(p.body,/＠|_everyone/);
});
test('R70 static blocker cannot become a publishable model advisory',()=>{
 const blocked={...preflight(),staticDisposition:'FAIL',blockingFindings:1};
 assert.throws(()=>prepareRealSemanticComment({
  preflight:blocked,local:local(),runId:RUN
 }),/STATIC_FINDINGS_BLOCK/);
 const src=readFileSync(new globalThis.URL(
  '../scripts/protected-real-semantic-review.mjs',import.meta.url),'utf8');
 assert.ok(src.indexOf("deny('STATIC_FINDINGS_BLOCK')")<
           src.indexOf("await executeCompleteLocalSemanticReview("));
 assert.equal(classifyProtectedReviewFailure('PRIVATE_PREFLIGHT',
  Error('STATIC_FINDINGS_BLOCK')),
  'REAL_REVIEW_PRIVATE_PREFLIGHT_STATIC_FINDINGS_BLOCK');
});
test('R70 model text cannot create external Markdown links or images',()=>{
 const f={...finding(),
  message:'[click me](https://bad.example/x) ![track](https://bad.example/i)',
  evidence:'www.attacker.example or [more](javascript:alert(1))'};
 const p=prepareRealSemanticComment({preflight:preflight(),
  local:local([f]),runId:RUN});
 assert.doesNotMatch(p.body,/https?:\/\/bad\.example|www\.attacker\.example/);
 assert.doesNotMatch(p.body,/\]\(|!\[/);
 assert.match(p.body,/external_link_redacted/);
});
test('reject fake or stale model, body, report, path and authority before publication',()=>{
 const patches=[
  {local:{...local(),localModelExecuted:false}},
  {local:{...local(),model:'qwen3:8b'}},
  {local:{...local(),approvalAuthorized:true}},
  {local:{...local(),privateCanonicalReportBytes:Buffer.from('not json')}},
  {local:{...local(),findingCount:7}},
  {local:local([{...finding(),path:'secrets/other'}])},
  {preflight:{...preflight(),target:{...preflight().target,headSha:'x'.repeat(40)}}},
  {preflight:{...preflight(),independentReviewVerified:true}},
  {runId:'evil'}
 ];
 for(const patch of patches)assert.throws(()=>prepareRealSemanticComment({
  preflight:preflight(),local:local(),runId:RUN,...patch
 }),/REPORT_|SEMANTIC_|REAL_|PROOF_|UNSAFE/);
});
const reply=(url,obj)=>({url,redirected:false,status:200,
 headers:{get:key=>key==='content-type'?'application/json':null},
 body:new Response(JSON.stringify(obj)).body});
function emulator({changedHead=false,override=null,existing=null}={}){
 let post=null,n=0,calls=[];
 const fetchImpl=async(url,opt)=>{
  calls.push({url,method:opt.method,auth:opt.headers.Authorization});
  if(url===URL&&opt.method==='GET')
   return reply(url,{number:PR,state:'open',merged_at:null,
    head:{sha:changedHead?'f'.repeat(40):HEAD,
     repo:{id:1282086207,full_name:'deenkids7-dev/deenkids'}},
    base:{repo:{id:1282086207,full_name:'deenkids7-dev/deenkids'}}});
  if(url===URL+'/reviews?per_page=100&page=1'&&opt.method==='GET')
    return reply(url,[...(existing?[existing]:[]),...(post?[post]:[])]);
  if(url===URL+'/reviews'&&opt.method==='POST'){
    n++;
    const payload=JSON.parse(opt.body);
    post={id:1234567,state:'COMMENTED',commit_id:payload.commit_id,
      body:payload.body,pull_request_url:URL,
      user:{id:340237276,login:'devfactory-reviewer-b[bot]'},
      submitted_at:'2026-10-11T18:00:00Z',...override};
    return reply(url,post);
  }
  throw Error('WRONG_HTTP_ENDPOINT');
 };
 return {fetchImpl,calls,posts:()=>n};
}
const args=(em,other={})=>({plan:prepared(),readToken:READ,writeToken:WRITE,
 approvedProtectedPublication:true,fetchImpl:em.fetchImpl,...other});
test('Gemini findings: missing or mistyped report fields are explicitly denied',()=>{
 const examples=[
   {summary:undefined}, {summary:null}, {summary:42},
   {summary:[]}, {summary:''}, {summary:' '.repeat(3)},
   {summary:'X'.repeat(2001)}
 ];
 for(const change of examples){
   const raw=JSON.parse(report().toString('utf8'));
   Object.assign(raw,change);
   const candidate={...local(),privateCanonicalReportBytes:
     Buffer.from(JSON.stringify(raw))};
   assert.throws(()=>prepareRealSemanticComment({
     preflight:preflight(),local:candidate,runId:RUN
   }),/REAL_SEMANTIC_REPORT_MISMATCH/);
 }
 for(const invalid of [
   {message:null}, {message:2}, {message:[]}, {message:' '},
   {message:'X'.repeat(501)},
   {evidence:null}, {evidence:4}, {evidence:[]},
   {evidence:' '},{evidence:'X'.repeat(1001)},
   {fingerprint:['e'.repeat(64)]}
 ]){
   const findingValue={...finding(),...invalid};
   const candidate=local([findingValue]);
   assert.throws(()=>prepareRealSemanticComment({
     preflight:preflight(),local:candidate,runId:RUN
   }),/REPORT_FINDING_INVALID/);
 }
});
test('real PRIVATE semantic report is published exactly as native COMMENTED',async()=>{
 const em=emulator();
 const result=await publishRealSemanticComment(args(em));
 assert.equal(result.code,'REAL_REVIEW_COMMENT_VERIFIED');
 assert.equal(result.reviewId,1234567);
 assert.equal(result.approvalAuthorized,false);
 assert.equal(em.posts(),1);
 assert.equal(em.calls.filter(c=>c.method==='POST')[0].auth,'Bearer '+WRITE);
 assert.ok(em.calls.filter(c=>c.method==='GET')
  .every(c=>c.auth==='Bearer '+READ));
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TEST_SECRET/);
 assert.doesNotMatch(inspect(result),/PRIVATE_TEST_SECRET/);
});
test('Gemini: null or malformed native POST response fails closed',async()=>{
 for(const invalid of [null,undefined,{}]){
  const em=emulator();
  await assert.rejects(()=>publishRealSemanticComment(args(em,{
   fetchImpl:async(url,opt)=>{
    if(url===URL+'/reviews'&&opt.method==='POST')return invalid;
    return em.fetchImpl(url,opt);
   }
  })),/SEMANTIC_POST_REJECTED/);
 }
});
test('cannot POST when human protected environment authorization is absent',async()=>{
 const em=emulator();
 for(const value of [undefined,false,'true',1,null]){
  await assert.rejects(()=>publishRealSemanticComment(args(em,{
   approvedProtectedPublication:value})),/SEMANTIC_PUBLISH_DENIED/);
 }
 assert.equal(em.calls.length,0);
});
test('live HEAD drift, prior bot review, wrong bot and fake APPROVED fail closed',async()=>{
 const cases=[
  [emulator({changedHead:true}),/REVIEWS_HEAD_CHANGED/],
  [emulator({existing:{id:99,commit_id:HEAD,state:'COMMENTED',
   user:{id:340237276,login:'devfactory-reviewer-b[bot]'},
   pull_request_url:URL,body:'older',submitted_at:null}}),/SEMANTIC_ALREADY_REVIEWED/],
  [emulator({override:{state:'APPROVED'}}),/SEMANTIC_POST_UNVERIFIED/],
  [emulator({override:{user:{id:100,login:'bad-bot'}}}),/SEMANTIC_POST_UNVERIFIED/]
 ];
 for(const [em,pattern] of cases)
  await assert.rejects(()=>publishRealSemanticComment(args(em)),pattern);
});

test('security: protected workflow never logs raw credentials, model errors or source',()=>{
 const source=readFileSync(new globalThis.URL(
  '../scripts/protected-real-semantic-review.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/console\.(?:error|warn|debug|info)\s*\(/);
 assert.match(source,/return fail\(classifyProtectedReviewFailure\(stage,error\)\)/);
});
test('protected LIVE stage classifier leaks no secret or private paths',()=>{
 const timeout=classifyProtectedReviewFailure('LOCAL_MODEL',
   Error('LOCAL_MODEL_REQUEST_TIMEOUT'));
 assert.equal(timeout,'REAL_REVIEW_LOCAL_MODEL_LOCAL_MODEL_REQUEST_TIMEOUT');
 const overLimit=classifyProtectedReviewFailure('LOCAL_MODEL',
   Error('SEMANTIC_SHARD_TOO_MANY'));
 assert.equal(overLimit,'REAL_REVIEW_LOCAL_MODEL_SEMANTIC_SHARD_TOO_MANY');
 const known=classifyProtectedReviewFailure('LOCAL_MODEL',
   Error('OLLAMA_COMPLETION_UNVERIFIED'));
 assert.equal(known,'REAL_REVIEW_LOCAL_MODEL_OLLAMA_COMPLETION_UNVERIFIED');
 const unknown=classifyProtectedReviewFailure('NATIVE_POST',
   Error('PRIVATE_FILENAME=/home/user/key.pem?token=SECRET'));
 assert.equal(unknown,'REAL_REVIEW_NATIVE_POST_FAILED_CLOSED');
 const forgedStage=classifyProtectedReviewFailure(
   'SECRET_USER_CONTROLLED_STAGE',Error('OLLAMA_COMPLETION_UNVERIFIED'));
 assert.equal(forgedStage,'REAL_REVIEW_UNKNOWN_OLLAMA_COMPLETION_UNVERIFIED');
 assert.doesNotMatch([known,unknown,forgedStage].join(' '),
   /PRIVATE_FILENAME|SECRET|key\.pem|\/home\/user/);
 for(const x of [undefined,null,{},[],{message:'OLLAMA_COMPLETION_UNVERIFIED'}])
   assert.equal(classifyProtectedReviewFailure('LOCAL_MODEL',x),
     'REAL_REVIEW_LOCAL_MODEL_FAILED_CLOSED');
});
test('issue request expected exact HEAD verified before any local model inference',()=>{
 const source=readFileSync(new globalThis.URL(
  '../scripts/protected-real-semantic-review.mjs',import.meta.url),'utf8');
 const preflight=source.indexOf('await runReadOnlyReviewPreflight(');
 const compare=source.indexOf("deny('REVIEW_REQUEST_HEAD_CHANGED')");
 const model=source.indexOf('await executeCompleteLocalSemanticReview(');
 assert.ok(preflight>=0&&compare>preflight&&model>compare);
 assert.match(source,/env\.REVIEWER_B_EXPECTED_HEAD!==preflight\.target\.headSha/);
 assert.match(source,/"REVIEW_REQUEST_HEAD_CHANGED"/);
});
test('long Qwen analysis must refresh the short-lived GitHub App JWT before write',()=>{
 const src=readFileSync(new globalThis.URL('../scripts/protected-real-semantic-review.mjs',
   import.meta.url),'utf8');
 const analysis=src.indexOf('await executeCompleteLocalSemanticReview(');
 const refresh=src.indexOf('const writerNow=Date.now();');
 assert.ok(analysis>0 && refresh>analysis);
 assert.match(src,/const writerJwt=createReviewerBAppJwt\(\{privateKeyPem:pem,now:writerNow\}\)/);
 assert.match(src,/appJwt:writerJwt,purpose:'publish',now:writerNow/);
 assert.doesNotMatch(src,/appJwt:jwt,purpose:'publish',now,fetchImpl/);
});

test('R72 duplicate native COMMENTED review is checked BEFORE costly model inference',()=>{
 const src=readFileSync(new globalThis.URL(
  '../scripts/protected-real-semantic-review.mjs',import.meta.url),'utf8');
 const preflight=src.indexOf("const preflight=await runReadOnlyReviewPreflight({");
 const existing=src.indexOf("const prior=await readNativeReviews({",preflight);
 const refusal=src.indexOf("}).blocked)deny('SEMANTIC_ALREADY_REVIEWED');",existing);
 const model=src.indexOf("const local=await executeCompleteLocalSemanticReview({",preflight);
 assert.ok(preflight>=0&&existing>preflight&&refusal>existing&&model>refusal);
 assert.equal(classifyProtectedReviewFailure('PRIVATE_PREFLIGHT',
   Error('SEMANTIC_ALREADY_REVIEWED')),
   'REAL_REVIEW_PRIVATE_PREFLIGHT_SEMANTIC_ALREADY_REVIEWED');
});

test('R75 a deleted OLD-side finding is explicitly labelled in native COMMENTED',()=>{
 const f={...finding(),side:'OLD'};
 const prepared=prepareRealSemanticComment({
  preflight:preflight(),local:local([f]),runId:RUN
 });
 assert.match(prepared.body,/src\/a\.mjs:4 \[REMOVED\/OLD\]/);
 assert.equal(prepared.approvalAuthorized,false);
 assert.equal(prepared.independentReviewVerified,false);
});

test('R97 a long Qwen analysis refreshes read AND write credentials before native publication',()=>{
 const src=readFileSync(new globalThis.URL('../scripts/protected-real-semantic-review.mjs',
   import.meta.url),'utf8');
 const model=src.indexOf('await executeCompleteLocalSemanticReview(');
 const prepare=src.indexOf('const plan=prepareRealSemanticComment(',model);
 const readStage=src.indexOf("stage='TOKEN_READ_REFRESH';",prepare);
 const readJwt=src.indexOf('const refreshedReadJwt=createReviewerBAppJwt(',readStage);
 const scopedRead=src.indexOf("appJwt:refreshedReadJwt,purpose:'reviewRead'",readJwt);
 const writeStage=src.indexOf("stage='TOKEN_WRITE';",scopedRead);
 const writeJwt=src.indexOf('const writerJwt=createReviewerBAppJwt(',writeStage);
 const post=src.indexOf('const published=await publishRealSemanticComment(',writeJwt);
 const safeLog=src.indexOf('if(published.ok===true)',post);
 assert.ok(model>=0&&prepare>model&&readStage>prepare&&readJwt>readStage&&
   scopedRead>readJwt&&writeStage>scopedRead&&writeJwt>writeStage&&
   post>writeJwt&&safeLog>post);
 assert.match(src,/const refreshedReadNow=Date\.now\(\);/);
 assert.match(src,/appJwt:refreshedReadJwt,purpose:'reviewRead',now:refreshedReadNow,fetchImpl/);
 assert.match(src,/publishRealSemanticComment\(\{plan,readToken:refreshedRead\.token,/);
 assert.doesNotMatch(src,/publishRealSemanticComment\(\{plan,readToken:read\.token,/);
 assert.match(src,/const read=\(\)=>readNativeReviews\(\{prNumber:plan\.prNumber,/);
 assert.match(src,/const before=await read\(\);/);
 assert.match(src,/const after=await read\(\);/);
});

test('R97 native publication uses fresh read-only credential and still denies drift or duplicate',async()=>{
 const freshRead='fresh-scoped-read-credential-1234567';
 const normal=emulator();
 const ok=await publishRealSemanticComment(args(normal,{readToken:freshRead}));
 assert.equal(ok.code,'REAL_REVIEW_COMMENT_VERIFIED');
 assert.equal(normal.posts(),1);
 assert.equal(normal.calls.filter(c=>c.method==='GET').length>0,true);
 assert.ok(normal.calls.filter(c=>c.method==='GET')
   .every(c=>c.auth==='Bearer '+freshRead));
 assert.ok(normal.calls.filter(c=>c.method==='POST')
   .every(c=>c.auth==='Bearer '+WRITE));
 const drift=emulator({changedHead:true});
 await assert.rejects(
   ()=>publishRealSemanticComment(args(drift,{readToken:freshRead})),
   /REVIEWS_HEAD_CHANGED/);
 assert.equal(drift.posts(),0);
 const duplicate=emulator({existing:{id:99,commit_id:HEAD,state:'COMMENTED',
   user:{id:340237276,login:'devfactory-reviewer-b[bot]'},
   pull_request_url:URL,body:'prior bot review',submitted_at:null}});
 await assert.rejects(
   ()=>publishRealSemanticComment(args(duplicate,{readToken:freshRead})),
   /SEMANTIC_ALREADY_REVIEWED/);
 assert.equal(duplicate.posts(),0);
});

test('R97 scoped READ refresh failure has an audited secret-free diagnostic',()=>{
 const code=classifyProtectedReviewFailure('TOKEN_READ_REFRESH',
   Error('APP_AUTH_API_REQUEST_FAILED'));
 assert.equal(code,'REAL_REVIEW_TOKEN_READ_REFRESH_APP_AUTH_API_REQUEST_FAILED');
 const unknown=classifyProtectedReviewFailure('TOKEN_READ_REFRESH',
   Error('secret PRIVATE_KEY accidentally in upstream error'));
 assert.equal(unknown,'REAL_REVIEW_TOKEN_READ_REFRESH_FAILED_CLOSED');
 assert.doesNotMatch(code+' '+unknown,/PRIVATE_KEY|secret|Bearer|ghs_/);
});
