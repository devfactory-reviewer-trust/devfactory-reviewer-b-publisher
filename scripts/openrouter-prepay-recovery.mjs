/**
 * One-time, source-verified recovery of Reviewer B #955 after a historical,
 * *provably pre-payment* GitHub Actions preflight failure. This does NOT
 * authorize provider spending, merge, approval or generic retries.
 *
 * Deliberately NOT a universal retry feature: the original Publisher job
 * predates durable pre-POST receipts. Its immutable source, run, job and
 * log evidence is individually scoped here. Any other run must fail closed
 * and receive its own independently reviewed recovery design.
 */
const REPO='devfactory-reviewer-trust/devfactory-reviewer-b-publisher';
const API='https://api.github.com/repos/'+REPO;
const SERVICE='devfactory-reviewer-service',SERVICE_ID=340477389;
const TARGET=Object.freeze({
 prNumber:955,
 headSha:'dd8bcdfebbfed5e2193c9328930499801ae916b5',
 model:'qwen/qwen3-coder-30b-a3b-instruct',
 originalCommentId:6420110835,
 failedRunId:40350809327,
 failedJobId:121670017999,
 failedPublisherHead:'20f6d9dcf6acea8bd3ac5436fbde4a5a8e9ff2f8',
 workflowId:385921562
});
const OLD='/review-b-openrouter '+TARGET.prNumber+' '+TARGET.headSha+' '+TARGET.model;
const NEW='/review-b-openrouter-recover '+TARGET.prNumber+' '+TARGET.headSha+
 ' '+TARGET.model+' '+TARGET.failedRunId;
const deny=()=>{throw Error('OR_PREPAY_RECOVERY_NOT_PROVEN')};

export function isOneTimeRecoveryRequest({prNumber,headSha,model,body}={}){
 return prNumber===TARGET.prNumber && headSha===TARGET.headSha &&
   model===TARGET.model && body===NEW;
}

export function assessOneTimeRecoveryComments({
 comments,commentId,prNumber,headSha,model
}={}){
 if(!Array.isArray(comments)||comments.length>2000||
    !Number.isSafeInteger(commentId)||commentId<1||
    prNumber!==TARGET.prNumber||headSha!==TARGET.headSha||
    model!==TARGET.model)return Object.freeze({ok:false});
 const eligible=comments.filter(c=>
   c?.user?.login===SERVICE&&c?.user?.id===SERVICE_ID&&
   typeof c.body==='string'&&
   (c.body.startsWith('/review-b-openrouter '+prNumber+' '+headSha+' ')||
    c.body.startsWith('/review-b-openrouter-recover '+prNumber+' '+headSha+' ')));
 if(eligible.length!==2)return Object.freeze({ok:false});
 const original=eligible.find(c=>c.id===TARGET.originalCommentId);
 const recovery=eligible.find(c=>c.id===commentId);
 const a=Date.parse(original?.created_at),b=Date.parse(recovery?.created_at);
 if(!original||!recovery||original.id===recovery.id||
    original.body!==OLD||recovery.body!==NEW||
    !Number.isFinite(a)||!Number.isFinite(b)||b<=a)
   return Object.freeze({ok:false});
 return Object.freeze({ok:true,firstCommentId:original.id,
   recoveryCommentId:recovery.id,failedRunId:TARGET.failedRunId,
   maySpend:false,mayRetryAmbiguousRequest:false,mayMerge:false});
}

async function jsonGET(url,token,fetchImpl){
 let r;
 try{
  r=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(12000),
   headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'devfactory-prepay-recovery-verifier'}});
 }catch{deny()}
 if(r?.status!==200||r.url!==url||r.redirected!==false||
    !/^application\/(?:vnd\.github\+)?json(?:\s*;|$)/i.test(r.headers?.get('content-type')||''))
    deny();
 const len=r.headers?.get('content-length');
 if(len!=null&&(!/^\d+$/.test(len)||Number(len)>64*1024))deny();
 let content;
 try{content=await r.text()}catch{deny()}
 if(Buffer.byteLength(content,'utf8')>64*1024)deny();
 try{return JSON.parse(content)}catch{deny()}
}
function safeBlobUrl(raw){
 try{
  const u=new URL(raw);
  return u.protocol==='https:'&&u.username===''&&u.password===''&&
   u.hash===''&&
   (/(^|\.)blob\.core\.windows\.net$/i.test(u.hostname)||
    /(^|\.)actions\.githubusercontent\.com$/i.test(u.hostname))&&
   raw.length<=4096;
 }catch{return false}
}
async function readVerifiedJobLog(token,fetchImpl){
 const url=API+'/actions/jobs/'+TARGET.failedJobId+'/logs';
 let r;
 try{
  r=await fetchImpl(url,{method:'GET',redirect:'manual',cache:'no-store',
   signal:AbortSignal.timeout(12000),
   headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
    'User-Agent':'devfactory-prepay-recovery-verifier'}});
 }catch{deny()}
 if(r?.status!==302||r.url!==url||r.redirected!==false)deny();
 const location=r.headers?.get('location');
 if(!safeBlobUrl(location))deny();
 let log;
 try{
  log=await fetchImpl(location,{method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(12000),
   headers:{Accept:'text/plain',
    'User-Agent':'devfactory-prepay-recovery-verifier'}});
 }catch{deny()}
 if(log?.status!==200||log.url!==location||log.redirected!==false||
    !/^text\/plain(?:\s*;|$)/i.test(log.headers?.get('content-type')||''))deny();
 const size=log.headers?.get('content-length');
 if(size!=null&&(!/^\d+$/.test(size)||Number(size)>64*1024))deny();
 let raw;
 try{raw=await log.text()}catch{deny()}
 if(Buffer.byteLength(raw,'utf8')>64*1024)deny();
 // Historical protected MAIN script sets stage=OPENROUTER only AFTER:
 // preflight, uniqueness, consent and financial authorization. A failure
 // at the exact PREFLIGHT stage therefore cannot include a provider POST.
 const matches=raw.match(/OPENROUTER_PROTECTED_PREFLIGHT_FAILED_CLOSED/g)||[];
 const outer=raw.match(/OPENROUTER_PROTECTED_CLOUD_PREFLIGHT_FAILED_CLOSED/g)||[];
 if(matches.length!==1||outer.length!==1||
    /OPENROUTER_PROTECTED_(?:OPENROUTER|REPORT|READ_REFRESH|WRITE|NATIVE)_FAILED_CLOSED/.test(raw)||
    !raw.includes('Process completed with exit code 1'))deny();
 return true;
}

/** Authenticated GitHub Actions evidence; no private diff or provider request. */
export async function verifyOneTimeRecoveryPrepayEvidence({
 apiReadToken,fetchImpl=globalThis.fetch
}={}){
 if(typeof apiReadToken!=='string'||apiReadToken.length<15||
    /[^-_.A-Za-z0-9]/.test(apiReadToken)||typeof fetchImpl!=='function')
   deny();
 const run=await jsonGET(API+'/actions/runs/'+TARGET.failedRunId,
  apiReadToken,fetchImpl);
 if(run?.id!==TARGET.failedRunId||run.workflow_id!==TARGET.workflowId||
    run.head_sha!==TARGET.failedPublisherHead||
    run.event!=='issue_comment'||run.run_attempt!==1||
    run.status!=='completed'||run.conclusion!=='failure'||
    run.actor?.login!==SERVICE||run.actor?.id!==SERVICE_ID)
   deny();
 const jobs=await jsonGET(API+'/actions/runs/'+TARGET.failedRunId+'/jobs?per_page=100',
  apiReadToken,fetchImpl);
 if(jobs?.total_count!==1||!Array.isArray(jobs.jobs)||
    jobs.jobs.length!==1)deny();
 const job=jobs.jobs[0];
 if(job?.id!==TARGET.failedJobId||job.run_id!==TARGET.failedRunId||
    job.conclusion!=='failure'||job.status!=='completed'||
    !Array.isArray(job.steps))deny();
 const success=['Fetch exact protected PUBLIC publisher source (no untrusted checkout)',
   'Verify exact service-owned cloud request BEFORE PRIVATE credentials'];
 const failure='Protected exact-head owner-consented cloud analysis';
 if(success.some(name=>!job.steps.some(s=>s.name===name&&
       s.conclusion==='success'))||
    !job.steps.some(s=>s.name===failure&&s.conclusion==='failure'))
   deny();
 await readVerifiedJobLog(apiReadToken,fetchImpl);
 return Object.freeze({ok:true,originalFailedRun:TARGET.failedRunId,
  originalPublisherHead:TARGET.failedPublisherHead,
  verifiedPrepaymentFailure:true,
  maySpend:false,mayMerge:false,mayRetryAmbiguousRequest:false});
}
export {NEW as EXACT_RECOVERY_COMMAND};
