/**
 * R213 — future OWNER delegation / revocation SHADOW for Reviewer B OpenRouter.
 *
 * A GitHub comment returned by the caller is not an authenticated grant. This
 * module cannot authorize private-source export, spend, environment approval,
 * a Reviewer B request, or a merge. The privileged Publisher must re-fetch
 * source GitHub records independently and attest a real budget reservation,
 * revocation freshness and protected environment admission before execution.
 * No network, clock calls, environment variables, side effects or credentials.
 */
const OWNER = Object.freeze({login:'deenkids7-dev',id:297379913});
const REPO = 'deenkids7-dev/deenkids';
const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const MONTH = /^20[2-9][0-9]-(?:0[1-9]|1[0-2])$/;
const GRANT = /^\/devfactory-openrouter-grant-v2 (20[2-9][0-9]-(?:0[1-9]|1[0-2])) epoch=([1-9][0-9]{0,8}) repo=deenkids7-dev\/deenkids model=qwen\/qwen3-coder-30b-a3b-instruct scope=diff-only zdr=true fallback=false budget=15eur$/;
const REVOKE = /^\/devfactory-openrouter-revoke-v2 (20[2-9][0-9]-(?:0[1-9]|1[0-2])) epoch=([1-9][0-9]{0,8})$/;
const B = Object.freeze({
  INPUT:'OWNER_DELEGATION_SNAPSHOT_INVALID',
  MONTH:'OWNER_DELEGATION_MONTH_INVALID',
  WINDOW:'OWNER_DELEGATION_MONTH_NOT_CURRENT',
  GRANT:'OWNER_DELEGATION_GRANT_MISSING_OR_DUPLICATE',
  REVOKED:'OWNER_DELEGATION_REVOKED',
  EPOCH:'OWNER_DELEGATION_EPOCH_INVALID',
  SOURCE:'OWNER_DELEGATION_GITHUB_SOURCE_NOT_AUTHENTICATED',
  FRESHNESS:'OWNER_DELEGATION_REVOKE_FRESHNESS_UNVERIFIED',
  SPEND:'OWNER_DELEGATION_GLOBAL_BUDGET_NOT_RESERVED',
  ENV:'OWNER_DELEGATION_ENVIRONMENT_RELEASE_NOT_PROVEN',
});
const owner=x=>x?.user?.login===OWNER.login && x?.user?.id===OWNER.id;
function parseComment(x,now){
  if(!owner(x) || !Number.isSafeInteger(x.id) || x.id<=0 ||
    typeof x.body!=='string' || x.body.length>256 ||
    typeof x.created_at!=='string')return null;
  const at=Date.parse(x.created_at);
  if(!Number.isFinite(at)||at<0||at>now+60_000)return null;
  const g=GRANT.exec(x.body),r=REVOKE.exec(x.body);
  if(!g&&!r)return null;
  const parts=g||r,epoch=Number(parts[2]);
  if(!Number.isSafeInteger(epoch)||epoch<1)return null;
  const m=parts[1],start=Date.parse(m+'-01T00:00:00Z');
  if(!Number.isFinite(start)||at<start)return null;
  const monthOfComment=new Date(at).toISOString().slice(0,7);
  if(monthOfComment!==m)return null;
  return Object.freeze({kind:g?'grant':'revoke',month:m,epoch,id:x.id,at});
}
export function assessOwnerOpenRouterDelegationShadow(input={}){
  const v=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const issues=[],add=k=>{if(!issues.includes(k))issues.push(k);};
  const now=v.nowMs,month=v.month,comments=v.githubComments;
  const validNow=Number.isFinite(now)&&now>=0&&now<=8.64e15;
  if(!validNow)add(B.INPUT);
  if(typeof month!=='string'||!MONTH.test(month))add(B.MONTH);
  if(!validNow||typeof month!=='string'||!MONTH.test(month)||
    new Date(now).toISOString().slice(0,7)!==month)add(B.WINDOW);
  if(!Array.isArray(comments)||comments.length>100)add(B.INPUT);
  const safe=Array.isArray(comments)&&comments.length<=100?comments:[];
  const entries=validNow
    ?safe.map(x=>parseComment(x,now)).filter(Boolean)
    :[];
  const relevant=entries.filter(x=>x.month===month);
  const grants=relevant.filter(x=>x.kind==='grant');
  let selected=null;
  if(grants.length===0)add(B.GRANT);
  else{
    const maxEpoch=Math.max(...grants.map(x=>x.epoch));
    const latest=grants.filter(x=>x.epoch===maxEpoch);
    if(latest.length!==1)add(B.GRANT);
    else selected=latest[0];
    const revokes=relevant.filter(x=>x.kind==='revoke');
    if(selected&&revokes.some(x=>x.epoch>=selected.epoch))add(B.REVOKED);
    if(selected && grants.some(x=>x.epoch===selected.epoch&&x.id!==selected.id))
      add(B.GRANT);
  }
  if(selected&&(!Number.isSafeInteger(selected.epoch)||selected.epoch<1))
    add(B.EPOCH);
  // A caller-supplied array and caller-supplied source-authenticated=true
  // are *never* privileged proofs, especially for absent revocation.
  add(B.SOURCE);add(B.FRESHNESS);add(B.SPEND);add(B.ENV);
  return Object.freeze({
    schemaVersion:2,kind:'owner_openrouter_delegation_shadow',
    status:'BLOCKED',
    scopeRepository:REPO,scopeModel:MODEL,monthlyMaxEur:15,
    candidateGrantPresent:Boolean(selected),
    candidateGrantEpoch:selected?.epoch??null,
    candidateGrantCommentId:selected?.id??null,
    privateCodeEgressAuthorized:false,
    cloudReviewRequestAuthorized:false,
    budgetAuthorized:false,
    environmentApprovalAuthorized:false,
    mergeAuthorized:false,
    mayStartRunner:false,
    blockers:Object.freeze(issues),
  });
}
