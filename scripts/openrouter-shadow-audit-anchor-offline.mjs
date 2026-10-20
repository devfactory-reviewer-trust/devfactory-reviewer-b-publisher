/**
 * SYNTHETIC ONLY: verify an untrusted mock audit SHA-256 hash chain.
 * A self-anchored chain can be completely forged and rehashed:
 * consistency is NOT authenticity, external witnessing, or authorization.
 *
 * No sockets, credentials, invoice verification, durable journal or keys.
 */
import {createHash} from 'node:crypto';
import {assessSyntheticIncidentAuditOffline as assessAudit}
  from './openrouter-shadow-readonly-acquisition-plan-offline.mjs';

const ROOT=['schema','scope','transport','incident','entries','checkpoint'];
const INCIDENT=['incident_id','head_sha','request_digest_sha256','key_role'];
const ENTRY=['sequence','event_id','type','occurred_utc',
  'evidence_digest_sha256','previous_hash','entry_hash'];
const CHECKPOINT=['kind','root_hash','witness','externalProofAuthenticated',
  'durableStoreVerified'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const GENESIS='0'.repeat(64),MAX_BYTES=16384,MAX_EVENTS=24;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)&&Object.keys(v).length===keys.length&&
  keys.every(k=>Object.hasOwn(v,k));
const blocked=(reason,summary={})=>Object.freeze({
  status:'BLOCKED',reason,syntheticOnly:true,verified:false,
  providerEvidenceAuthenticated:false,externalWitnessAuthenticated:false,
  durableJournalVerified:false,independentReviewerApproved:false,
  actualHumanGo:false,actualMergeGo:false,maySpend:false,
  mayReserve:false,mayRetryAmbiguousRequest:false,mayReleaseHold:false,
  mayDeploy:false,mayStartRunner:false,mayCloseIncident:false,
  ...summary,
});
const payload=(incident,entry)=>JSON.stringify([
  'devfactory.shadow-audit-link.synthetic.v1',
  incident.incident_id,incident.head_sha,
  incident.request_digest_sha256,incident.key_role,
  entry.sequence,entry.event_id,entry.type,entry.occurred_utc,
  entry.evidence_digest_sha256,entry.previous_hash,
]);
const digest=(string)=>createHash('sha256').update(string,'utf8').digest('hex');

/**
 * This intentionally exports no signing, approval, spend or persistence.
 * Recomputing all hashes after tampering will pass structural validation,
 * which is exactly why a future independent external checkpoint is needed.
 */
export function assessSyntheticAuditAnchorOffline(json){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return blocked('SHADOW_ANCHOR_SYNTHETIC_SWITCH_REQUIRED');
  if(typeof json!=='string'||Buffer.byteLength(json,'utf8')>MAX_BYTES)
    return blocked('SHADOW_ANCHOR_FIXTURE_UNTRUSTED');
  let s;
  try{s=JSON.parse(json)}catch{
    return blocked('SHADOW_ANCHOR_FIXTURE_UNTRUSTED');
  }
  if(!exact(s,ROOT)||
     s.schema!=='devfactory.shadow-audit-anchor.synthetic.v1'||
     s.scope!=='illustrative-only'||s.transport!=='no-network'||
     !exact(s.incident,INCIDENT)||
     typeof s.incident.incident_id!=='string'||
     !ID.test(s.incident.incident_id)||
     typeof s.incident.head_sha!=='string'||
     !HEX40.test(s.incident.head_sha)||
     typeof s.incident.request_digest_sha256!=='string'||
     !HEX64.test(s.incident.request_digest_sha256)||
     !['development','reviewer_b'].includes(s.incident.key_role)||
     !Array.isArray(s.entries)||s.entries.length<2||
     s.entries.length>MAX_EVENTS||
     !exact(s.checkpoint,CHECKPOINT))
    return blocked('SHADOW_ANCHOR_FIXTURE_UNTRUSTED');

  if(s.checkpoint.kind!=='self-declared-fixture'||
     s.checkpoint.witness!=='unverified-fixture'||
     s.checkpoint.externalProofAuthenticated!==false||
     s.checkpoint.durableStoreVerified!==false||
     typeof s.checkpoint.root_hash!=='string'||
     !HEX64.test(s.checkpoint.root_hash))
    return blocked('SHADOW_ANCHOR_EXTERNAL_AUTHORITY_FORGED');

  const simplified=[];
  for(const entry of s.entries){
    if(!exact(entry,ENTRY)||
       typeof entry.previous_hash!=='string'||
       !HEX64.test(entry.previous_hash)||
       typeof entry.entry_hash!=='string'||
       !HEX64.test(entry.entry_hash))
      return blocked('SHADOW_ANCHOR_ENTRY_UNTRUSTED');
    simplified.push({
      sequence:entry.sequence,event_id:entry.event_id,
      type:entry.type,occurred_utc:entry.occurred_utc,
      evidence_digest_sha256:entry.evidence_digest_sha256,
    });
  }

  // Reuse the pre-existing strict redacted incident/event validator.
  const audit={
    schema:'devfactory.shadow-incident-audit.synthetic.v1',
    scope:'illustrative-only',transport:'no-network',
    ...s.incident,events:simplified,
    review:{status:'pending',providerEvidenceAuthenticated:false,
      independentReviewerApproved:false,humanGoGranted:false,
      holdReleaseApproved:false},
  };
  const prior=assessAudit(JSON.stringify(audit));
  if(prior.reason!=='SHADOW_AUDIT_PENDING_HUMAN_REVIEW_NO_AUTHORITY')
    return blocked('SHADOW_ANCHOR_EVENT_HISTORY_UNTRUSTED');

  let last=GENESIS;
  for(const e of s.entries){
    if(e.previous_hash!==last)
      return blocked('SHADOW_ANCHOR_PREVIOUS_LINK_MISMATCH');
    const computed=digest(payload(s.incident,e));
    if(e.entry_hash!==computed)
      return blocked('SHADOW_ANCHOR_ENTRY_DIGEST_MISMATCH');
    last=e.entry_hash;
  }
  if(last!==s.checkpoint.root_hash)
    return blocked('SHADOW_ANCHOR_SELF_DECLARED_CHECKPOINT_MISMATCH');

  return blocked('SHADOW_ANCHOR_INTERNALLY_CONSISTENT_UNWITNESSED',{
    simulatedEntryCount:s.entries.length,
    simulatedChainInternallyConsistent:true,
    simulatedRootMatchesSelfDeclaredCheckpoint:true,
    simulatedIndependentExternalCheckpointFound:false,
    simulatedNativeReviewerApprovalFound:false,
  });
}

/**
 * Offline incident drill for a HYPOTHETICAL independent checkpoint witness.
 * Prior/candidate checkpoint information is completely self-reported and
 * untrusted. There is no external clock, witness signature, anti-equivocation
 * service, key store, network, persistent ledger or human approval here.
 */
const WITNESS_ROOT=['schema','scope','transport','audit','witness','prior',
  'candidate','review'];
const WITNESS_META=['id','source','availability'];
const WITNESS_POINT=['sequence','root_hash','key_epoch','key_id',
  'key_status'];
const WITNESS_REVIEW=['externalSignatureAuthenticated',
  'witnessIndependentVerified','operatorApproved','holdReleaseApproved'];
const WITNESS_ID=/^[a-z][a-z0-9_.:-]{0,63}$/;
const WITNESS_MAX_BYTES=24576;
const witnessBlocked=(reason,classification)=>blocked(reason,{
  mockWitnessIncidentClass:classification,
  independentWitnessReachableVerified:false,
  trustedWitnessKeyEpochVerified:false,
  checkpointSignatureVerified:false,
  checkpointTimestampVerified:false,
  realIncidentEscalated:false,
  simulatedHumanInvestigationRequired:true,
  automaticReplayScheduled:false,
});
const validPoint=v=>exact(v,WITNESS_POINT)&&
  Number.isSafeInteger(v.sequence)&&v.sequence>=1&&v.sequence<=MAX_EVENTS&&
  typeof v.root_hash==='string'&&HEX64.test(v.root_hash)&&
  Number.isSafeInteger(v.key_epoch)&&v.key_epoch>=1&&v.key_epoch<=9999&&
  typeof v.key_id==='string'&&WITNESS_ID.test(v.key_id)&&
  ['active','revoked'].includes(v.key_status);

/**
 * Compares a mock chain and two untrusted checkpoints. No output confirms
 * a real witness signature, that keys are controlled independently,
 * that historical roots were not rewritten, or that a paid hold is clear.
 */
export function assessSyntheticWitnessIncidentOffline(json){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return witnessBlocked('SHADOW_WITNESS_SYNTHETIC_SWITCH_REQUIRED','invalid');
  if(typeof json!=='string'||
     Buffer.byteLength(json,'utf8')>WITNESS_MAX_BYTES)
    return witnessBlocked('SHADOW_WITNESS_FIXTURE_UNTRUSTED','invalid');
  let s;
  try{s=JSON.parse(json)}catch{
    return witnessBlocked('SHADOW_WITNESS_FIXTURE_UNTRUSTED','invalid');
  }
  if(!exact(s,WITNESS_ROOT)||
     s.schema!=='devfactory.shadow-witness-incident.synthetic.v1'||
     s.scope!=='illustrative-only'||s.transport!=='no-network'||
     !exact(s.witness,WITNESS_META)||
     typeof s.witness.id!=='string'||!WITNESS_ID.test(s.witness.id)||
     s.witness.source!=='unverified-fixture'||
     !['available','unavailable','timeout'].includes(
       s.witness.availability)||
     !validPoint(s.prior)||
     !exact(s.review,WITNESS_REVIEW))
    return witnessBlocked('SHADOW_WITNESS_FIXTURE_UNTRUSTED','invalid');

  if(WITNESS_REVIEW.some(k=>s.review[k]!==false))
    return witnessBlocked('SHADOW_WITNESS_FORGED_REVIEW_AUTHORITY','security');

  // Explicitly enforce the earlier strict redacted/hash-linked event
  // history first. A malformed mock chain cannot produce witness evidence.
  const anchor=assessSyntheticAuditAnchorOffline(JSON.stringify(s.audit));
  if(anchor.reason!=='SHADOW_ANCHOR_INTERNALLY_CONSISTENT_UNWITNESSED')
    return witnessBlocked('SHADOW_WITNESS_AUDIT_CHAIN_UNTRUSTED','provenance');
  const entries=s.audit.entries;
  if(s.prior.sequence>entries.length)
    return witnessBlocked('SHADOW_WITNESS_PRIOR_CHECKPOINT_UNBOUND','provenance');
  if(s.prior.root_hash!==entries[s.prior.sequence-1].entry_hash)
    return witnessBlocked('SHADOW_WITNESS_PRIOR_FORK_SUSPECTED','fork');
  if(s.prior.key_status==='revoked')
    return witnessBlocked('SHADOW_WITNESS_REVOKED_PRIOR_KEY','rotation');
  if(s.witness.availability!=='available'){
    if(s.candidate!==null)
      return witnessBlocked('SHADOW_WITNESS_AVAILABILITY_CONTRADICTORY','invalid');
    return witnessBlocked(
      s.witness.availability==='timeout'?
        'SHADOW_WITNESS_TIMEOUT_NO_AUTO_RETRY':
        'SHADOW_WITNESS_OUTAGE_MANUAL_ESCALATION','outage');
  }
  if(!validPoint(s.candidate))
    return witnessBlocked('SHADOW_WITNESS_CANDIDATE_UNTRUSTED','invalid');
  if(s.candidate.key_status==='revoked')
    return witnessBlocked('SHADOW_WITNESS_REVOKED_CURRENT_KEY','rotation');
  if(s.candidate.sequence<s.prior.sequence)
    return witnessBlocked('SHADOW_WITNESS_CHECKPOINT_REPLAY','replay');
  if(s.candidate.sequence>entries.length)
    return witnessBlocked('SHADOW_WITNESS_FUTURE_CHECKPOINT_UNBOUND',
      'provenance');
  const actualRoot=entries[s.candidate.sequence-1].entry_hash;
  if(s.candidate.root_hash!==actualRoot)
    return witnessBlocked('SHADOW_WITNESS_DIVERGENT_ROOT_FORK','fork');
  if(s.candidate.key_epoch<s.prior.key_epoch)
    return witnessBlocked('SHADOW_WITNESS_KEY_EPOCH_REGRESSION','replay');
  if(s.candidate.key_epoch===s.prior.key_epoch&&
     s.candidate.key_id!==s.prior.key_id)
    return witnessBlocked('SHADOW_WITNESS_UNEXPLAINED_KEY_CHANGE','rotation');
  if(s.candidate.key_epoch>s.prior.key_epoch)
    return witnessBlocked('SHADOW_WITNESS_ROTATION_UNAUTHENTICATED',
      'rotation');
  if(s.candidate.sequence<entries.length)
    return witnessBlocked('SHADOW_WITNESS_STALE_CHECKPOINT','stale');

  // Same key/epoch/HEAD/root across fixtures still proves nothing about
  // custody, signature, authenticated quorum, or third-party witnessing.
  return witnessBlocked('SHADOW_WITNESS_MATCHING_FIXTURES_NOT_AUTHENTIC',
    'unverified');
}
