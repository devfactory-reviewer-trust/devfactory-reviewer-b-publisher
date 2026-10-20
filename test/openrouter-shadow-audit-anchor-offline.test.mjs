import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {assessSyntheticAuditAnchorOffline as assess,
  assessSyntheticWitnessIncidentOffline as witness}
  from '../scripts/openrouter-shadow-audit-anchor-offline.mjs';

const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const entry=(sequence,event_id,type,occurred_utc,evidence_digest_sha256=null)=>({
  sequence,event_id,type,occurred_utc,evidence_digest_sha256,
  previous_hash:'0'.repeat(64),entry_hash:'0'.repeat(64),
});
const mock=()=>({
  schema:'devfactory.shadow-audit-anchor.synthetic.v1',
  scope:'illustrative-only',transport:'no-network',
  incident:{incident_id:'incident:fixture-1',
    head_sha:'a'.repeat(40),request_digest_sha256:'b'.repeat(64),
    key_role:'reviewer_b'},
  entries:[
    entry(1,'event:detected','detected','2026-10-20T15:00:00Z'),
    entry(2,'event:triaged','triaged','2026-10-20T15:01:00Z'),
    entry(3,'event:evidence','evidence_noted','2026-10-20T15:02:00Z',
      'c'.repeat(64)),
    entry(4,'event:manual-review','manual_review_requested',
      '2026-10-20T15:03:00Z'),
  ],
  checkpoint:{kind:'self-declared-fixture',
    root_hash:'0'.repeat(64),witness:'unverified-fixture',
    externalProofAuthenticated:false,durableStoreVerified:false},
});
const rehash=s=>{
  let prior='0'.repeat(64);
  for(const e of s.entries){
    e.previous_hash=prior;
    e.entry_hash=sha(JSON.stringify([
      'devfactory.shadow-audit-link.synthetic.v1',
      s.incident.incident_id,s.incident.head_sha,
      s.incident.request_digest_sha256,s.incident.key_role,
      e.sequence,e.event_id,e.type,e.occurred_utc,
      e.evidence_digest_sha256,e.previous_hash,
    ]));
    prior=e.entry_hash;
  }
  s.checkpoint.root_hash=prior;
  return s;
};
const encode=s=>JSON.stringify(s);
const fixture=()=>rehash(mock());
const withSwitch=fn=>{
  const prior=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
  try{return fn()}finally{
    if(prior===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
    else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prior;
  }
};
const blocked=(result,reason)=>{
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.syntheticOnly,true);
  for(const k of ['verified','providerEvidenceAuthenticated',
    'externalWitnessAuthenticated','durableJournalVerified',
    'independentReviewerApproved','actualHumanGo','actualMergeGo',
    'maySpend','mayReserve','mayRetryAmbiguousRequest','mayReleaseHold',
    'mayDeploy','mayStartRunner','mayCloseIncident'])
    assert.equal(result[k],false,k);
  assert.ok(Object.isFrozen(result));
  if(reason)assert.equal(result.reason,reason);
};
test('offline switch mandatory before even self-declared checking',()=>{
  const saved=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{blocked(assess(encode(fixture())),
    'SHADOW_ANCHOR_SYNTHETIC_SWITCH_REQUIRED');}
  finally{if(saved!==undefined)
    process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=saved;}
});
test('self-matching SHA chain is never authenticated external proof',()=>withSwitch(()=>{
  const r=assess(encode(fixture()));
  blocked(r,'SHADOW_ANCHOR_INTERNALLY_CONSISTENT_UNWITNESSED');
  assert.equal(r.simulatedEntryCount,4);
  assert.equal(r.simulatedChainInternallyConsistent,true);
  assert.equal(r.simulatedRootMatchesSelfDeclaredCheckpoint,true);
  assert.equal(r.simulatedIndependentExternalCheckpointFound,false);
  assert.equal(r.simulatedNativeReviewerApprovalFound,false);
}));
test('editing an event without rebuilding hashes is detected',()=>withSwitch(()=>{
  const s=fixture();s.entries[2].occurred_utc='2026-10-20T15:02:01Z';
  blocked(assess(encode(s)),'SHADOW_ANCHOR_ENTRY_DIGEST_MISMATCH');
}));
test('missing or swapped previous hash is detected',()=>withSwitch(()=>{
  const s=fixture();s.entries[1].previous_hash='f'.repeat(64);
  blocked(assess(encode(s)),'SHADOW_ANCHOR_PREVIOUS_LINK_MISMATCH');
}));
test('tampered final self-checkpoint root is detected',()=>withSwitch(()=>{
  const s=fixture();s.checkpoint.root_hash='f'.repeat(64);
  blocked(assess(encode(s)),
    'SHADOW_ANCHOR_SELF_DECLARED_CHECKPOINT_MISMATCH');
}));
test('fully forged/rehashed chain still appears internally consistent only',()=>withSwitch(()=>{
  const s=fixture();s.entries[2].evidence_digest_sha256='d'.repeat(64);
  rehash(s);
  const r=assess(encode(s));
  blocked(r,'SHADOW_ANCHOR_INTERNALLY_CONSISTENT_UNWITNESSED');
  assert.equal(r.externalWitnessAuthenticated,false);
}));
test('dropped final event with entirely new root cannot be authenticated',()=>withSwitch(()=>{
  const s=fixture();s.entries.pop();rehash(s);
  const r=assess(encode(s));
  blocked(r,'SHADOW_ANCHOR_INTERNALLY_CONSISTENT_UNWITNESSED');
  assert.equal(r.simulatedEntryCount,3);
}));
test('claimed provider-signed witness or durable storage proof is rejected',()=>withSwitch(()=>{
  const edits=[
    s=>{s.checkpoint.witness='signed-by-provider';},
    s=>{s.checkpoint.kind='production';},
    s=>{s.checkpoint.externalProofAuthenticated=true;},
    s=>{s.checkpoint.durableStoreVerified=true;},
    s=>{s.checkpoint.signature='untrusted';},
    s=>{s.approved=true;},
  ];
  for(const edit of edits){
    const s=fixture();edit(s);
    const r=assess(encode(s));blocked(r);
    assert.match(r.reason,/EXTERNAL_AUTHORITY_FORGED|FIXTURE_UNTRUSTED/);
  }
}));
test('invalid event schema, secret field or improper entry digest denied',()=>withSwitch(()=>{
  const a=fixture();a.entries[1].headers={Authorization:'secret'};
  blocked(assess(encode(a)),'SHADOW_ANCHOR_ENTRY_UNTRUSTED');
  const b=fixture();b.entries[1].entry_hash='g'.repeat(64);
  blocked(assess(encode(b)),'SHADOW_ANCHOR_ENTRY_UNTRUSTED');
  const c=fixture();c.entries[1].previous_hash=null;
  blocked(assess(encode(c)),'SHADOW_ANCHOR_ENTRY_UNTRUSTED');
}));
test('duplicate IDs, reordered events, invalid UTC and sequence gaps denied',()=>withSwitch(()=>{
  const edits=[
    s=>{s.entries[2].event_id='event:triaged';},
    s=>{s.entries[2].sequence=7;},
    s=>{s.entries[2].occurred_utc='2026-02-30T15:02:00Z';},
    s=>{s.entries[0].type='evidence_noted';},
    s=>{s.entries[1].type='manual_review_requested';},
  ];
  for(const edit of edits){
    const s=fixture();edit(s);rehash(s);
    blocked(assess(encode(s)),'SHADOW_ANCHOR_EVENT_HISTORY_UNTRUSTED');
  }
}));
test('altering HEAD, role or request identity without recomputing is detected',()=>withSwitch(()=>{
  const changes=[
    s=>{s.incident.head_sha='e'.repeat(40);},
    s=>{s.incident.key_role='development';},
    s=>{s.incident.request_digest_sha256='e'.repeat(64);},
  ];
  for(const change of changes){
    const s=fixture();change(s);
    blocked(assess(encode(s)),'SHADOW_ANCHOR_ENTRY_DIGEST_MISMATCH');
  }
}));
test('malformed oversized input, bad HEAD and unexpected actor fields denied',()=>withSwitch(()=>{
  const examples=[
    null,{},'broken-json',' '.repeat(16385),
    encode({...fixture(),readRealProvider:true}),
    encode({...fixture(),incident:{...fixture().incident,
      actor:'reviewer-b-bot'}}),
    encode({...fixture(),entries:[]}),
    encode({...fixture(),checkpoint:null}),
    encode({...fixture(),incident:{...fixture().incident,
      head_sha:'wrong-sha'}}),
  ];
  for(const x of examples)
    blocked(assess(x),'SHADOW_ANCHOR_FIXTURE_UNTRUSTED');
}));
test('paid Publisher and real gate cannot import chain mock verifier',()=>{
  const paid=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  const module=readFileSync(new URL(
    '../scripts/openrouter-shadow-audit-anchor-offline.mjs',
    import.meta.url),'utf8');
  for(const content of [paid,gate])
    assert.doesNotMatch(content,/openrouter-shadow-audit-anchor-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(module,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});

const witnessFixture=()=>{
  const audit=fixture();
  return {
    schema:'devfactory.shadow-witness-incident.synthetic.v1',
    scope:'illustrative-only',transport:'no-network',audit,
    witness:{id:'mock-external-witness',source:'unverified-fixture',
      availability:'available'},
    prior:{sequence:2,root_hash:audit.entries[1].entry_hash,
      key_epoch:1,key_id:'witness-key-a',key_status:'active'},
    candidate:{sequence:4,root_hash:audit.entries[3].entry_hash,
      key_epoch:1,key_id:'witness-key-a',key_status:'active'},
    review:{externalSignatureAuthenticated:false,
      witnessIndependentVerified:false,operatorApproved:false,
      holdReleaseApproved:false},
  };
};
const witnessBlocked=(r,reason,kind)=>{
  blocked(r,reason);
  for(const field of ['independentWitnessReachableVerified',
    'trustedWitnessKeyEpochVerified','checkpointSignatureVerified',
    'checkpointTimestampVerified','realIncidentEscalated',
    'automaticReplayScheduled'])
    assert.equal(r[field],false,field);
  assert.equal(r.simulatedHumanInvestigationRequired,true);
  if(kind)assert.equal(r.mockWitnessIncidentClass,kind);
};
test('witness drill cannot run without shadow-only test switch',()=>{
  const previous=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{witnessBlocked(witness(encode(witnessFixture())),
    'SHADOW_WITNESS_SYNTHETIC_SWITCH_REQUIRED','invalid');}
  finally{
    if(previous!==undefined)
      process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=previous;
  }
});
test('two internally matching witness fixtures grant zero trust',()=>withSwitch(()=>{
  witnessBlocked(witness(encode(witnessFixture())),
    'SHADOW_WITNESS_MATCHING_FIXTURES_NOT_AUTHENTIC','unverified');
}));
test('witness outage requires independent manual investigation',()=>withSwitch(()=>{
  const s=witnessFixture();s.witness.availability='unavailable';
  s.candidate=null;
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_OUTAGE_MANUAL_ESCALATION','outage');
}));
test('timeout never schedules replay, automatic GET or paid retries',()=>withSwitch(()=>{
  const s=witnessFixture();s.witness.availability='timeout';
  s.candidate=null;
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_TIMEOUT_NO_AUTO_RETRY','outage');
}));
test('unavailable witness carrying a fake candidate is contradictory',()=>withSwitch(()=>{
  const s=witnessFixture();s.witness.availability='timeout';
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_AVAILABILITY_CONTRADICTORY','invalid');
}));
test('fake earlier checkpoint root conflicting with local chain detects fork',()=>withSwitch(()=>{
  const s=witnessFixture();s.prior.root_hash='f'.repeat(64);
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_PRIOR_FORK_SUSPECTED','fork');
}));
test('same-height different checkpoint root is treated as fork',()=>withSwitch(()=>{
  const s=witnessFixture();s.candidate.root_hash='e'.repeat(64);
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_DIVERGENT_ROOT_FORK','fork');
}));
test('candidate lower than prior height is a replay',()=>withSwitch(()=>{
  const s=witnessFixture();s.candidate.sequence=1;
  s.candidate.root_hash=s.audit.entries[0].entry_hash;
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_CHECKPOINT_REPLAY','replay');
}));
test('candidate beyond journal length is not externally authenticated',()=>withSwitch(()=>{
  const s=witnessFixture();s.candidate.sequence=5;
  s.candidate.root_hash='f'.repeat(64);
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_FUTURE_CHECKPOINT_UNBOUND','provenance');
}));
test('stale witness acknowledgment cannot certify final head',()=>withSwitch(()=>{
  const s=witnessFixture();s.candidate.sequence=3;
  s.candidate.root_hash=s.audit.entries[2].entry_hash;
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_STALE_CHECKPOINT','stale');
}));
test('revoked previous signer is untrusted even if current matches',()=>withSwitch(()=>{
  const s=witnessFixture();s.prior.key_status='revoked';
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_REVOKED_PRIOR_KEY','rotation');
}));
test('revoked current signer cannot attest this incident',()=>withSwitch(()=>{
  const s=witnessFixture();s.candidate.key_status='revoked';
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_REVOKED_CURRENT_KEY','rotation');
}));
test('unverified rotation to new key and epoch remains blocked',()=>withSwitch(()=>{
  const s=witnessFixture();s.candidate.key_epoch=2;
  s.candidate.key_id='witness-key-b';
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_ROTATION_UNAUTHENTICATED','rotation');
}));
test('silent replacement of signer without epoch advancement denied',()=>withSwitch(()=>{
  const s=witnessFixture();s.candidate.key_id='witness-key-b';
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_UNEXPLAINED_KEY_CHANGE','rotation');
}));
test('rollback to earlier signer epoch is not accepted',()=>withSwitch(()=>{
  const s=witnessFixture();s.prior.key_epoch=2;
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_KEY_EPOCH_REGRESSION','replay');
}));
test('fully rewritten and rehashed audit with matching fake witness stays BLOCKED',()=>withSwitch(()=>{
  const s=witnessFixture();
  s.audit.entries[2].evidence_digest_sha256='d'.repeat(64);
  rehash(s.audit);
  s.prior.root_hash=s.audit.entries[1].entry_hash;
  s.candidate.root_hash=s.audit.entries[3].entry_hash;
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_MATCHING_FIXTURES_NOT_AUTHENTIC','unverified');
}));
test('forged signature, human approval and release fields rejected',()=>withSwitch(()=>{
  for(const field of Object.keys(witnessFixture().review)){
    const s=witnessFixture();s.review[field]=true;
    witnessBlocked(witness(encode(s)),
      'SHADOW_WITNESS_FORGED_REVIEW_AUTHORITY','security');
  }
}));
test('invalid mock root, claims, token, body or dynamic network fields refused',()=>withSwitch(()=>{
  for(const change of [
    s=>{s.scope='signed-production';},
    s=>{s.witness.source='provider-authenticated';},
    s=>{s.witness.api_key='SECRET';},
    s=>{s.witness.url='https://other.invalid';},
    s=>{s.transport='network';},
    s=>{s.prior.key_epoch='1';},
    s=>{s.candidate.root_hash='bad-root';},
    s=>{s.candidate.headers={Authorization:'Bearer SECRET'};},
    s=>{s.candidate.key_id='../../bad';},
    s=>{s.checkpointSigned=true;},
  ]){
    const s=witnessFixture();change(s);
    const r=witness(encode(s));witnessBlocked(r);
    assert.match(r.reason,/FIXTURE_UNTRUSTED|CANDIDATE_UNTRUSTED/);
  }
}));
test('corrupted underlying mock SHA chain cannot be certified by witness',()=>withSwitch(()=>{
  const s=witnessFixture();s.audit.entries[2].event_id='altered-event';
  witnessBlocked(witness(encode(s)),
    'SHADOW_WITNESS_AUDIT_CHAIN_UNTRUSTED','provenance');
}));
test('paid Publisher and spend gate cannot import mock witness incident',()=>{
  const paid=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  const script=readFileSync(new URL(
    '../scripts/openrouter-shadow-audit-anchor-offline.mjs',
    import.meta.url),'utf8');
  for(const content of [paid,gate])
    assert.doesNotMatch(content,/assessSyntheticWitnessIncidentOffline|openrouter-shadow-audit-anchor-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(script,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});
