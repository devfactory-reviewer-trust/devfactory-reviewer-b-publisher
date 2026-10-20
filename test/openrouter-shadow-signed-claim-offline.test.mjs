import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createHash,generateKeyPairSync,randomUUID,sign,
} from 'node:crypto';
import {canonicalJson} from '../src/canonical.mjs';
import {verifyOfflineShadowClaim}
  from '../scripts/openrouter-shadow-signed-claim-offline.mjs';

const DOMAIN=Buffer.from('DEVFACTORY-SHADOW-BUDGET-CLAIM-V1\0');
const A=generateKeyPairSync('ed25519');
const B=generateKeyPairSync('ed25519');
const NOW=Date.parse('2026-10-20T10:00:45Z');
const head='a'.repeat(40);
const model='qwen/qwen3-coder-30b-a3b-instruct';
const target={
  repository:'deenkids7-dev/deenkids',
  pr_number:940,head_sha:head,model,
  service_comment_id:131313,
  owner_consent_comment_id:991919,
  month_utc:'2026-10',
};
const p0={
  schema:'devfactory.reviewer-b.shadow-budget-claim.v1',
  issuer:'synthetic-shadow-github-verifier',
  key_purpose:'SHADOW_PROPOSAL_ONLY',
  ...target,upper_micro_eur:15000000,
  nonce:'11111111-2222-4333-8444-555555555555',
  issued_at:'2026-10-20T10:00:00Z',
  expires_at:'2026-10-20T10:01:30Z',
};
const fingerprint=key=>createHash('sha256')
  .update(key.export({type:'spki',format:'der'})).digest('hex');
const keyRecord={
 publicKeyPem:A.publicKey.export({type:'spki',format:'pem'}),
 spkiSha256:fingerprint(A.publicKey),
 issuer:p0.issuer,purpose:'devfactory.shadow-only.v1',
};
const trustedKeys=new Map([['TEST_SHADOW_SIGNER_ONLY',keyRecord]]);
function signed(payload=p0,privateKey=A.privateKey){
 const ownPayload={...payload};
 const data=Buffer.concat([DOMAIN,Buffer.from(canonicalJson(ownPayload),'utf8')]);
 return {payload:ownPayload,signature:{
  algorithm:'Ed25519',key_id:'TEST_SHADOW_SIGNER_ONLY',
  value:sign(null,data,privateKey).toString('base64'),
 }};
}
const verify=(envelope=signed(),patch={})=>verifyOfflineShadowClaim({
 envelope,now:NOW,trustedContext:target,trustedKeys,seenNonces:new Set(),
 ...patch,
});
const deny=(name,fn,reason)=>test(name,()=>{
 assert.throws(fn,e=>e.message===reason);
});
test('synthetic Ed25519 signature is valid but NEVER grants spending/merge',()=>{
 const r=verify();
 assert.equal(r.cryptographicIntegrityVerified,true);
 assert.equal(r.boundToIndependentContext,true);
 for(const key of ['mayReserve','maySpend','mayPublish','mayMerge',
   'providerBillingAuthenticated','ownerApprovalForPayment',
   'nonceConsumptionVerified'])
   assert.equal(r[key],false,key);
 assert.equal(Object.isFrozen(r),true);
});
deny('wrong independently sourced exact SHA even with valid signature',()=>{
 verify(signed(),{trustedContext:{...target,head_sha:'b'.repeat(40)}});
},'SHADOW_INDEPENDENT_GITHUB_CONTEXT_MISMATCH');
deny('different PR even with valid signature',()=>verify(signed(),{
 trustedContext:{...target,pr_number:941},
}),'SHADOW_INDEPENDENT_GITHUB_CONTEXT_MISMATCH');
deny('different service comment even with valid signature',()=>verify(signed(),{
 trustedContext:{...target,service_comment_id:313131},
}),'SHADOW_INDEPENDENT_GITHUB_CONTEXT_MISMATCH');
deny('different consent comment even with valid signature',()=>verify(signed(),{
 trustedContext:{...target,owner_consent_comment_id:919191},
}),'SHADOW_INDEPENDENT_GITHUB_CONTEXT_MISMATCH');
deny('tampered claim cost cannot change budget',()=>verify(signed({
 ...p0,upper_micro_eur:1,
})),'SHADOW_CLAIM_SCOPE_INVALID');
deny('signed amount 15 EUR cannot be changed without breaking Ed25519',()=>verify({
 ...signed(),payload:{...p0,upper_micro_eur:14999999},
}),'SHADOW_CLAIM_SCOPE_INVALID');
deny('signed model substitution without new independent evidence fails',()=>verify(signed({
 ...p0,model:'qwen/qwen3.6-35b-a3b',
})),'SHADOW_INDEPENDENT_GITHUB_CONTEXT_MISMATCH');
deny('second signing key with same claimed key_id rejected',()=>verify(
 signed(p0,B.privateKey)),'SHADOW_SIGNATURE_INVALID');
deny('changed nonce replay is rejected by independent replay snapshot',()=>verify(
 signed(),{seenNonces:new Set([p0.nonce])}),
 'SHADOW_NONCE_ALREADY_SEEN');
deny('non-pinned public signer is rejected',()=>verify(signed(),{
 trustedKeys:new Map([['TEST_SHADOW_SIGNER_ONLY',{
  ...keyRecord,spkiSha256:'f'.repeat(64)}]]),
}),'SHADOW_UNPINNED_SIGNING_KEY');
deny('untrusted signer identity is rejected',()=>verify(signed(),{
 trustedKeys:new Map([['TEST_SHADOW_SIGNER_ONLY',{
  ...keyRecord,issuer:'attacker'}]]),
}),'SHADOW_UNTRUSTED_SIGNER');
deny('official reviewer attestation purpose is not substitutable',()=>verify(
 signed(),{trustedKeys:new Map([['TEST_SHADOW_SIGNER_ONLY',{
 ...keyRecord,purpose:'reviewer-code-approval'}]])}),
 'SHADOW_UNTRUSTED_SIGNER');
deny('expired claim refuses old signature',()=>verify(signed(),{
 now:Date.parse('2026-10-20T10:01:31Z'),
}),'SHADOW_CLAIM_EXPIRED_OR_MONTH_MISMATCH');
deny('future claim refuses issuance time',()=>verify(signed(),{
 now:Date.parse('2026-10-20T09:58:20Z'),
}),'SHADOW_CLAIM_EXPIRED_OR_MONTH_MISMATCH');
deny('signed claim from wrong UTC month refuses',()=>verify(signed(),{
 now:Date.parse('2026-11-01T00:00:05Z'),
}),'SHADOW_CLAIM_EXPIRED_OR_MONTH_MISMATCH');
deny('bad UTF8/canonical signature encoding rejected',()=>verify({
 ...signed(),signature:{...signed().signature,value:'a'.repeat(88)},
}),'SHADOW_SIGNATURE_ENCODING_INVALID');
deny('unknown payload fields cannot create permission',()=>verify(
 signed({...p0,maySpend:true})),'SHADOW_PAYLOAD_FIELDS_INVALID');
deny('missing external authenticated keyring is refused',()=>verify(signed(),{
 trustedKeys:new Map(),
}),'SHADOW_INDEPENDENT_TRUST_NOT_AVAILABLE');
deny('missing durable replay snapshot is refused',()=>verify(signed(),{
 seenNonces:undefined,
}),'SHADOW_INDEPENDENT_TRUST_NOT_AVAILABLE');
test('signatures bound to shadow domain cannot act as standard reviewer attestations',()=>{
 const foreign=Buffer.from(canonicalJson(p0),'utf8');
 const signature=sign(null,foreign,A.privateKey).toString('base64');
 const env=signed();env.signature.value=signature;
 assert.throws(()=>verify(env),/SHADOW_SIGNATURE_INVALID/);
});

test('paid protected Reviewer B scripts do not import signed shadow module',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const file of [
  '../scripts/protected-real-openrouter-review.mjs',
  '../scripts/openrouter-only-spend-gate.mjs',
 ]){
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/openrouter-shadow-signed-claim-offline/);
 }
});

test('accessor signature cannot mutate HEAD between context and Ed25519 verification',()=>{
 const env=signed();
 const forged=signed({...p0,head_sha:'b'.repeat(40)});
 Object.defineProperty(env.signature,'value',{
  enumerable:true,configurable:true,
  get(){env.payload.head_sha='b'.repeat(40);return forged.signature.value},
 });
 assert.throws(()=>verify(env),e=>e.message==='SHADOW_SIGNATURE_FIELDS_INVALID');
 assert.equal(env.payload.head_sha,head);
});
test('payload getter is rejected before any context or crypto comparison',()=>{
 const env=signed();
 Object.defineProperty(env.payload,'head_sha',{
  enumerable:true,configurable:true,
  get(){return head},
 });
 assert.throws(()=>verify(env),e=>e.message==='SHADOW_PAYLOAD_FIELDS_INVALID');
});
test('signed byte snapshot is stable if a trusted Map callback mutates original payload',()=>{
 const env=signed();
 const ring=new Map(trustedKeys);
 const normal=ring.get.bind(ring);
 ring.get=(key)=>{
  env.payload.head_sha='b'.repeat(40);
  return normal(key);
 };
 const r=verify(env,{trustedKeys:ring});
 assert.equal(r.cryptographicIntegrityVerified,true);
 assert.equal(r.maySpend,false);
 assert.equal(env.payload.head_sha,'b'.repeat(40));
});
deny('unsupported out-of-range local clock is denied with explicit reason',()=>{
 verify(signed(),{now:Number.MAX_SAFE_INTEGER});
},'SHADOW_CLOCK_UNVERIFIED');
