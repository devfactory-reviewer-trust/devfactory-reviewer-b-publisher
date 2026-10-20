import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalJson} from '../src/canonical.mjs';
import {verifyRotatingShadowClaimOffline}
  from '../scripts/openrouter-shadow-key-rotation-offline.mjs';

const {publicKey:pubA,privateKey:privA}=generateKeyPairSync('ed25519');
const {publicKey:pubB,privateKey:privB}=generateKeyPairSync('ed25519');
const at=text=>Date.parse('2026-10-20T'+text+'Z');
const now=at('10:00:45');
const fingerprint=pub=>createHash('sha256')
  .update(pub.export({type:'spki',format:'der'})).digest('hex');
const makeKey=(pub,extra={})=>({
 issuer:'shadow-test-issuer',
 purpose:'devfactory.shadow-only.v1',
 publicKeyPem:pub.export({type:'spki',format:'pem'}),
 spkiSha256:fingerprint(pub),
 activatedAtMs:at('09:00:00'),retiredAtMs:at('12:00:00'),
 revokedAtMs:null,...extra,
});
const oldKey=makeKey(pubA);
const newKey=makeKey(pubB,{activatedAtMs:at('09:30:00')});
const original={
 schema:'devfactory.reviewer-b.shadow-budget-claim.v1',
 issuer:'shadow-test-issuer',key_purpose:'SHADOW_PROPOSAL_ONLY',
 repository:'deenkids7-dev/deenkids',pr_number:940,
 head_sha:'a'.repeat(40),model:'qwen/qwen3-coder-30b-a3b-instruct',
 service_comment_id:10021,owner_consent_comment_id:11301,
 month_utc:'2026-10',upper_micro_eur:15000000,
 nonce:'11111111-2222-4333-8444-555555555555',
 issued_at:'2026-10-20T10:00:00Z',expires_at:'2026-10-20T10:01:30Z',
};
const ctx=Object.fromEntries(['repository','pr_number','head_sha','model',
 'service_comment_id','owner_consent_comment_id','month_utc']
 .map(x=>[x,original[x]]));
const domain=Buffer.from('DEVFACTORY-SHADOW-BUDGET-CLAIM-V1\0');
function envelope(keyId='old',privateKey=privA,payload=original){
 const p={...payload};
 return {payload:p,signature:{
   algorithm:'Ed25519',key_id:keyId,
   value:sign(null,Buffer.concat([domain,Buffer.from(canonicalJson(p))]),
     privateKey).toString('base64'),
 }};
}
const ring=()=>new Map([['old',{...oldKey}],['new',{...newKey}]]);
const check=(e=envelope(),opts={})=>verifyRotatingShadowClaimOffline({
 envelope:e,keyring:ring(),trustedContext:ctx,seenNonces:new Set(),
 now,...opts,
});
const rejected=(title,fn,reason)=>test(title,()=>{
 assert.throws(fn,error=>error.message===reason);
});
test('two simultaneously valid rotating shadow-only keys verify without spend',()=>{
 for(const [keyId,key] of [['old',privA],['new',privB]]){
   const verdict=check(envelope(keyId,key));
   assert.equal(verdict.cryptographicIntegrityVerified,true);
   assert.equal(verdict.activeKeyPolicyVerified,true);
   assert.equal(verdict.keyRotationChecked,true);
   assert.equal(verdict.keyRevocationChecked,true);
   assert.equal(verdict.signingKeyId,keyId);
   for(const prop of ['maySpend','mayReserve','mayPublish','mayMerge',
      'nonceConsumptionVerified','providerBillingAuthenticated'])
      assert.equal(verdict[prop],false,prop);
   assert.ok(Object.isFrozen(verdict));
 }
});
rejected('reject retired key even with valid old signature',()=>check(envelope(),{
 keyring:new Map([['old',makeKey(pubA,{retiredAtMs:at('10:00:30')})]]),
}),'SHADOW_KEY_NOT_ACTIVE_OR_REVOKED');
rejected('reject future activation for already-issued proof',()=>check(envelope(),{
 keyring:new Map([['old',makeKey(pubA,{activatedAtMs:at('10:00:20')})]]),
}),'SHADOW_KEY_NOT_ACTIVE_OR_REVOKED');
rejected('reject claim expiry beyond key retirement',()=>check(envelope(),{
 keyring:new Map([['old',makeKey(pubA,{retiredAtMs:at('10:01:00')})]]),
}),'SHADOW_KEY_NOT_ACTIVE_OR_REVOKED');
rejected('revoke immediately even when original signature predates revocation',()=>check(envelope(),{
 keyring:new Map([['old',makeKey(pubA,{revokedAtMs:at('10:00:30')})]]),
}),'SHADOW_KEY_NOT_ACTIVE_OR_REVOKED');
test('revocation scheduled in future preserves only pre-revocation checks',()=>{
 const r=check(envelope(),{keyring:new Map([['old',makeKey(pubA,{
   revokedAtMs:at('10:01:00')})]])});
 assert.equal(r.maySpend,false);
});
rejected('key-id substitution fails despite new key being active',()=>check(
 envelope('new',privA)),'SHADOW_SIGNATURE_INVALID');
rejected('missing signer in separately provisioned keyring fails',()=>check(
 envelope(),{keyring:new Map([['new',newKey]])}),
 'SHADOW_KEY_NOT_IN_TRUSTED_RING');
rejected('fingerprint alias across two key IDs is prohibited',()=>check(
 envelope(),{keyring:new Map([['old',{...oldKey}],
   ['alias',{...oldKey}]])}),
 'SHADOW_KEY_FINGERPRINT_ALIAS_FORBIDDEN');
rejected('renamed signature purpose cannot authorize payment',()=>check(
 envelope(),{keyring:new Map([['old',{...oldKey,
  purpose:'official-reviewer-b-approval'}]])}),
 'SHADOW_KEY_POLICY_INVALID');
rejected('untrusted fingerprint is rejected by pinned key verification',()=>check(
 envelope(),{keyring:new Map([['old',{...oldKey,
  spkiSha256:'f'.repeat(64)}]])}),
 'SHADOW_UNPINNED_SIGNING_KEY');
rejected('signature verifies only against independently checked GitHub HEAD',()=>
 check(envelope(),{trustedContext:{...ctx,head_sha:'b'.repeat(40)}}),
 'SHADOW_INDEPENDENT_GITHUB_CONTEXT_MISMATCH');
rejected('nonce replay snapshot denies even valid active key',()=>check(
 envelope(),{seenNonces:new Set([original.nonce])}),
 'SHADOW_NONCE_ALREADY_SEEN');
rejected('keyring must be an independently provisioned Map, not JSON envelope',()=>
 check(envelope(),{keyring:{old:oldKey}}),'SHADOW_KEYRING_NOT_PROVISIONED');
rejected('private signing key property in public keyring fails closed',()=>
 check(envelope(),{keyring:new Map([['old',{
  ...oldKey,privateKeyPem:'FORBIDDEN'}]])}),
 'SHADOW_KEY_POLICY_FIELDS_UNTRUSTED');
rejected('getter in public keyring fails closed without executing it',()=>{
 const malicious={...oldKey};
 Object.defineProperty(malicious,'publicKeyPem',{enumerable:true,
   get(){throw Error('GETTER_WAS_EXECUTED')}});
 check(envelope(),{keyring:new Map([['old',malicious]])});
},'SHADOW_KEY_POLICY_ACCESSOR_FORBIDDEN');
rejected('untrusted signature key_id getter is rejected before policy lookup',()=>{
 const data=envelope();
 Object.defineProperty(data.signature,'key_id',{enumerable:true,
   get(){throw Error('GETTER_WAS_EXECUTED')}});
 check(data);
},'SHADOW_KEY_POLICY_ACCESSOR_FORBIDDEN');
rejected('reject overly large keyring even if requested key is valid',()=>check(
 envelope(),{keyring:new Map([['old',oldKey],['new',newKey],
 ['third',{...makeKey(generateKeyPairSync('ed25519').publicKey)}],
 ['fourth',{...makeKey(generateKeyPairSync('ed25519').publicKey)}],
 ['fifth',{...makeKey(generateKeyPairSync('ed25519').publicKey)}]])}),
 'SHADOW_KEYRING_NOT_PROVISIONED');
rejected('invalid time ranges fail even for valid signature',()=>check(
 envelope(),{keyring:new Map([['old',{...oldKey,
   activatedAtMs:at('11:00:00'),retiredAtMs:at('10:00:00')}]])}),
 'SHADOW_KEY_POLICY_INVALID');
rejected('invalid caller clock fails closed',()=>check(envelope(),{
 now:Number.MAX_SAFE_INTEGER,
}),'SHADOW_KEY_CLOCK_INVALID');
test('paid protected runtime imports neither the rotation module nor private signing keys',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const path of [
  '../scripts/protected-real-openrouter-review.mjs',
  '../scripts/openrouter-only-spend-gate.mjs',
 ]){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  assert.doesNotMatch(source,/openrouter-shadow-key-rotation-offline/);
 }
 const spend=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',
  import.meta.url),'utf8');
 assert.match(spend,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
});

rejected('signed timestamp object cannot execute Symbol.toPrimitive',()=>{
 const claim=envelope();
 let called=false;
 claim.payload.issued_at={
   [Symbol.toPrimitive](){called=true;throw Error('MALICIOUS_COERCION')}
 };
 try{check(claim)}finally{assert.equal(called,false)}
},'SHADOW_KEY_SIGNED_TIMES_INVALID');
rejected('reject implausible revocation scheduled after retirement',()=>{
 check(envelope(),{keyring:new Map([['old',{
   ...oldKey,revokedAtMs:at('13:00:00')
 }]])});
},'SHADOW_KEY_POLICY_INVALID');
