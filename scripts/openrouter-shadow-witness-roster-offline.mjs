/**
 * SYNTHETIC ONLY: threat-model an untrusted witness roster and delayed
 * propagation of key rotation / revocation. No independent witness is
 * provisioned, signed, queried or trusted by this pure offline function.
 * Matching mock snapshots are NEVER an authenticated quorum.
 */
import {createHash} from 'node:crypto';

const ROOT=['schema','scope','transport','head_sha','previous','current',
  'declaredReplicas','replicas','review'];
const ROSTER=['epoch','members'];
const MEMBER=['id','custodian','signer_id','key_epoch','key_status'];
const REPLICA=['id','claimedCustodian','availability','epoch','digest_sha256'];
const REVIEW=['rosterAuthorityAuthenticated','replicaIdentityAuthenticated',
  'independentCustodyVerified','signerRotationApproved',
  'revocationReceiptAuthenticated','humanGoGranted','holdReleaseApproved'];
const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const FIXTURE=/^fixture:[a-z][a-z0-9_-]{0,39}$/;
const MAX_INPUT=16384,MAX_MEMBERS=6,MAX_REPLICAS=6;
const exact=(value,keys)=>value!==null&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).length===keys.length&&
  keys.every(k=>Object.hasOwn(value,k));
const denial=(reason,classification,extra={})=>Object.freeze({
  status:'BLOCKED',reason,syntheticOnly:true,verified:false,
  simulatedIssueClass:classification,
  rosterAuthorityAuthenticated:false,replicaIdentityAuthenticated:false,
  independentCustodyVerified:false,
  externalSignaturesAuthenticated:false,signerRotationApproved:false,
  revocationReceiptAuthenticated:false,
  providerEvidenceAuthenticated:false,independentReviewerApproved:false,
  mayReadProviderData:false,maySpend:false,mayReserve:false,
  mayRetryAmbiguousRequest:false,mayReleaseHold:false,mayDeploy:false,
  mayStartRunner:false,mayCloseIncident:false,automaticRetryScheduled:false,
  ...extra,
});
const isMember=x=>exact(x,MEMBER)&&
  typeof x.id==='string'&&FIXTURE.test(x.id)&&
  typeof x.custodian==='string'&&FIXTURE.test(x.custodian)&&
  typeof x.signer_id==='string'&&FIXTURE.test(x.signer_id)&&
  Number.isSafeInteger(x.key_epoch)&&x.key_epoch>=1&&
  x.key_epoch<=9999&&['active','revoked'].includes(x.key_status);
const isRoster=x=>exact(x,ROSTER)&&
  Number.isSafeInteger(x.epoch)&&x.epoch>=1&&x.epoch<=9999&&
  Array.isArray(x.members)&&x.members.length>=2&&
  x.members.length<=MAX_MEMBERS&&x.members.every(isMember)&&
  x.members.every((m,i)=>i===0||x.members[i-1].id<m.id);
const digestRoster=(head,roster)=>createHash('sha256').update(JSON.stringify([
  'devfactory.shadow-witness-roster.synthetic.v1',
  head,roster.epoch,
  roster.members.map(m=>[m.id,m.custodian,m.signer_id,
    m.key_epoch,m.key_status]),
]),'utf8').digest('hex');

/**
 * Both "previous" and "current" rosters and every replica are entirely
 * caller-supplied. This validates internal contradictions only. Revocation
 * and key-rotation decisions must later be verified out-of-band.
 */
export function assessSyntheticWitnessRosterOffline(json){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return denial('SHADOW_ROSTER_SYNTHETIC_SWITCH_REQUIRED','invalid');
  if(typeof json!=='string'||Buffer.byteLength(json,'utf8')>MAX_INPUT)
    return denial('SHADOW_ROSTER_FIXTURE_UNTRUSTED','invalid');
  let x;
  try{x=JSON.parse(json)}catch{
    return denial('SHADOW_ROSTER_FIXTURE_UNTRUSTED','invalid');
  }
  if(!exact(x,ROOT)||x.schema!=='devfactory.shadow-witness-roster.synthetic.v1'||
     x.scope!=='illustrative-only'||x.transport!=='no-network'||
     typeof x.head_sha!=='string'||!HEX40.test(x.head_sha)||
     !isRoster(x.previous)||!isRoster(x.current)||
     !Array.isArray(x.declaredReplicas)||
     x.declaredReplicas.length<2||
     x.declaredReplicas.length>MAX_REPLICAS||
     !Array.isArray(x.replicas)||x.replicas.length>MAX_REPLICAS||
     !exact(x.review,REVIEW))
    return denial('SHADOW_ROSTER_FIXTURE_UNTRUSTED','invalid');
  if(REVIEW.some(k=>x.review[k]!==false))
    return denial('SHADOW_ROSTER_FORGED_AUTHORIZATION','security');
  if(x.current.epoch!==x.previous.epoch+1)
    return denial('SHADOW_ROSTER_EPOCH_GAP_OR_ROLLBACK','replay');

  const previousIds=x.previous.members.map(m=>m.id);
  const currentIds=x.current.members.map(m=>m.id);
  if(previousIds.join('|')!==currentIds.join('|'))
    return denial('SHADOW_ROSTER_MEMBERSHIP_CHANGE_UNVERIFIED','coverage');
  const declared=new Set();
  for(const id of x.declaredReplicas){
    if(typeof id!=='string'||!FIXTURE.test(id)||declared.has(id))
      return denial('SHADOW_ROSTER_REPLICA_INVENTORY_INVALID','invalid');
    declared.add(id);
  }
  const custodianCurrent=new Set(),signerCurrent=new Set();
  for(const m of x.current.members){
    if(custodianCurrent.has(m.custodian))
      return denial('SHADOW_ROSTER_CUSTODY_COLLISION','custody');
    if(signerCurrent.has(m.signer_id))
      return denial('SHADOW_ROSTER_SIGNER_COLLISION','custody');
    custodianCurrent.add(m.custodian);signerCurrent.add(m.signer_id);
  }
  let revocationCount=0;
  for(let i=0;i<x.current.members.length;i++){
    const before=x.previous.members[i],after=x.current.members[i];
    if(before.key_status==='revoked'&&after.key_status==='active')
      return denial('SHADOW_ROSTER_REVOCATION_ROLLBACK','rotation');
    if(after.key_epoch<before.key_epoch)
      return denial('SHADOW_ROSTER_KEY_EPOCH_ROLLBACK','replay');
    if(after.custodian!==before.custodian)
      return denial('SHADOW_ROSTER_CUSTODY_TRANSFER_UNAUTHENTICATED','custody');
    if(after.signer_id!==before.signer_id){
      if(after.key_epoch<=before.key_epoch)
        return denial('SHADOW_ROSTER_SILENT_SIGNER_SUBSTITUTION','rotation');
      return denial('SHADOW_ROSTER_ROTATION_NOT_AUTHENTICATED','rotation');
    }
    if(after.key_epoch>before.key_epoch)
      return denial('SHADOW_ROSTER_KEY_EPOCH_WITHOUT_ROTATION','rotation');
    if(before.key_status==='active'&&after.key_status==='revoked')
      revocationCount++;
  }

  const prevDigest=digestRoster(x.head_sha,x.previous);
  const currDigest=digestRoster(x.head_sha,x.current);
  const observed=new Set(),replicaCustodians=new Set();
  let stale=0,unavailable=0;
  for(const r of x.replicas){
    if(!exact(r,REPLICA)||typeof r.id!=='string'||
       !declared.has(r.id)||observed.has(r.id)||
       typeof r.claimedCustodian!=='string'||
       !FIXTURE.test(r.claimedCustodian)||
       !['available','offline','timeout'].includes(r.availability))
      return denial('SHADOW_ROSTER_REPLICA_UNTRUSTED','invalid');
    observed.add(r.id);
    if(replicaCustodians.has(r.claimedCustodian))
      return denial('SHADOW_ROSTER_REPLICA_CUSTODY_COLLISION','custody');
    replicaCustodians.add(r.claimedCustodian);
    if(r.availability!=='available'){
      if(r.epoch!==null||r.digest_sha256!==null)
        return denial('SHADOW_ROSTER_OUTAGE_REPORT_CONTRADICTORY','invalid');
      unavailable++;
      continue;
    }
    if(!Number.isSafeInteger(r.epoch)||r.epoch<1||
       r.epoch>9999||typeof r.digest_sha256!=='string'||
       !HEX64.test(r.digest_sha256))
      return denial('SHADOW_ROSTER_REPLICA_CHECKPOINT_UNTRUSTED','invalid');
    if(r.epoch<x.previous.epoch)
      return denial('SHADOW_ROSTER_REPLICA_EPOCH_ROLLBACK','replay');
    if(r.epoch>x.current.epoch)
      return denial('SHADOW_ROSTER_REPLICA_FUTURE_EPOCH_UNBOUND','replay');
    const expectedDigest=r.epoch===x.current.epoch?currDigest:prevDigest;
    if(r.digest_sha256!==expectedDigest)
      return denial('SHADOW_ROSTER_SAME_EPOCH_EQUIVOCATION','fork');
    if(r.epoch<x.current.epoch)stale++;
  }
  if(observed.size!==declared.size)
    return denial('SHADOW_ROSTER_REPLICA_NOT_REPORTED','coverage');
  if(stale>0&&revocationCount>0)
    return denial('SHADOW_ROSTER_REVOCATION_PROPAGATION_DELAY','revocation');
  if(stale>0)
    return denial('SHADOW_ROSTER_PROPAGATION_DELAY','stale');
  if(unavailable>0)
    return denial('SHADOW_ROSTER_UNAVAILABLE_REPLICA','outage');
  // A matching roster created by an attacker is not a signed identity
  // registry, not quorum, not authorization, and not proof of revocation.
  return denial('SHADOW_ROSTER_MATCHING_FIXTURES_NOT_TRUSTED','unverified',{
    simulatedCurrentEpoch:x.current.epoch,
    simulatedDeclaredMemberCount:x.current.members.length,
    simulatedDeclaredReplicaCount:declared.size,
    simulatedRevocationsWithoutProvenance:revocationCount,
  });
}
