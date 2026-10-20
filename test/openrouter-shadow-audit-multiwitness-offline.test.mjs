import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {assessSyntheticMultiWitnessOffline as evaluate}
  from '../scripts/openrouter-shadow-audit-multiwitness-offline.mjs';

const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const makeAudit=()=>{
  const incident={incident_id:'incident:mock-001',head_sha:'a'.repeat(40),
    request_digest_sha256:'b'.repeat(64),key_role:'reviewer_b'};
  const entries=[
    {sequence:1,event_id:'ev:detect',type:'detected',
      occurred_utc:'2026-10-20T15:00:00Z',evidence_digest_sha256:null},
    {sequence:2,event_id:'ev:triage',type:'triaged',
      occurred_utc:'2026-10-20T15:01:00Z',evidence_digest_sha256:null},
    {sequence:3,event_id:'ev:evidence',type:'evidence_noted',
      occurred_utc:'2026-10-20T15:02:00Z',evidence_digest_sha256:'c'.repeat(64)},
    {sequence:4,event_id:'ev:review',type:'manual_review_requested',
      occurred_utc:'2026-10-20T15:03:00Z',evidence_digest_sha256:null},
  ];
  let prev='0'.repeat(64);
  for(const e of entries){
    e.previous_hash=prev;
    e.entry_hash=sha(JSON.stringify([
      'devfactory.shadow-audit-link.synthetic.v1',
      incident.incident_id,incident.head_sha,
      incident.request_digest_sha256,incident.key_role,
      e.sequence,e.event_id,e.type,e.occurred_utc,
      e.evidence_digest_sha256,e.previous_hash,
    ]));
    prev=e.entry_hash;
  }
  return {schema:'devfactory.shadow-audit-anchor.synthetic.v1',
    scope:'illustrative-only',transport:'no-network',incident,entries,
    checkpoint:{kind:'self-declared-fixture',root_hash:prev,
      witness:'unverified-fixture',externalProofAuthenticated:false,
      durableStoreVerified:false}};
};
const base=()=>{
  const audit=makeAudit();
  return {schema:'devfactory.shadow-multiwitness.synthetic.v1',
    scope:'illustrative-only',transport:'no-network',audit,
    declaredWitnesses:['fixture:w1','fixture:w2','fixture:w3'],
    observations:['w1','w2','w3'].map(id=>({
      id:'fixture:'+id,claimedCustodian:'fixture:owner_'+id,
      source:'unverified-fixture',availability:'available',
      checkpoint:{sequence:4,root_hash:audit.entries[3].entry_hash,
        signer_id:'fixture:signer_'+id,key_epoch:1,
        key_status:'active',signature_status:'not-verified'},
    })),
    review:{externalSignaturesAuthenticated:false,
      independentCustodyVerified:false,operatorApproved:false,
      holdReleaseApproved:false}};
};
const raw=o=>JSON.stringify(o);
const withSwitch=fn=>{
  const prev=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
  try{return fn()}finally{
    if(prev===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
    else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prev;
  }
};
const denied=(r,reason,kind)=>{
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.verified,false);
  assert.equal(r.syntheticOnly,true);
  for(const k of [
    'independentWitnessesAuthenticated','independentCustodyVerified',
    'providerEvidenceAuthenticated','externalSignaturesAuthenticated',
    'checkpointQuorumAuthenticated','realIncidentEscalated',
    'independentReviewerApproved','maySpend','mayReserve',
    'mayRetryAmbiguousRequest','mayReleaseHold','mayDeploy',
    'mayStartRunner','mayCloseIncident','automaticRetryScheduled'])
    assert.equal(r[k],false,k);
  assert.equal(Object.isFrozen(r),true);
  if(reason)assert.equal(r.reason,reason);
  if(kind)assert.equal(r.simulatedIssueClass,kind);
};

test('explicit synthetic-only switch required',()=>{
  const prev=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{denied(evaluate(raw(base())),
    'SHADOW_MULTI_WITNESS_SWITCH_REQUIRED','invalid');}
  finally{if(prev!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prev;}
});
test('matching three distinct claimed custodians never proves independent quorum',()=>withSwitch(()=>{
  const r=evaluate(raw(base()));
  denied(r,'SHADOW_MULTI_WITNESS_MATCH_ONLY_NO_AUTHORITY','unverified');
  assert.equal(r.simulatedMatchingWitnessCount,3);
  assert.equal(r.simulatedDeclaredWitnessCount,3);
  assert.equal(r.simulatedCustodyActuallyVerified,false);
}));
test('two witnesses with conflicting roots at same sequence are a fork',()=>withSwitch(()=>{
  const s=base();s.observations[1].checkpoint.root_hash='d'.repeat(64);
  denied(evaluate(raw(s)),'SHADOW_MULTI_WITNESS_SAME_HEIGHT_FORK','fork');
}));
test('a lone incorrect mock witness root conflicts with local audit',()=>withSwitch(()=>{
  const s=base();s.observations[1].checkpoint.root_hash='d'.repeat(64);
  s.observations[1].checkpoint.sequence=3;
  denied(evaluate(raw(s)),'SHADOW_MULTI_WITNESS_LOCAL_ROOT_DIVERGENCE','fork');
}));
test('declared witness omission blocks despite other matching objects',()=>withSwitch(()=>{
  const s=base();s.observations.pop();
  denied(evaluate(raw(s)),
    'SHADOW_MULTI_WITNESS_DECLARED_MEMBER_MISSING','coverage');
}));
test('offline declared witness cannot silently count toward synthetic quorum',()=>withSwitch(()=>{
  const s=base();s.observations[2].availability='offline';
  s.observations[2].checkpoint=null;
  denied(evaluate(raw(s)),'SHADOW_MULTI_WITNESS_OUTAGE_NO_QUORUM','outage');
}));
test('timeout witness is not a cleared invoice or a retry permission',()=>withSwitch(()=>{
  const s=base();s.observations[2].availability='timeout';
  s.observations[2].checkpoint=null;
  denied(evaluate(raw(s)),'SHADOW_MULTI_WITNESS_OUTAGE_NO_QUORUM','outage');
}));
test('outage carrying a purported successful checkpoint is contradictory',()=>withSwitch(()=>{
  const s=base();s.observations[2].availability='timeout';
  denied(evaluate(raw(s)),
    'SHADOW_MULTI_WITNESS_AVAILABILITY_CONTRADICTORY','invalid');
}));
test('two claimed witnesses with same custody are not independent',()=>withSwitch(()=>{
  const s=base();s.observations[1].claimedCustodian=
    s.observations[0].claimedCustodian;
  denied(evaluate(raw(s)),'SHADOW_MULTI_WITNESS_CUSTODY_COLLISION','custody');
}));
test('revoked signing fixture cannot count toward confidence',()=>withSwitch(()=>{
  const s=base();s.observations[1].checkpoint.key_status='revoked';
  denied(evaluate(raw(s)),'SHADOW_MULTI_WITNESS_REVOKED_SIGNER','rotation');
}));
test('unverified epoch rotation never becomes trusted',()=>withSwitch(()=>{
  const s=base();s.observations[1].checkpoint.key_epoch=2;
  denied(evaluate(raw(s)),
    'SHADOW_MULTI_WITNESS_ROTATION_UNAUTHENTICATED','rotation');
}));
test('stale checkpoint does not witness full current incident',()=>withSwitch(()=>{
  const s=base();
  for(const o of s.observations){
    o.checkpoint.sequence=3;
    o.checkpoint.root_hash=s.audit.entries[2].entry_hash;
  }
  denied(evaluate(raw(s)),'SHADOW_MULTI_WITNESS_STALE_CHECKPOINT','stale');
}));
test('future checkpoint beyond local journal has no binding',()=>withSwitch(()=>{
  const s=base();s.observations[2].checkpoint.sequence=5;
  denied(evaluate(raw(s)),'SHADOW_MULTI_WITNESS_FUTURE_CHECKPOINT','provenance');
}));
test('fully forged journal and rewritten matching checkpoints still denied',()=>withSwitch(()=>{
  const s=base();s.audit.entries[2].evidence_digest_sha256='e'.repeat(64);
  let prev='0'.repeat(64);
  for(const e of s.audit.entries){
    e.previous_hash=prev;
    e.entry_hash=sha(JSON.stringify([
      'devfactory.shadow-audit-link.synthetic.v1',
      s.audit.incident.incident_id,s.audit.incident.head_sha,
      s.audit.incident.request_digest_sha256,s.audit.incident.key_role,
      e.sequence,e.event_id,e.type,e.occurred_utc,
      e.evidence_digest_sha256,e.previous_hash,
    ]));prev=e.entry_hash;
  }
  s.audit.checkpoint.root_hash=prev;
  for(const o of s.observations)o.checkpoint.root_hash=prev;
  denied(evaluate(raw(s)),
    'SHADOW_MULTI_WITNESS_MATCH_ONLY_NO_AUTHORITY','unverified');
}));
test('forged approval and independent signature claims rejected',()=>withSwitch(()=>{
  for(const key of Object.keys(base().review)){
    const s=base();s.review[key]=true;
    denied(evaluate(raw(s)),
      'SHADOW_MULTI_WITNESS_FORGED_AUTHORIZATION','security');
  }
}));
test('credential, body, host and alleged signed proof injected into mock denied',()=>withSwitch(()=>{
  const edits=[
    s=>{s.observations[0].headers={Authorization:'Bearer SECRET'};},
    s=>{s.observations[0].url='https://example.invalid';},
    s=>{s.observations[0].checkpoint.signature='fake';},
    s=>{s.observations[0].checkpoint.signature_status='verified';},
    s=>{s.observations[0].source='real-provider';},
    s=>{s.observations[0].checkpoint.root_hash='not-a-hash';},
    s=>{s.transport='http';},
    s=>{s.token='some-secret';},
  ];
  for(const change of edits){
    const s=base();change(s);
    const r=evaluate(raw(s));denied(r);
    assert.match(r.reason,/UNTRUSTED|INVALID/);
  }
}));
test('duplicate declared IDs, duplicated observations, unknown observer denied',()=>withSwitch(()=>{
  const examples=[
    s=>{s.declaredWitnesses[1]=s.declaredWitnesses[0];},
    s=>{s.observations[1].id=s.observations[0].id;},
    s=>{s.observations[0].id='fixture:not_declared';},
    s=>{s.declaredWitnesses=['fixture:onlyone'];},
  ];
  for(const change of examples){
    const s=base();change(s);
    const r=evaluate(raw(s));denied(r);
    assert.match(r.reason,/INVENTORY_INVALID|OBSERVATION_INVALID|FIXTURE_UNTRUSTED/);
  }
}));
test('malformed root, oversize or bad local SHA chain is fail closed',()=>withSwitch(()=>{
  for(const input of [null,'{',{},' '.repeat(28673)]){
    denied(evaluate(input),
      'SHADOW_MULTI_WITNESS_FIXTURE_UNTRUSTED','invalid');
  }
  const s=base();s.audit.entries[2].event_id='changed-no-rehash';
  denied(evaluate(raw(s)),
    'SHADOW_MULTI_WITNESS_AUDIT_CHAIN_UNTRUSTED','provenance');
}));
test('paid Publisher and immutable spend gate cannot import the mock comparison',()=>{
  const protectedCode=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  const mockScript=readFileSync(new URL(
    '../scripts/openrouter-shadow-audit-multiwitness-offline.mjs',
    import.meta.url),'utf8');
  for(const src of [protectedCode,gate])
    assert.doesNotMatch(src,/openrouter-shadow-audit-multiwitness-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(mockScript,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});
