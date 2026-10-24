/**
 * Protected PRIVATE source analysis using a real local Ollama model.
 * Native output is COMMENTED only: NEVER APPROVE, HUMAN_GO, or MERGE_GO.
 * Only execute from approved Publisher main and protected GitHub environment.
 */
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {approvedReadOnlyExecutionContext} from './protected-private-read-entrypoint.mjs';
import {createReviewerBAppJwt,createScopedReviewerBInstallationToken}
 from '../candidate/github-app-auth.mjs';
import {runReadOnlyReviewPreflight} from '../candidate/private-review-preflight.mjs';
import {executeCompleteLocalSemanticReview} from '../candidate/semantic-bounded-shards.mjs';
import {formatSafeReviewPerformance} from '../candidate/review-performance.mjs';
import {readNativeReviews} from '../candidate/github-review-readback.mjs';
import {assessNativeReviewUniqueness} from '../candidate/native-review-uniqueness.mjs';
const REPO='deenkids7-dev/deenkids';
const PUB='devfactory-reviewer-trust/devfactory-reviewer-b-publisher';
const MODEL='qwen2.5-coder:7b',BOT_ID=340237276,BOT='devfactory-reviewer-b[bot]';
const SHA40=/^[0-9a-f]{40}$/,SHA64=/^[0-9a-f]{64}$/;
// Every local shard is independently bounded to <=50 findings. A complete
// authenticated multi-shard review can legitimately exceed that per-shard cap.
const MAX_AGGREGATED_FINDINGS=128;
const WORKFLOW=PUB+'/.github/workflows/reviewer-b-private-semantic.yml@refs/heads/main';
const digest=x=>createHash('sha256').update(x).digest('hex');
function deny(code){throw Error(code);}
function fail(code){return Object.freeze({ok:false,code});}
const SAFE_DIAGNOSTIC_CODES=new Set(["LOCAL_MODEL_REQUEST_FAILED","LOCAL_MODEL_TRANSPORT_INTERRUPTED","LOCAL_MODEL_REQUEST_TIMEOUT","LOCAL_MODEL_RESPONSE_REJECTED","LOCAL_MODEL_ENDPOINT_UNVERIFIED","LOCAL_MODEL_INVALID_JSON","LOCAL_MODEL_RESPONSE_OVERSIZED","LOCAL_MODEL_ENCODING_INVALID","LOCAL_MODEL_DIFF_SCOPE_MISMATCH","OLLAMA_COMPLETION_UNVERIFIED","OLLAMA_OUTPUT_TRUNCATED","OLLAMA_CONTEXT_CAPACITY_UNVERIFIED","OLLAMA_CONTEXT_LIMIT_EXCEEDED","OLLAMA_INVALID_JSON","OLLAMA_FINDINGS_SCHEMA_INVALID","OLLAMA_FINDING_PATH_MISMATCH","OLLAMA_FINDING_LINE_INVALID","OLLAMA_FINDING_NOT_ADDED_LINE","OLLAMA_FINDING_DUPLICATE","SEMANTIC_SHARD_TOO_MANY","SEMANTIC_SHARD_SOURCE_INVALID","SEMANTIC_SHARD_SCOPE_MISMATCH","SEMANTIC_SHARD_FILE_MISMATCH","SEMANTIC_SHARD_BAD_SOURCE_LINE","SEMANTIC_BATCH_INVALID_REPORT","SEMANTIC_BATCH_DUPLICATE_FINDING","SEMANTIC_BATCH_INCOMPLETE","DIFF_DELETION_ONLY_UNANCHORED","STATIC_FINDINGS_BLOCK","REAL_SEMANTIC_PROOF_INVALID","REAL_SEMANTIC_PRIVATE_REPORT_OVERSIZED","REAL_SEMANTIC_REPORT_MISMATCH","SEMANTIC_POST_FAILED","SEMANTIC_POST_REJECTED","SEMANTIC_POST_UNVERIFIED","SEMANTIC_READBACK_INVALID","SEMANTIC_ALREADY_REVIEWED","APP_AUTH_API_REQUEST_FAILED","APP_AUTH_INSTALLATION_SCOPE_UNVERIFIED","PREFLIGHT_DIFF_MISMATCH","READ_PROOF_FAILED","REVIEW_REQUEST_HEAD_CHANGED"]);
const SAFE_STAGES=new Set(['TOKEN_READ','PRIVATE_PREFLIGHT','LOCAL_MODEL','PRIVATE_REPORT','TOKEN_READ_REFRESH','TOKEN_WRITE','NATIVE_POST']);
/** PUBLIC log may contain ONLY a static stage plus an exact audited code.
 * Never print error strings, HTTP payloads, stack traces, PRIVATE source,
 * filenames or app credentials from this privileged workflow.
 */
export function classifyProtectedReviewFailure(stage,error){
 const cleanStage=SAFE_STAGES.has(stage)?stage:'UNKNOWN';
 const code=error instanceof Error&&SAFE_DIAGNOSTIC_CODES.has(error.message)
   ?error.message:'FAILED_CLOSED';
 return 'REAL_REVIEW_'+cleanStage+'_'+code;
}

function text(v,max){
 if(typeof v!=='string'||!v.trim()||v.length>max||
   /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))deny('REPORT_TEXT_UNSAFE');
 return v.replace(/(?:https?:\/\/|www\.)[^\s)]+/gi,'external_link_redacted')
  .replace(/[\r\n\t ]+/g,' ').trim().replace(/[\[\]()!]/g,'_')
  .replace(/[@<>]/g,'_')
  .replace(/\x60/g,"'").replace(/&/g,'and');
}
export function canRunRealSemanticReview(env){
 return approvedReadOnlyExecutionContext(env) &&
   (env.GITHUB_EVENT_NAME==='workflow_dispatch'||
    (env.GITHUB_EVENT_NAME==='push' && env.REVIEWER_B_TARGET_PR==='899')||
    (env.GITHUB_EVENT_NAME==='issue_comment' &&
      typeof env.REVIEWER_B_EXPECTED_HEAD==='string' &&
      SHA40.test(env.REVIEWER_B_EXPECTED_HEAD))) &&
   env.GITHUB_WORKFLOW_REF===WORKFLOW &&
   env.REVIEWER_B_EXPECTED_MODEL===MODEL &&
   typeof env.REVIEWER_B_TARGET_PR==='string' &&
   /^[1-9][0-9]{0,9}$/.test(env.REVIEWER_B_TARGET_PR);
}
// Only the exact-HEAD service-owned issue request on protected main can ask
// for a stacked branch-delta advisory. No dispatch, push or paid workflow.
export function selectAdvisoryStackedScope(env){
 return canRunRealSemanticReview(env) &&
   env.GITHUB_EVENT_NAME==='issue_comment' &&
   typeof env.REVIEWER_B_EXPECTED_HEAD==='string' &&
   SHA40.test(env.REVIEWER_B_EXPECTED_HEAD);
}
export function prepareRealSemanticComment({preflight,local,runId}={}){
 const t=preflight?.target,bytes=local?.privateCanonicalReportBytes;
 if(t?.baseRef!==undefined &&
    (typeof t.baseRef!=='string'||
     !/^codex\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(t.baseRef)||
     t.baseRef.includes('..')||t.baseRef.includes('//')||
     t.baseRef.endsWith('/')))
   deny('REAL_SEMANTIC_PROOF_INVALID');
 // The full PRIVATE report can legitimately exceed the historical 16 KiB
 // display budget after exhaustive bounded local Qwen shard analysis.
 // Never mistake a complete report for a fake/incomplete model proof.
 // The separately bounded native GitHub comment below remains <= 12,000
 // chars, lists EVERY finding, and discloses compact excerpts explicitly.
 if(Buffer.isBuffer(bytes)&&bytes.length>96*1024)
   deny('REAL_SEMANTIC_PRIVATE_REPORT_OVERSIZED');
 if(t?.repository!==REPO||t.repositoryId!==1282086207||
   !Number.isSafeInteger(t.prNumber)||t.prNumber<1||
   typeof t.headSha!=='string'||!SHA40.test(t.headSha)||
   typeof t.baseSha!=='string'||!SHA40.test(t.baseSha)||
   typeof t.diffSha256!=='string'||!SHA64.test(t.diffSha256)||
   typeof runId!=='string'||!/^gh-[1-9][0-9]{0,18}-[1-9][0-9]{0,18}$/.test(runId)||
   !['FAIL','INCONCLUSIVE'].includes(preflight.staticDisposition)||
   !Number.isSafeInteger(preflight.blockingFindings)||
   preflight.blockingFindings<0||
   (preflight.staticDisposition==='FAIL')!==(preflight.blockingFindings>0)||
   preflight.approvalAuthorized!==false||
   preflight.independentReviewVerified!==false||
   preflight.publishEvent!==null||
   local?.localModelExecuted!==true||local.model!==MODEL||
   !['FAIL','INCONCLUSIVE'].includes(local.provisionalState)||
   !Number.isSafeInteger(local.findingCount)||local.findingCount<0||
   local.rawByteCoverageProven!==true||local.originalDiffSha256!==t.diffSha256||
   !Number.isSafeInteger(local.processedShardCount)||local.processedShardCount<1||
   local.approvalAuthorized!==false||
   local.independentReviewVerified!==false||local.publishEvent!==null||
   typeof local.localResponseSha256!=='string'||!SHA64.test(local.localResponseSha256)||
   !Buffer.isBuffer(bytes)||bytes.length<40)
    deny('REAL_SEMANTIC_PROOF_INVALID');
 let report;
 try{report=JSON.parse(bytes.toString('utf8'));}catch{deny('REPORT_JSON_INVALID');}
 if(report?.schema!=='devfactory.reviewer-b.findings.v1'||
   report.run_id!==runId||typeof report.summary!=='string'||
   !report.summary.trim()||report.summary.length>2000||
   !Array.isArray(report.findings)||
   report.findings.length!==local.findingCount||
   report.findings.length>MAX_AGGREGATED_FINDINGS||
   (local.provisionalState==='FAIL'&&report.findings.length===0))
   deny('REAL_SEMANTIC_REPORT_MISMATCH');
 // Deterministic security violations cannot be waived by generic owner
 // acceptance of a Qwen advisory review.
 if(preflight.staticDisposition==='FAIL'||preflight.blockingFindings>0)
   deny('STATIC_FINDINGS_BLOCK');
 const paths=new Set(preflight.privateSemanticPlan?.changedPaths||[]);
 if(!paths.size)deny('REPORT_CHANGED_SCOPE_MISSING');
 const lines=report.findings.map(f=>{
   if(!f||typeof f!=='object'||Array.isArray(f)||
     typeof f.path!=='string'||!paths.has(f.path)||
     !Number.isSafeInteger(f.line)||f.line<1||
     typeof f.fingerprint!=='string'||!SHA64.test(f.fingerprint)||
     typeof f.severity!=='string'||
     !['critical','high','medium','low','informational'].includes(f.severity)||
     (f.side!==undefined&&!['OLD','NEW'].includes(f.side))||
     typeof f.message!=='string'||!f.message.trim()||f.message.length>500||
     typeof f.evidence!=='string'||!f.evidence.trim()||f.evidence.length>1000)
     deny('REPORT_FINDING_INVALID');
   return '- '+f.severity.toUpperCase()+' '+text(f.path,300)+
     ':'+f.line+(f.side==='OLD'?' [REMOVED/OLD]':
       f.side==='NEW'?' [ADDED/NEW]':'')+' — '+
       text(f.message,500)+' (Evidence: '+text(f.evidence,1000)+')';
 });
 const reviewMode=local.reviewMode??'DEEP';
 if(!['QUICK','DEEP'].includes(reviewMode)||
    (local.geminiAdvisoryRecommended!==undefined &&
     typeof local.geminiAdvisoryRecommended!=='boolean')||
    (reviewMode==='QUICK' && local.geminiAdvisoryRecommended===true))
   deny('REAL_SEMANTIC_PROOF_INVALID');
 const advisory=local.geminiAdvisoryRecommended===true;
 const reportSha=digest(bytes);
 const marker=digest(Buffer.from([t.prNumber,t.headSha,runId,reportSha].join(':'))).slice(0,32);
 const outcome=local.provisionalState==='FAIL'||preflight.staticDisposition==='FAIL'
   ? 'PROVISIONAL_FINDINGS':'INCONCLUSIVE';
 const bodyLines=[
   '<!-- devfactory-reviewer-b-semantic-comment:v1:'+marker+' -->',
   'Reviewer B real LOCAL Qwen analysis — COMMENT ONLY (not approved)',
   '', 'Result: '+outcome+'; NO automated PASS or merge authority.',
   'Model: '+MODEL,'Exact head: '+t.headSha,
   'Exact base: '+t.baseSha,
   ...(t.baseRef?[
     'Review scope: STACKED BRANCH DELTA ONLY ('+text(t.baseRef,110)+'); does not validate unmerged base ancestry.'
   ]:[]),
   'Private diff SHA-256: '+t.diffSha256,
   'Real local report SHA-256: '+reportSha,
   'Real local response SHA-256: '+local.localResponseSha256,
   'Protected run: '+runId,
   'Static blockers: '+preflight.blockingFindings,
   'Semantic findings: '+local.findingCount,
   'Full-diff local model parts completed: '+local.processedShardCount,
   'Local review lane: '+reviewMode,
   'Gemini supplemental review: '+(advisory
     ?'SUGGESTED_NON_BLOCKING':'NOT_REQUIRED'),'',
   'Model summary: '+text(report.summary,2000),'',
   ...lines,'',
   'Manual verification required. This native COMMENTED report has no independent',
   'attestation, reviewer PASS, HUMAN_GO, MERGE_GO or merge authorization.'
 ];
 let body=bodyLines.join('\n');
 if(body.length>12000 && report.findings.length){
   // A long valid model report must not be rejected solely because source
   // evidence prose is verbose. Report EVERY concrete finding with exact
   // severity/path/line and a digest of its full evidence; explicitly mark
   // excerpts as abbreviated. Never erase a finding, grant PASS or claim
   // the review has complete repository context.
   const opening=bodyLines.slice(0,bodyLines.indexOf('Model summary: '+text(report.summary,2000)));
   const concise=(value,limit,max)=>{
     const safe=text(value,max);
     return safe.length>limit?safe.slice(0,limit-1)+'…':safe;
   };
   // Preserve readable excerpts of BOTH each claim and its evidence;
   // a digest alone cannot support operator triage of a large Qwen report.
   for(const cap of [120,80,48,24]){
     const compact=report.findings.map((f,i)=>'- #'+(i+1)+' '+
       f.severity.toUpperCase()+' '+text(f.path,300)+':'+f.line+
       (f.side==='OLD'?' [REMOVED/OLD]':f.side==='NEW'?' [ADDED/NEW]':'')+
       ' — '+concise(f.message,cap,500)+
       ' | Evidence excerpt: '+concise(f.evidence,cap,1000));
     body=[...opening,
       'Model summary: '+text(report.summary,2000),'',
       'COMPACT FINDING EXCERPTS: '+report.findings.length+
       ' of '+report.findings.length+' authentic local Qwen findings listed;'+
       ' messages and evidence abbreviated. Full canonical report is bound by SHA-256 above.',
       ...compact,'',
       'Manual verification required. This native COMMENTED report has no independent',
       'attestation, reviewer PASS, HUMAN_GO, MERGE_GO or merge authorization.'
     ].join('\n');
     if(body.length<=12000)break;
   }
 }
 if(body.length>12000 && report.findings.length){
   // Exhaustive reviews may repeat the same long authenticated file path
   // dozens of times. A path legend is an exact, lossless representation of
   // each path; every finding retains its number, severity, line, side and
   // a readable excerpt of BOTH the claim and its evidence.
   const safeSummary='Model summary: '+text(report.summary,2000);
   const opening=bodyLines.slice(0,bodyLines.indexOf(safeSummary));
   const paths=[...new Set(report.findings.map(f=>f.path))];
   const pathIDs=new Map(paths.map((path,i)=>[path,i+1]));
   const legend=paths.map((path,i)=>'P'+(i+1)+': '+text(path,300));
   // Sanitize only once before trying successively shorter excerpts.
   // There is no loss of findings or path identity.
   const sanitized=report.findings.map(f=>({
     severity:f.severity.toUpperCase(),
     pathID:pathIDs.get(f.path),line:f.line,
     sideStr:f.side==='OLD'?' [REMOVED/OLD]':
       f.side==='NEW'?' [ADDED/NEW]':'',
     message:text(f.message,500),evidence:text(f.evidence,1000)
   }));
   for(const cap of [60,40,24,12,8]){
     const concise=safe=>safe.length>cap?safe.slice(0,cap-1)+'…':safe;
     const compact=sanitized.map((f,i)=>'- #'+(i+1)+' '+
       f.severity+' P'+f.pathID+':'+f.line+f.sideStr+
       ' — '+concise(f.message)+
       ' | Evidence: '+concise(f.evidence));
     body=[...opening,
       safeSummary,'',
       'COMPLETE COMPACT FINDING INDEX: '+report.findings.length+
       ' of '+report.findings.length+
       ' authentic Qwen findings listed with exact file-path legend, line'+
       ' and severity; claim/evidence excerpts abbreviated.'+
       ' Full canonical report SHA-256 is above.',
       ...legend,'',...compact,'',
       'Manual verification required. This native COMMENTED report has no independent',
       'attestation, reviewer PASS, HUMAN_GO, MERGE_GO or merge authorization.'
     ].join('\n');
     if(body.length<=12000)break;
   }
 }
 if(body.length>12000)deny('REPORT_BODY_TOO_LARGE');
 return Object.freeze({event:'COMMENT',body,prNumber:t.prNumber,
   headSha:t.headSha,evidenceClass:'NATIVE_SEMANTIC_COMMENT_ONLY',
   approvalAuthorized:false,independentReviewVerified:false});
}
async function readJson(response){
 if(typeof response?.body?.getReader!=='function')deny('NATIVE_REPLY_INVALID');
 const reader=response.body.getReader(),blocks=[];let count=0,done=false;
 try{for(;;){
   const item=await reader.read();
   if(item.done){done=true;break;}
   if(!(item.value instanceof Uint8Array))deny('NATIVE_REPLY_BAD_CHUNK');
   count+=item.value.byteLength;
   if(count>24576)deny('NATIVE_REPLY_TOO_LARGE');
   blocks.push(Buffer.from(item.value));
 }}finally{
   if(!done){try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}
   reader.releaseLock();
 }
 const bytes=Buffer.concat(blocks,count),raw=bytes.toString('utf8');
 if(!Buffer.from(raw,'utf8').equals(bytes))deny('NATIVE_REPLY_BAD_ENCODING');
 try{return JSON.parse(raw);}catch{deny('NATIVE_REPLY_BAD_JSON');}
}
export async function publishRealSemanticComment({plan,readToken,writeToken,
 approvedProtectedPublication=false,approvedCloudCommentPublication=false,
 fetchImpl=globalThis.fetch}={}){
 const localEvidence=plan?.evidenceClass==='NATIVE_SEMANTIC_COMMENT_ONLY'&&
    plan?.body?.startsWith('<!-- devfactory-reviewer-b-semantic-comment:v1:');
 const cloudEvidence=approvedCloudCommentPublication===true&&
    plan?.evidenceClass==='NATIVE_OPENROUTER_ZDR_COMMENT_ONLY'&&
    plan?.body?.startsWith('<!-- devfactory-reviewer-b-openrouter-comment:v1:');
 if(approvedProtectedPublication!==true||(!localEvidence&&!cloudEvidence)||
   plan.event!=='COMMENT'||plan.approvalAuthorized!==false||
   plan.independentReviewVerified!==false||
   !Number.isSafeInteger(plan.prNumber)||plan.prNumber<1||
   typeof plan.headSha!=='string'||!SHA40.test(plan.headSha)||
   typeof plan.body!=='string'||
   plan.body.length>12000)deny('SEMANTIC_PUBLISH_DENIED');
 if(typeof fetchImpl!=='function'||typeof readToken!=='string'||
   typeof writeToken!=='string'||readToken.length<15||writeToken.length<15||
   readToken===writeToken||/[^-_A-Za-z0-9.]/.test(readToken)||
   /[^-_A-Za-z0-9.]/.test(writeToken))deny('SEMANTIC_TOKENS_INVALID');
 const read=()=>readNativeReviews({prNumber:plan.prNumber,
   expectedHeadSha:plan.headSha,installationToken:readToken,fetchImpl});
 const before=await read();
 if(assessNativeReviewUniqueness({observed:before,prNumber:plan.prNumber,
   currentHeadSha:plan.headSha}).blocked)deny('SEMANTIC_ALREADY_REVIEWED');
 const url='https://api.github.com/repos/'+REPO+'/pulls/'+plan.prNumber+'/reviews';
 let response;
 try{response=await fetchImpl(url,{method:'POST',redirect:'error',
   cache:'no-store',signal:AbortSignal.timeout(15000),
   headers:{Authorization:'Bearer '+writeToken,Accept:'application/vnd.github+json',
    'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'devfactory-reviewer-b-local-semantic'},
   body:JSON.stringify({event:'COMMENT',commit_id:plan.headSha,body:plan.body})});
 }catch{deny('SEMANTIC_POST_FAILED');}
 if(![200,201].includes(response?.status)||response?.url!==url||
   response?.redirected!==false||
   !/^application\/(?:vnd\.github\+)?json(?:\s*;|$)/i.test(
     response?.headers?.get?.('content-type')||''))
     deny('SEMANTIC_POST_REJECTED');
 const created=await readJson(response);
 if(!Number.isSafeInteger(created?.id)||created.id<1||
   created.state!=='COMMENTED'||created.commit_id!==plan.headSha||
   created.body!==plan.body||created.user?.id!==BOT_ID||
   created.user?.login!==BOT||
   created.pull_request_url!=='https://api.github.com/repos/'+REPO+
     '/pulls/'+plan.prNumber)deny('SEMANTIC_POST_UNVERIFIED');
 const after=await read();
 const botReviews=after.reviews.filter(x=>x.user.id===BOT_ID||x.user.login===BOT);
 if(botReviews.filter(x=>x.commit_id===plan.headSha).length!==1||
   botReviews.filter(x=>x.id===created.id&&x.body===plan.body&&
     x.commit_id===plan.headSha&&x.state==='COMMENTED'&&
     x.user.id===BOT_ID&&x.user.login===BOT).length!==1)
   deny('SEMANTIC_READBACK_INVALID');
 return Object.freeze({ok:true,code:'REAL_REVIEW_COMMENT_VERIFIED',
   prNumber:plan.prNumber,reviewId:created.id,
   approvalAuthorized:false,independentReviewVerified:false});
}
export async function executeProtectedRealSemanticReview({
 env={},now=Date.now(),fetchImpl=globalThis.fetch,
 modelFetchImpl=globalThis.fetch}={}){
 if(!canRunRealSemanticReview(env))return fail('CONTEXT_DENIED');
 const pem=env.REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM;
 if(typeof pem!=='string'||pem.length<100)
   return fail('CREDENTIAL_NOT_PROVISIONED');
 let stage='TOKEN_READ';
 try{
   const runId='gh-'+env.GITHUB_RUN_ID+'-'+env.GITHUB_RUN_ATTEMPT;
   const jwt=createReviewerBAppJwt({privateKeyPem:pem,now});
   const read=await createScopedReviewerBInstallationToken({
     appJwt:jwt,purpose:'reviewRead',now,fetchImpl});
   stage='PRIVATE_PREFLIGHT';
   const preflight=await runReadOnlyReviewPreflight({
     prNumber:Number(env.REVIEWER_B_TARGET_PR),
     runId,installationToken:read.token,fetchImpl});
   // Issue #21 service requests bind to a specific PR commit; never review
   // a moved HEAD simply because its number and repository still match.
   if(env.GITHUB_EVENT_NAME==='issue_comment' &&
      env.REVIEWER_B_EXPECTED_HEAD!==preflight.target.headSha)
      deny('REVIEW_REQUEST_HEAD_CHANGED');
   // A deterministic FAIL must not become a COMMENTED owner-accepted review.
   if(preflight.staticDisposition==='FAIL'||preflight.blockingFindings>0)
     deny('STATIC_FINDINGS_BLOCK');
   // Check native GitHub review presence with the short-lived READ token
   // BEFORE starting costly local inference. Repeated service requests,
   // workflow reruns and ambiguous prior publication must never spend CPU
   // only to collide with an already published bot review on the same HEAD.
   // Malformed prior reviews and GitHub read failures remain fail-closed.
   const prior=await readNativeReviews({
     prNumber:preflight.target.prNumber,
     expectedHeadSha:preflight.target.headSha,
     installationToken:read.token,fetchImpl
   });
   if(assessNativeReviewUniqueness({
     observed:prior,prNumber:preflight.target.prNumber,
     currentHeadSha:preflight.target.headSha
   }).blocked)deny('SEMANTIC_ALREADY_REVIEWED');
   stage='LOCAL_MODEL';
   const local=await executeCompleteLocalSemanticReview({
     plan:preflight.privateSemanticPlan,runId,model:MODEL,
     fetchImpl:modelFetchImpl,maxOutputTokens:1024});
   stage='PRIVATE_REPORT';
   const plan=prepareRealSemanticComment({preflight,local,runId});
   // LOCAL inference may run longer than the initial App JWT's 8-minute TTL.
   // Mint the purpose-separated WRITE token with a fresh App JWT only AFTER
   // the complete PRIVATE model report is validated. No bearer survives a retry.
   // The initial READ installation token lasts at most one hour; full CPU
   // analysis can exceed that. Re-mint after inference, with READ-only scope.
   // Native uniqueness and exact HEAD are then rechecked with this token
   // both before and after the COMMENTED POST, fail closed on any mismatch.
   stage='TOKEN_READ_REFRESH';
   const refreshedReadNow=Date.now();
   const refreshedReadJwt=createReviewerBAppJwt({privateKeyPem:pem,now:refreshedReadNow});
   const refreshedRead=await createScopedReviewerBInstallationToken({
     appJwt:refreshedReadJwt,purpose:'reviewRead',now:refreshedReadNow,fetchImpl});
   stage='TOKEN_WRITE';
   const writerNow=Date.now();
   const writerJwt=createReviewerBAppJwt({privateKeyPem:pem,now:writerNow});
   const writer=await createScopedReviewerBInstallationToken({
     appJwt:writerJwt,purpose:'publish',now:writerNow,fetchImpl});
   stage='NATIVE_POST';
   const published=await publishRealSemanticComment({plan,readToken:refreshedRead.token,
     writeToken:writer.token,approvedProtectedPublication:true,fetchImpl});
   // Metrics only after exact native COMMENTED readback. Never print private
   // source, per-file telemetry, prompt, response, token or attacker input.
   if(published.ok===true){
     try{
       const safeLine=formatSafeReviewPerformance(local.safePerformance);
       if(safeLine)console.log(safeLine);
     }catch{
       // Never fail a successfully verified native COMMENTED publication
       // because an optional performance observation was unavailable.
     }
   }
   return published;
 }catch(error){
   return fail(classifyProtectedReviewFailure(stage,error));
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{
   const result=await executeProtectedRealSemanticReview({env:process.env});
   console.log('PROTECTED_REVIEW_'+result.code);
   if(!result.ok)process.exitCode=1;
 }catch{
   console.log('PROTECTED_REVIEW_FAILED_CLOSED');
   process.exitCode=1;
 }
}
