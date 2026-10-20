/**
 * SYNTHETIC ONLY — compare attacker-controlled claims from multiple
 * hypothetical external audit witnesses. Not a quorum protocol:
 * matching observations cannot establish custodian independence,
 * signatures, real history, billing evidence, approval or authority.
 * No network client, provider key, persistence, signing or payments.
 */
import {assessSyntheticAuditAnchorOffline}
  from './openrouter-shadow-audit-anchor-offline.mjs';

const ROOT=['schema','scope','transport','audit','declaredWitnesses',
  'observations','review'];
const OBS=['id','claimedCustodian','source','availability','checkpoint'];
const POINT=['sequence','root_hash','signer_id','key_epoch','key_status',
  'signature_status'];
const REVIEW=['externalSignaturesAuthenticated','independentCustodyVerified',
  'operatorApproved','holdReleaseApproved'];
const ID=/^fixture:[a-z][a-z0-9_-]{0,39}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX_INPUT_BYTES=28672;
const exact=(x,keys)=>x!==null&&typeof x==='object'&&
  !Array.isArray(x)&&Object.keys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const denial=(reason,kind,extra={})=>Object.freeze({
  status:'BLOCKED',reason,syntheticOnly:true,verified:false,
  simulatedIssueClass:kind,independentWitnessesAuthenticated:false,
  independentCustodyVerified:false,providerEvidenceAuthenticated:false,
  externalSignaturesAuthenticated:false,checkpointQuorumAuthenticated:false,
  realIncidentEscalated:false,independentReviewerApproved:false,
  maySpend:false,mayReserve:false,mayRetryAmbiguousRequest:false,
  mayReleaseHold:false,mayDeploy:false,mayStartRunner:false,
  mayCloseIncident:false,automaticRetryScheduled:false,
  ...extra,
});
const validPoint=p=>exact(p,POINT)&&Number.isSafeInteger(p.sequence)&&
  p.sequence>=1&&p.sequence<=24&&typeof p.root_hash==='string'&&
  HASH.test(p.root_hash)&&typeof p.signer_id==='string'&&
  ID.test(p.signer_id)&&Number.isSafeInteger(p.key_epoch)&&
  p.key_epoch>=1&&p.key_epoch<=9999&&
  ['active','revoked'].includes(p.key_status)&&
  p.signature_status==='not-verified';

/**
 * All observations and even the declared inventory may be forged.
 * Structural disagreement can be discovered; structural agreement
 * has no authority. No inferred quorum or minimum spend threshold.
 */
export function assessSyntheticMultiWitnessOffline(json){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return denial('SHADOW_MULTI_WITNESS_SWITCH_REQUIRED','invalid');
  if(typeof json!=='string'||Buffer.byteLength(json,'utf8')>MAX_INPUT_BYTES)
    return denial('SHADOW_MULTI_WITNESS_FIXTURE_UNTRUSTED','invalid');
  let data;
  try{data=JSON.parse(json)}catch{
    return denial('SHADOW_MULTI_WITNESS_FIXTURE_UNTRUSTED','invalid');
  }
  if(!exact(data,ROOT)||
     data.schema!=='devfactory.shadow-multiwitness.synthetic.v1'||
     data.scope!=='illustrative-only'||data.transport!=='no-network'||
     !Array.isArray(data.declaredWitnesses)||
     data.declaredWitnesses.length<2||
     data.declaredWitnesses.length>6||
     !Array.isArray(data.observations)||
     data.observations.length>6||
     !exact(data.review,REVIEW))
    return denial('SHADOW_MULTI_WITNESS_FIXTURE_UNTRUSTED','invalid');
  if(REVIEW.some(k=>data.review[k]!==false))
    return denial('SHADOW_MULTI_WITNESS_FORGED_AUTHORIZATION','security');
  const declared=new Set();
  for(const id of data.declaredWitnesses){
    if(typeof id!=='string'||!ID.test(id)||declared.has(id))
      return denial('SHADOW_MULTI_WITNESS_INVENTORY_INVALID','invalid');
    declared.add(id);
  }
  const observed=new Set(),custodians=new Set(),available=[];
  let claimedCustodyOverlap=false,unavailable=0;
  for(const o of data.observations){
    if(!exact(o,OBS)||typeof o.id!=='string'||!declared.has(o.id)||
       observed.has(o.id)||typeof o.claimedCustodian!=='string'||
       !ID.test(o.claimedCustodian)||
       o.source!=='unverified-fixture'||
       !['available','offline','timeout'].includes(o.availability))
      return denial('SHADOW_MULTI_WITNESS_OBSERVATION_INVALID','invalid');
    observed.add(o.id);
    if(custodians.has(o.claimedCustodian))
      claimedCustodyOverlap=true;
    custodians.add(o.claimedCustodian);
    if(o.availability!=='available'){
      if(o.checkpoint!==null)
        return denial('SHADOW_MULTI_WITNESS_AVAILABILITY_CONTRADICTORY','invalid');
      unavailable++;
    }else{
      if(!validPoint(o.checkpoint))
        return denial('SHADOW_MULTI_WITNESS_CHECKPOINT_UNTRUSTED','invalid');
      available.push(o.checkpoint);
    }
  }
  // Disagreements must not be hidden by a forged incomplete inventory.
  const anchor=assessSyntheticAuditAnchorOffline(JSON.stringify(data.audit));
  if(anchor.reason!=='SHADOW_ANCHOR_INTERNALLY_CONSISTENT_UNWITNESSED')
    return denial('SHADOW_MULTI_WITNESS_AUDIT_CHAIN_UNTRUSTED','provenance');
  const entries=data.audit.entries;
  if(claimedCustodyOverlap)
    return denial('SHADOW_MULTI_WITNESS_CUSTODY_COLLISION','custody');
  for(const c of available){
    if(c.key_status==='revoked')
      return denial('SHADOW_MULTI_WITNESS_REVOKED_SIGNER','rotation');
    if(c.key_epoch!==1)
      return denial('SHADOW_MULTI_WITNESS_ROTATION_UNAUTHENTICATED','rotation');
    if(c.sequence>entries.length)
      return denial('SHADOW_MULTI_WITNESS_FUTURE_CHECKPOINT','provenance');
  }
  // First compare witnesses with each other at matching heights,
  // without assuming their independent operation or trusted identity.
  for(let i=0;i<available.length;i++){
    for(let j=i+1;j<available.length;j++){
      if(available[i].sequence===available[j].sequence&&
         available[i].root_hash!==available[j].root_hash)
        return denial('SHADOW_MULTI_WITNESS_SAME_HEIGHT_FORK','fork');
    }
  }
  for(const c of available){
    if(c.root_hash!==entries[c.sequence-1].entry_hash)
      return denial('SHADOW_MULTI_WITNESS_LOCAL_ROOT_DIVERGENCE','fork');
  }
  if(observed.size!==declared.size)
    return denial('SHADOW_MULTI_WITNESS_DECLARED_MEMBER_MISSING','coverage');
  if(unavailable>0)
    return denial('SHADOW_MULTI_WITNESS_OUTAGE_NO_QUORUM','outage');
  if(available.some(c=>c.sequence<entries.length))
    return denial('SHADOW_MULTI_WITNESS_STALE_CHECKPOINT','stale');
  // Even complete, matching, active, distinctly *claimed* custodians
  // do not prove external witnesses, a quorum, nor provider billing.
  return denial('SHADOW_MULTI_WITNESS_MATCH_ONLY_NO_AUTHORITY','unverified',{
    simulatedDeclaredWitnessCount:declared.size,
    simulatedMatchingWitnessCount:available.length,
    simulatedCustodyActuallyVerified:false,
  });
}
