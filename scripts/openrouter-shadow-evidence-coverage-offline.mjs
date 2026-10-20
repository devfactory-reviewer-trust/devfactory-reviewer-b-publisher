/**
 * Synthetic and OFFLINE evidence coverage inventory.
 * No authenticated OpenRouter bills, complete key enumeration, secret
 * access, API calls, FX valuation, release of holds, or payment authority.
 * No production module imports this fixture checker.
 */
const MAX_BYTES=65536,MAX_KEYS=20,MAX_ATTEMPTS=200,MAX_STATEMENTS=240;
const ROOT=['schema','scope','watermark','window','keys','attempts','statements'];
const WINDOW=['first_month_utc','last_month_utc'];
const KEY=['key_id','role','valid_from_month_utc','retired_after_month_utc'];
const ATTEMPT=['request_id','key_id','initiated_month_utc','state'];
const STATEMENT=['statement_id','key_id','month_utc','source','digest_sha256','request_ids'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const DIGEST=/^[a-f0-9]{64}$/;
const ROLES=new Set(['development','reviewer_b']);
const STATES=new Set(['pending','ambiguous','settled_fixture']);
const exact=(obj,fields)=>obj!==null&&typeof obj==='object'&&
  !Array.isArray(obj)&&Object.keys(obj).length===fields.length&&
  fields.every(key=>Object.hasOwn(obj,key));
const month=v=>typeof v==='string'&&MONTH.test(v);
const id=v=>typeof v==='string'&&ID.test(v);
const index=v=>Number(v.slice(0,4))*12+Number(v.slice(5,7))-1;
const denied=(reason,summary={})=>Object.freeze({
  status:'BLOCKED',reason,syntheticOnly:true,verified:false,
  maySpend:false,mayReserve:false,mayRetryAmbiguousRequest:false,
  mayReleaseHold:false,providerBillingAuthenticated:false,
  accountCoverageAuthenticated:false,keyInventoryAuthenticated:false,
  statementProvenanceAuthenticated:false,fxAuthenticated:false,
  ...summary,
});

/**
 * Audits only internal consistency of a user-supplied synthetic fixture.
 * Missing keys from the fixture CANNOT be detected. A SHA256-shaped string
 * is NOT a signature, a provenance chain, or an authentic provider receipt.
 */
export function assessSyntheticEvidenceCoverageOffline(json){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return denied('SHADOW_COVERAGE_SYNTHETIC_SWITCH_REQUIRED');
  if(typeof json!=='string'||Buffer.byteLength(json,'utf8')>MAX_BYTES)
    return denied('SHADOW_COVERAGE_INPUT_UNTRUSTED');
  let s;
  try{s=JSON.parse(json)}catch{
    return denied('SHADOW_COVERAGE_INPUT_UNTRUSTED');
  }
  if(!exact(s,ROOT)||s.schema!=='devfactory.shadow-evidence-coverage.synthetic.v1'||
     s.scope!=='illustrative-only'||s.watermark!=='unverified-fixture'||
     !exact(s.window,WINDOW)||
     !month(s.window.first_month_utc)||!month(s.window.last_month_utc)||
     !Array.isArray(s.keys)||s.keys.length<1||s.keys.length>MAX_KEYS||
     !Array.isArray(s.attempts)||s.attempts.length>MAX_ATTEMPTS||
     !Array.isArray(s.statements)||s.statements.length>MAX_STATEMENTS)
    return denied('SHADOW_COVERAGE_INPUT_UNTRUSTED');
  const begin=index(s.window.first_month_utc),end=index(s.window.last_month_utc);
  if(end<begin||end-begin>=12)
    return denied('SHADOW_COVERAGE_WINDOW_INVALID');

  const keys=new Map(),required=new Set(),observed=new Set(),attempts=new Map();
  for(const k of s.keys){
    if(!exact(k,KEY)||!id(k.key_id)||keys.has(k.key_id)||
       !ROLES.has(k.role)||!month(k.valid_from_month_utc)||
       !(k.retired_after_month_utc===null||month(k.retired_after_month_utc)))
      return denied('SHADOW_COVERAGE_KEY_INVALID_OR_DUPLICATE');
    const first=index(k.valid_from_month_utc);
    const last=k.retired_after_month_utc===null?end:index(k.retired_after_month_utc);
    if(first>end||last<begin||last<first||first>last)
      return denied('SHADOW_COVERAGE_KEY_LIFECYCLE_INVALID');
    keys.set(k.key_id,{first,last});
    for(let m=Math.max(begin,first);m<=Math.min(end,last);m++)
      required.add(k.key_id+'@'+m);
  }
  for(const a of s.attempts){
    if(!exact(a,ATTEMPT)||!id(a.request_id)||attempts.has(a.request_id)||
       !id(a.key_id)||!keys.has(a.key_id)||!month(a.initiated_month_utc)||
       !STATES.has(a.state))
      return denied('SHADOW_COVERAGE_ATTEMPT_INVALID_OR_DUPLICATE');
    const m=index(a.initiated_month_utc);
    const lifecycle=keys.get(a.key_id);
    if(m<begin||m>end||m<lifecycle.first||m>lifecycle.last)
      return denied('SHADOW_COVERAGE_ATTEMPT_OUTSIDE_KEY_LIFECYCLE');
    attempts.set(a.request_id,{key_id:a.key_id,month:m,state:a.state});
  }

  const statementIds=new Set(),digests=new Set(),matched=new Set();
  for(const srow of s.statements){
    if(!exact(srow,STATEMENT)||!id(srow.statement_id)||
       statementIds.has(srow.statement_id)||
       !id(srow.key_id)||!keys.has(srow.key_id)||
       !month(srow.month_utc)||srow.source!=='unverified-fixture'||
       typeof srow.digest_sha256!=='string'||
       !DIGEST.test(srow.digest_sha256)||digests.has(srow.digest_sha256)||
       !Array.isArray(srow.request_ids)||srow.request_ids.length>MAX_ATTEMPTS)
      return denied('SHADOW_COVERAGE_STATEMENT_UNTRUSTED_OR_DUPLICATE');
    const m=index(srow.month_utc),pair=srow.key_id+'@'+m;
    if(!required.has(pair))
      return denied('SHADOW_COVERAGE_STATEMENT_OUTSIDE_KEY_LIFECYCLE');
    if(observed.has(pair))
      return denied('SHADOW_COVERAGE_MULTIPLE_STATEMENTS_SAME_KEY_MONTH');
    observed.add(pair);statementIds.add(srow.statement_id);
    digests.add(srow.digest_sha256);
    const perStatement=new Set();
    for(const requestId of srow.request_ids){
      if(!id(requestId)||perStatement.has(requestId))
        return denied('SHADOW_COVERAGE_STATEMENT_REQUEST_INVALID_OR_DUPLICATE');
      perStatement.add(requestId);
      const a=attempts.get(requestId);
      if(!a)return denied('SHADOW_COVERAGE_ORPHAN_INVOICE_REQUEST');
      if(a.key_id!==srow.key_id||m<a.month)
        return denied('SHADOW_COVERAGE_CROSS_KEY_OR_PREDATED_INVOICE');
      // One request can appear in later months due to late/partial charges;
      // a matching mock line NEVER resolves an ambiguous billable outcome.
      matched.add(requestId);
    }
  }
  const missingPairs=Array.from(required).filter(k=>!observed.has(k));
  const unmatched=Array.from(attempts.keys()).filter(k=>!matched.has(k));
  const unknown=Array.from(attempts.values()).filter(
    a=>a.state==='ambiguous'||a.state==='pending').length;
  return denied(missingPairs.length?
    'SHADOW_COVERAGE_MISSING_KEY_MONTH_FIXTURES':
    unmatched.length?'SHADOW_COVERAGE_UNMATCHED_REQUEST_FIXTURES':
    'SHADOW_COVERAGE_ALL_FIXTURES_STILL_UNVERIFIED',{
    simulatedDeclaredKeyCount:keys.size,
    simulatedRequiredKeyMonthPairs:required.size,
    simulatedObservedKeyMonthPairs:observed.size,
    simulatedMissingKeyMonthPairs:missingPairs.length,
    simulatedUnmatchedRequestCount:unmatched.length,
    simulatedUnknownOutcomeCount:unknown,
    simulatedStatementCount:statementIds.size,
    simulatedAttemptCount:attempts.size,
  });
}

/**
 * Compare two complete, bounded, UNVERIFIED fixture inventories.
 * Detection of a disappearing entry is not a proof of provider tampering.
 * An apparently stable snapshot is not evidence of verified billing.
 * There is NO network read, trusted watermark, storage or financial action.
 */
const ACCEPTED_COVERAGE_DIAGNOSTICS=new Set([
  'SHADOW_COVERAGE_MISSING_KEY_MONTH_FIXTURES',
  'SHADOW_COVERAGE_UNMATCHED_REQUEST_FIXTURES',
  'SHADOW_COVERAGE_ALL_FIXTURES_STILL_UNVERIFIED',
]);
const sameRequests=(a,b)=>a.length===b.length&&
  a.every((request,i)=>request===b[i]);

export function assessSyntheticEvidenceContinuityOffline(
  previousJson,currentJson){
  // Reuse complete schema and budget bounds, not a bypassing mini-parser.
  const before=assessSyntheticEvidenceCoverageOffline(previousJson);
  const after=assessSyntheticEvidenceCoverageOffline(currentJson);
  if(!ACCEPTED_COVERAGE_DIAGNOSTICS.has(before.reason)||
     !ACCEPTED_COVERAGE_DIAGNOSTICS.has(after.reason))
    return denied('SHADOW_CONTINUITY_SNAPSHOT_UNTRUSTED');
  const previous=JSON.parse(previousJson),current=JSON.parse(currentJson);
  const oldEnd=index(previous.window.last_month_utc);
  if(previous.window.first_month_utc!==current.window.first_month_utc||
     index(current.window.last_month_utc)<oldEnd)
    return denied('SHADOW_CONTINUITY_WINDOW_REGRESSION');

  const oldKeys=new Map(previous.keys.map(k=>[k.key_id,k]));
  const newKeys=new Map(current.keys.map(k=>[k.key_id,k]));
  for(const [id,old] of oldKeys){
    const now=newKeys.get(id);
    if(!now)return denied('SHADOW_CONTINUITY_KEY_DISAPPEARED');
    if(now.role!==old.role||
       now.valid_from_month_utc!==old.valid_from_month_utc)
      return denied('SHADOW_CONTINUITY_KEY_IDENTITY_CHANGED');
    if(old.retired_after_month_utc!==now.retired_after_month_utc){
      // Recording retirement after the prior window is additive.
      // Backdating or changing an already-known retirement is not.
      if(old.retired_after_month_utc!==null||
         now.retired_after_month_utc===null||
         index(now.retired_after_month_utc)<oldEnd)
        return denied('SHADOW_CONTINUITY_KEY_RETIREMENT_REWRITTEN');
    }
  }
  for(const now of current.keys){
    if(!oldKeys.has(now.key_id)&&
       index(now.valid_from_month_utc)<=oldEnd)
      return denied('SHADOW_CONTINUITY_RETROACTIVE_KEY_DISCOVERY');
  }

  const oldAttempts=new Map(previous.attempts.map(a=>[a.request_id,a]));
  const newAttempts=new Map(current.attempts.map(a=>[a.request_id,a]));
  for(const [id,old] of oldAttempts){
    const now=newAttempts.get(id);
    if(!now)return denied('SHADOW_CONTINUITY_ATTEMPT_DISAPPEARED');
    if(now.key_id!==old.key_id||
       now.initiated_month_utc!==old.initiated_month_utc||
       now.state!==old.state)
      return denied('SHADOW_CONTINUITY_ATTEMPT_RECLASSIFIED_UNVERIFIED');
  }
  for(const now of current.attempts){
    if(!oldAttempts.has(now.request_id)&&
       index(now.initiated_month_utc)<=oldEnd)
      return denied('SHADOW_CONTINUITY_RETROACTIVE_ATTEMPT_DISCOVERY');
  }

  const oldStatements=new Map(previous.statements.map(s=>[s.statement_id,s]));
  const newStatements=new Map(current.statements.map(s=>[s.statement_id,s]));
  for(const [id,old] of oldStatements){
    const now=newStatements.get(id);
    if(!now)return denied('SHADOW_CONTINUITY_STATEMENT_DISAPPEARED');
    if(now.key_id!==old.key_id||now.month_utc!==old.month_utc||
       now.digest_sha256!==old.digest_sha256||now.source!==old.source||
       !sameRequests(now.request_ids,old.request_ids))
      return denied('SHADOW_CONTINUITY_STATEMENT_REWRITTEN');
  }
  for(const now of current.statements){
    if(!oldStatements.has(now.statement_id)&&
       index(now.month_utc)<=oldEnd)
      return denied('SHADOW_CONTINUITY_RETROACTIVE_STATEMENT_DISCOVERY');
  }

  return denied('SHADOW_CONTINUITY_STABLE_BUT_UNVERIFIED',{
    previousCoverageReason:before.reason,
    currentCoverageReason:after.reason,
    simulatedRetainedKeyCount:oldKeys.size,
    simulatedRetainedAttemptCount:oldAttempts.size,
    simulatedRetainedStatementCount:oldStatements.size,
    simulatedAddedStatementCount:newStatements.size-oldStatements.size,
  });
}
