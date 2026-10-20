import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {assessSyntheticWitnessRosterOffline as assess}
  from '../scripts/openrouter-shadow-witness-roster-offline.mjs';

const hash=(head,roster)=>createHash('sha256').update(JSON.stringify([
  'devfactory.shadow-witness-roster.synthetic.v1',head,roster.epoch,
  roster.members.map(m=>[m.id,m.custodian,m.signer_id,
    m.key_epoch,m.key_status]),
]),'utf8').digest('hex');
const makeMember=(name)=>({id:'fixture:'+name,
  custodian:'fixture:custody_'+name,signer_id:'fixture:key_'+name,
  key_epoch:1,key_status:'active'});
const example=()=>{
  const head_sha='a'.repeat(40);
  const members=['alpha','beta','gamma'].map(makeMember);
  const previous={epoch:2,members:structuredClone(members)};
  const current={epoch:3,members:structuredClone(members)};
  const prior=hash(head_sha,previous),latest=hash(head_sha,current);
  return {
    schema:'devfactory.shadow-witness-roster.synthetic.v1',
    scope:'illustrative-only',transport:'no-network',head_sha,
    previous,current,
    declaredReplicas:['fixture:replica_a','fixture:replica_b','fixture:replica_c'],
    replicas:['a','b','c'].map(id=>({
      id:'fixture:replica_'+id,claimedCustodian:'fixture:replica_owner_'+id,
      availability:'available',epoch:3,digest_sha256:latest,
    })),
    review:{rosterAuthorityAuthenticated:false,
      replicaIdentityAuthenticated:false,independentCustodyVerified:false,
      signerRotationApproved:false,
      revocationReceiptAuthenticated:false,humanGoGranted:false,
      holdReleaseApproved:false},
    // Tests use prior as a closure fixture rather than adding a schema field.
  };
};
const setReplicas=(s,epoch)=>{
  const roster=epoch===s.previous.epoch?s.previous:s.current;
  for(const r of s.replicas){
    r.epoch=epoch;r.digest_sha256=hash(s.head_sha,roster);
  }
  return s;
};
const stringify=x=>JSON.stringify(x);
const on=fn=>{
  const saved=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
  try{return fn()}finally{
    if(saved===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
    else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=saved;
  }
};
const denial=(r,reason,kind)=>{
  assert.equal(r.status,'BLOCKED');assert.equal(r.syntheticOnly,true);
  assert.equal(r.verified,false);assert.equal(Object.isFrozen(r),true);
  for(const flag of ['rosterAuthorityAuthenticated',
    'replicaIdentityAuthenticated','independentCustodyVerified',
    'externalSignaturesAuthenticated','signerRotationApproved',
    'revocationReceiptAuthenticated','providerEvidenceAuthenticated',
    'independentReviewerApproved','mayReadProviderData','maySpend',
    'mayReserve','mayRetryAmbiguousRequest','mayReleaseHold','mayDeploy',
    'mayStartRunner','mayCloseIncident','automaticRetryScheduled'])
    assert.equal(r[flag],false,flag);
  if(reason)assert.equal(r.reason,reason);
  if(kind)assert.equal(r.simulatedIssueClass,kind);
};

test('explicit synthetic-only switch mandatory',()=>{
  const saved=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{denial(assess(stringify(example())),
    'SHADOW_ROSTER_SYNTHETIC_SWITCH_REQUIRED','invalid');}
  finally{if(saved!==undefined)
    process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=saved;}
});
test('three fake replica digests agreeing is not authority',()=>on(()=>{
  const s=example(),r=assess(stringify(s));
  denial(r,'SHADOW_ROSTER_MATCHING_FIXTURES_NOT_TRUSTED','unverified');
  assert.equal(r.simulatedDeclaredMemberCount,3);
  assert.equal(r.simulatedDeclaredReplicaCount,3);
  assert.equal(r.simulatedCurrentEpoch,3);
}));
test('fully propagated mock revocation never authenticates receipt',()=>on(()=>{
  const s=example();s.current.members[1].key_status='revoked';
  setReplicas(s,3);
  const r=assess(stringify(s));
  denial(r,'SHADOW_ROSTER_MATCHING_FIXTURES_NOT_TRUSTED','unverified');
  assert.equal(r.simulatedRevocationsWithoutProvenance,1);
}));
test('stale replica after mock revocation remains unresolved',()=>on(()=>{
  const s=example();s.current.members[1].key_status='revoked';
  setReplicas(s,3);
  s.replicas[2].epoch=2;
  s.replicas[2].digest_sha256=hash(s.head_sha,s.previous);
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_REVOCATION_PROPAGATION_DELAY','revocation');
}));
test('stale replica without revocation cannot assert current roster',()=>on(()=>{
  const s=example();s.replicas[2].epoch=2;
  s.replicas[2].digest_sha256=hash(s.head_sha,s.previous);
  denial(assess(stringify(s)),'SHADOW_ROSTER_PROPAGATION_DELAY','stale');
}));
test('declared offline replica means witness roster incomplete',()=>on(()=>{
  const s=example();s.replicas[2].availability='offline';
  s.replicas[2].epoch=null;s.replicas[2].digest_sha256=null;
  denial(assess(stringify(s)),'SHADOW_ROSTER_UNAVAILABLE_REPLICA','outage');
}));
test('timeout retaining an invented digest is contradictory',()=>on(()=>{
  const s=example();s.replicas[2].availability='timeout';
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_OUTAGE_REPORT_CONTRADICTORY','invalid');
}));
test('silently omitted replica fails coverage',()=>on(()=>{
  const s=example();s.replicas.pop();
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_REPLICA_NOT_REPORTED','coverage');
}));
test('unknown and duplicate replica IDs are rejected',()=>on(()=>{
  const variants=[
    s=>{s.replicas[1].id=s.replicas[0].id;},
    s=>{s.replicas[1].id='fixture:unknown';},
  ];
  for(const v of variants){const s=example();v(s);
    denial(assess(stringify(s)),'SHADOW_ROSTER_REPLICA_UNTRUSTED','invalid');}
}));
test('duplicate declared member of replica inventory is refused',()=>on(()=>{
  const s=example();s.declaredReplicas[1]=s.declaredReplicas[0];
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_REPLICA_INVENTORY_INVALID','invalid');
}));
test('two replica claims with same custodian are not independent',()=>on(()=>{
  const s=example();s.replicas[1].claimedCustodian=
    s.replicas[0].claimedCustodian;
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_REPLICA_CUSTODY_COLLISION','custody');
}));
test('two roster members sharing custody are refused',()=>on(()=>{
  const s=example();s.current.members[1].custodian=
    s.current.members[0].custodian;
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_CUSTODY_COLLISION','custody');
}));
test('two roster members sharing signer ID are refused',()=>on(()=>{
  const s=example();s.current.members[1].signer_id=
    s.current.members[0].signer_id;
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_SIGNER_COLLISION','custody');
}));
test('contradictory digest at same epoch is mock equivocation',()=>on(()=>{
  const s=example();s.replicas[1].digest_sha256='f'.repeat(64);
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_SAME_EPOCH_EQUIVOCATION','fork');
}));
test('replayed old epoch and fictitious future epoch fail closed',()=>on(()=>{
  const s=example();s.replicas[1].epoch=1;
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_REPLICA_EPOCH_ROLLBACK','replay');
  const x=example();x.replicas[1].epoch=4;
  denial(assess(stringify(x)),
    'SHADOW_ROSTER_REPLICA_FUTURE_EPOCH_UNBOUND','replay');
}));
test('revoked member cannot be silently reactivated',()=>on(()=>{
  const s=example();s.previous.members[1].key_status='revoked';
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_REVOCATION_ROLLBACK','rotation');
}));
test('signer replacement with unchanged key epoch is forbidden',()=>on(()=>{
  const s=example();s.current.members[1].signer_id='fixture:key_new';
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_SILENT_SIGNER_SUBSTITUTION','rotation');
}));
test('new signer with incremented epoch is still unauthenticated rotation',()=>on(()=>{
  const s=example();s.current.members[1].signer_id='fixture:key_new';
  s.current.members[1].key_epoch=2;
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_ROTATION_NOT_AUTHENTICATED','rotation');
}));
test('key epoch regression and unexplained version increase refused',()=>on(()=>{
  const s=example();s.previous.members[1].key_epoch=2;
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_KEY_EPOCH_ROLLBACK','replay');
  const t=example();t.current.members[1].key_epoch=2;
  denial(assess(stringify(t)),
    'SHADOW_ROSTER_KEY_EPOCH_WITHOUT_ROTATION','rotation');
}));
test('ownership transfer has no trusted authorization',()=>on(()=>{
  const s=example();s.current.members[1].custodian='fixture:new_custodian';
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_CUSTODY_TRANSFER_UNAUTHENTICATED','custody');
}));
test('roster epoch rollback or skipped epochs are blocked',()=>on(()=>{
  for(const epoch of [1,2,4]){
    const s=example();s.current.epoch=epoch;
    denial(assess(stringify(s)),
      'SHADOW_ROSTER_EPOCH_GAP_OR_ROLLBACK','replay');
  }
}));
test('undeclared identity or removed registered member is rejected',()=>on(()=>{
  const s=example();s.current.members[2].id='fixture:outsider';
  denial(assess(stringify(s)),
    'SHADOW_ROSTER_MEMBERSHIP_CHANGE_UNVERIFIED','coverage');
}));
test('forged reviewer, revocation proof, and spend claims cannot pass',()=>on(()=>{
  for(const flag of Object.keys(example().review)){
    const s=example();s.review[flag]=true;
    denial(assess(stringify(s)),
      'SHADOW_ROSTER_FORGED_AUTHORIZATION','security');
  }
}));
test('network, secret, arbitrary actor or payload injection is refused',()=>on(()=>{
  for(const edit of [
    s=>{s.transport='https';},
    s=>{s.authorization='fake-token';},
    s=>{s.replicas[1].headers={Authorization:'Bearer fake'};},
    s=>{s.replicas[1].url='https://another.invalid';},
    s=>{s.current.members[0].email='private@example.invalid';},
    s=>{s.current.members[0].signer_id='../../secret';},
    s=>{s.replicas[0].digest_sha256='garbage';},
    s=>{s.head_sha='X'.repeat(40);},
  ]){
    const s=example();edit(s);
    const r=assess(stringify(s));denial(r);
    assert.match(r.reason,/FIXTURE_UNTRUSTED|REPLICA_(CHECKPOINT_)?UNTRUSTED/);
  }
}));
test('oversize, malformed, unsorted, excess members and invalid shape denied',()=>on(()=>{
  const extra=example();extra.current.members.reverse();
  const many=example();
  for(let i=0;i<5;i++){
    const name='z'+i;
    many.current.members.push(makeMember(name));
  }
  const samples=[null,{},'not json',' '.repeat(16385),
    stringify(extra),stringify(many),stringify({...example(),scope:'real'})];
  for(const v of samples)
    denial(assess(v),'SHADOW_ROSTER_FIXTURE_UNTRUSTED','invalid');
}));
test('offline witness-roster model is not imported into paid paths',()=>{
  const protectedCode=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  const model=readFileSync(new URL(
    '../scripts/openrouter-shadow-witness-roster-offline.mjs',
    import.meta.url),'utf8');
  for(const s of [protectedCode,gate])
    assert.doesNotMatch(s,/openrouter-shadow-witness-roster-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(model,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});
