import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareOpenRouterNativeComment}
 from '../scripts/openrouter-native-report.mjs';
import {assessOwnerCloudConsent,formatExactOwnerCloudConsent}
 from '../scripts/openrouter-owner-consent.mjs';
import {canRunProtectedOpenRouterReview}
 from '../scripts/protected-real-openrouter-review.mjs';
import {publishRealSemanticComment}
 from '../scripts/protected-real-semantic-review.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const PR=932,HEAD='a'.repeat(40),BASE='b'.repeat(40),RUN='gh-38715430667-1';
const MODEL='qwen/qwen3-coder-30b-a3b-instruct';
const NOW=Date.parse('2026-10-15T17:45:00Z');
const month='2026-10';
const comment=(o={})=>({
 id:123456,user:{id:297379913,login:'deenkids7-dev'},
 created_at:'2026-10-15T17:00:00Z',
 body:formatExactOwnerCloudConsent(PR,HEAD,MODEL,month),...o});
const buf=Buffer.from(JSON.stringify({schema:'devfactory.reviewer-b.findings.v1',
 run_id:RUN,summary:'Synthetic full coverage advisory',findings:[]}));
const preflight={target:{
 repository:'deenkids7-dev/deenkids',repositoryId:1282086207,prNumber:PR,
 headSha:HEAD,baseSha:BASE,diffSha256:sha(Buffer.from('synthetic'))},
 staticDisposition:'INCONCLUSIVE',blockingFindings:0,
 approvalAuthorized:false,independentReviewVerified:false,publishEvent:null};
const cloud=()=>({
 cloudModelExecuted:true,localModelExecuted:false,model:MODEL,
 modelOrigin:'OPENROUTER_THIRD_PARTY_ZDR',
 fullOriginalDiffSha256:preflight.target.diffSha256,
 rawByteCoverageProven:true,approvalAuthorized:false,
 independentReviewVerified:false,mayPublishReview:false,mayMerge:false,
 processedShardCount:3,findingCount:0,provisionalState:'INCONCLUSIVE',
 externalResponseSha256:'c'.repeat(64),apiCostReportedUsd:0.0023,
 totalInputTokens:3800,totalOutputTokens:370,
 privateCanonicalReportBytes:buf
});
test('native cloud marker and provenance are distinct from local Qwen',()=>{
 const out=prepareOpenRouterNativeComment({preflight,cloud:cloud(),runId:RUN});
 assert.equal(out.event,'COMMENT');
 assert.equal(out.evidenceClass,'NATIVE_OPENROUTER_ZDR_COMMENT_ONLY');
 assert.match(out.body,/THIRD_PARTY_OPENROUTER_ZDR/);
 assert.match(out.body,/Data handling: provider.zdr=true/);
 assert.match(out.body,new RegExp(HEAD));
 assert.doesNotMatch(out.body,/Reviewer B real LOCAL/);
 assert.doesNotMatch(out.body,/APPROVED/);
 assert.equal(out.approvalAuthorized,false);
});
test('no cloud comment from local-only false provenance',()=>{
 assert.throws(()=>prepareOpenRouterNativeComment({
  preflight,cloud:{...cloud(),localModelExecuted:true},runId:RUN
 }),/OR_NATIVE_CLOUD_PROOF_INVALID/);
});
test('no cloud comment on static code blocker',()=>{
 assert.throws(()=>prepareOpenRouterNativeComment({
  preflight:{...preflight,staticDisposition:'FAIL',blockingFindings:1},
  cloud:cloud(),runId:RUN
 }),/OR_NATIVE_PREFLIGHT_NOT_PROVEN/);
});
test('cloud report must bind EXACT private original diff SHA',()=>{
 assert.throws(()=>prepareOpenRouterNativeComment({
  preflight,cloud:{...cloud(),fullOriginalDiffSha256:'d'.repeat(64)},runId:RUN
 }),/OR_NATIVE_CLOUD_PROOF_INVALID/);
});
test('cloud report runId mismatch does not become native review',()=>{
 assert.throws(()=>prepareOpenRouterNativeComment({
  preflight,cloud:cloud(),runId:'gh-38715430667-2'
 }),/OR_NATIVE_REPORT_INVALID/);
});
test('owner exact model and UTC month consent accepted once',()=>{
 const out=assessOwnerCloudConsent({items:[comment()],prNumber:PR,
   headSha:HEAD,model:MODEL,month,now:NOW});
 assert.equal(out.ok,true);
 assert.equal(out.globalMonthlyBudgetUsd,13);
 assert.equal(out.independentReviewVerified,false);
});
test('owner consent is not transferable to another HEAD or model',()=>{
 assert.equal(assessOwnerCloudConsent({items:[comment()],prNumber:PR,
   headSha:'f'.repeat(40),model:MODEL,month,now:NOW}).ok,false);
 assert.equal(assessOwnerCloudConsent({items:[comment()],prNumber:PR,
   headSha:HEAD,model:'qwen/qwen3.6-35b-a3b',month,now:NOW}).ok,false);
});
test('nonowner, stale, future, duplicate owner consent all refused',()=>{
 const list=[
  [comment({user:{login:'attacker',id:10}})],
  [comment({created_at:'2026-10-15T10:00:00Z'})],
  [comment({created_at:'2026-10-15T17:47:00Z'})],
  [comment(),comment({id:123457})]
 ];
 for(const items of list)
  assert.equal(assessOwnerCloudConsent({items,prNumber:PR,
    headSha:HEAD,model:MODEL,month,now:NOW}).ok,false);
});
test('publisher cannot publish cloud report without explicit cloud option',async()=>{
 const out=prepareOpenRouterNativeComment({preflight,cloud:cloud(),runId:RUN});
 let called=false;
 await assert.rejects(()=>publishRealSemanticComment({
  plan:out,readToken:'readtoken1234567890',writeToken:'writetoken1234567890',
  approvedProtectedPublication:true,fetchImpl:async()=>{called=true;throw Error('network')}
 }),/SEMANTIC_PUBLISH_DENIED/);
 assert.equal(called,false);
});
test('protected cloud run never active from draft, PR event or missing policy',()=>{
 const base={
  GITHUB_REPOSITORY:'devfactory-reviewer-trust/devfactory-reviewer-b-publisher',
  GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_ACTOR:'devfactory-reviewer-service',
  GITHUB_SHA:'c'.repeat(40),GITHUB_RUN_ID:'4000',GITHUB_RUN_ATTEMPT:'1',
  GITHUB_WORKFLOW_REF:'devfactory-reviewer-trust/devfactory-reviewer-b-publisher/.github/workflows/reviewer-b-private-openrouter.yml@refs/heads/main',
  REVIEWER_B_TARGET_PR:String(PR),REVIEWER_B_EXPECTED_HEAD:HEAD,
  REVIEWER_B_OPENROUTER_MODEL:MODEL,
  REVIEWER_B_CLOUD_POLICY_READY:'approved-protected-v1',
  REVIEWER_B_CLOUD_REQUEST_VERIFIED:'true',
  REVIEWER_B_CLOUD_TARGET_REPOSITORY:'deenkids7-dev/deenkids'
 };
 assert.equal(canRunProtectedOpenRouterReview(base),true);
 for(const changes of [
  {GITHUB_REF:'refs/heads/feature'},
  {GITHUB_EVENT_NAME:'pull_request'},
  {REVIEWER_B_CLOUD_POLICY_READY:undefined},
  {REVIEWER_B_CLOUD_REQUEST_VERIFIED:undefined},
  {REVIEWER_B_CLOUD_REQUEST_VERIFIED:'false'},
  {GITHUB_ACTOR:'deenkids7-dev'},
  {REVIEWER_B_EXPECTED_HEAD:'f'.repeat(39)},
  {REVIEWER_B_OPENROUTER_MODEL:'openrouter/auto'},
  {GITHUB_WORKFLOW_REF:'untrusted'},
  {REVIEWER_B_TARGET_PR:'0'},
  {REVIEWER_B_TARGET_PR:'932.5'},
  {REVIEWER_B_TARGET_PR:'932x'}
 ])assert.equal(canRunProtectedOpenRouterReview({...base,...changes}),false);
});
test('cloud code path includes mandatory native uniqueness and owner consent',async()=>{
 const {readFileSync}=await import('node:fs');
 const {fileURLToPath}=await import('node:url');
 const src=readFileSync(fileURLToPath(new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url)),'utf8');
 assert.ok(src.includes('assessNativeReviewUniqueness'));
 assert.ok(src.indexOf('assessNativeReviewUniqueness')<src.indexOf('executeCompleteOpenRouterSemanticReview({'));
 assert.ok(src.includes('approvedCloudCommentPublication:true'));
 assert.ok(src.includes('fetchAndVerifyOwnerCloudConsent'));
 assert.ok(src.includes('CLOUD_NATIVE_READBACK_INVALID'));
});
test('protected cloud refreshes use the injected clock',async()=>{
 const {readFileSync}=await import('node:fs');
 const {fileURLToPath}=await import('node:url');
 const src=readFileSync(fileURLToPath(new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url)),'utf8');
 assert.doesNotMatch(src,/const refreshNow=Date\.now\(\)|now:Date\.now\(\)|const writerNow=Date\.now\(\)/);
});
test('large valid cloud reports remain publishable within the GitHub body limit',()=>{
 const long='x'.repeat(250);
 const report=Buffer.from(JSON.stringify({schema:'devfactory.reviewer-b.findings.v1',
  run_id:RUN,summary:'Synthetic bounded report',findings:Array.from({length:128},(_,i)=>({
   path:'src/f'+i+'.mjs',line:i+1,fingerprint:String(i).padStart(64,'a'),
   severity:'low',message:long,evidence:long
  }))}));
 const out=prepareOpenRouterNativeComment({preflight,cloud:{...cloud(),
  findingCount:128,privateCanonicalReportBytes:report},runId:RUN});
 assert.ok(out.body.length<=12000);
 assert.match(out.body,/Semantic findings: 128/);
});

test('new native monthly split requires exact budget13usd owner consent, not historical budget15eur',()=>{
 const exact='/devfactory-openrouter-consent '+PR+' '+HEAD+' '+MODEL+' '+month+' budget13usd';
 assert.equal(formatExactOwnerCloudConsent(PR,HEAD,MODEL,month),exact);
 const valid=assessOwnerCloudConsent({
  items:[comment({body:exact})],prNumber:PR,headSha:HEAD,model:MODEL,month,now:NOW
 });
 assert.equal(valid.ok,true);
 assert.equal(valid.globalMonthlyBudgetUsd,13);
 const stale=assessOwnerCloudConsent({
  items:[comment({body:exact.replace('budget13usd','budget15eur')})],
  prNumber:PR,headSha:HEAD,model:MODEL,month,now:NOW
 });
 assert.equal(stale.ok,false);
});

test('historical owner consent may be refreshed ONLY by one explicit exact-head prepay recovery attestation',async()=>{
 const {formatOneTimeRecoveryOwnerConsent}=await import('../scripts/openrouter-owner-consent.mjs');
 const pr=955,head='dd8bcdfebbfed5e2193c9328930499801ae916b5';
 const model='qwen/qwen3-coder-30b-a3b-instruct',month='2026-10';
 const now=Date.parse('2026-10-26T21:00:00Z');
 const first={id:6420081409,user:{login:'deenkids7-dev',id:297379913},
  created_at:'2026-10-26T15:34:05Z',
  body:formatExactOwnerCloudConsent(pr,head,model,month)};
 const renewal={...first,id:6421000000,created_at:'2026-10-26T20:30:00Z',
  body:formatOneTimeRecoveryOwnerConsent(pr,head,model,month)};
 const verify=items=>assessOwnerCloudConsent({
  items,prNumber:pr,headSha:head,model,month,now});
 assert.equal(verify([first]).ok,false,'old 4h consent cannot be silently reused');
 const authorized=verify([first,renewal]);
 assert.equal(authorized.ok,true);
 assert.equal(authorized.ownerCommentId,renewal.id);
 assert.equal(authorized.globalMonthlyBudgetUsd,13);
 assert.equal(authorized.mayMerge,false);
 for(const [attack,reason] of [
  [[first,renewal,renewal],'OR_CONSENT_RENEWAL_DUPLICATE'],
  [[first,{...renewal,user:{login:'attacker',id:297379913}}],'OR_CONSENT_RENEWAL_UNTRUSTED'],
  [[first,{...renewal,user:{login:'deenkids7-dev',id:5}}],'OR_CONSENT_RENEWAL_UNTRUSTED'],
  [[first,{...renewal,body:renewal.body.replace('40350809327','40350809328')}],'OR_CONSENT_OWNER_OR_FRESHNESS_UNVERIFIED'],
  [[first,{...renewal,created_at:'2026-10-26T15:33:00Z'}],'OR_CONSENT_RENEWAL_UNTRUSTED'],
  [[first,{...renewal,created_at:'2026-10-26T21:03:00Z'}],'OR_CONSENT_RENEWAL_UNTRUSTED'],
  [[first,{...renewal,created_at:'2026-10-26T15:40:00Z'}],'OR_CONSENT_OWNER_OR_FRESHNESS_UNVERIFIED'],
  [[first,{...first,id:500,created_at:'2026-10-26T19:10:00Z'},renewal],'OR_CONSENT_MISSING_OR_DUPLICATE'],
 ]){
  const out=verify(attack);
  assert.equal(out.ok,false);
  assert.equal(out.reason,reason,JSON.stringify(attack.map(c=>c.id)));
 }
 const unrelated=assessOwnerCloudConsent({
  items:[{...first,body:formatExactOwnerCloudConsent(956,head,model,month)},
         {...renewal,body:formatOneTimeRecoveryOwnerConsent(956,head,model,month)}],
  prNumber:956,headSha:head,model,month,now});
 assert.equal(unrelated.ok,false);
 assert.equal(unrelated.reason,'OR_CONSENT_OWNER_OR_FRESHNESS_UNVERIFIED');
});
