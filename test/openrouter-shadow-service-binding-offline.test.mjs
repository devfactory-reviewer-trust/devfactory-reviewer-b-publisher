import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalJson} from '../src/canonical.mjs';
import {verifyShadowServiceBindingOffline}
  from '../scripts/openrouter-shadow-service-binding-offline.mjs';

const pairA=generateKeyPairSync('ed25519');
const pairS=generateKeyPairSync('ed25519');
const extra=generateKeyPairSync('ed25519');
const ms=s=>Date.parse('2026-10-20T'+s+'Z');
const NOW=ms('10:00:45');
const issuer='synthetic-service-account';
const audience='shadow-postgres-processor';
const challenge='22222222-3333-4333-8444-555555555555';
const fp=pub=>createHash('sha256')
 .update(pub.export({type:'spki',format:'der'})).digest('hex');
const rec=(pair,purpose,iss='synthetic-shadow-issuer')=>({
  issuer:iss,purpose,spkiSha256:fp(pair.publicKey),
  publicKeyPem:pair.publicKey.export({type:'spki',format:'pem'}),
  activatedAtMs:ms('09:00:00'),retiredAtMs:ms('12:00:00'),
  revokedAtMs:null,
});
const shadowKeys=()=>new Map([['shadow-key',rec(pairA,
 'devfactory.shadow-only.v1')]]);
const serviceKeys=()=>new Map([['svc-key',rec(pairS,
 'devfactory.shadow-service-identity-only.v1',issuer)]]);
const shadowPayload={
 schema:'devfactory.reviewer-b.shadow-budget-claim.v1',
 issuer:'synthetic-shadow-issuer',key_purpose:'SHADOW_PROPOSAL_ONLY',
 repository:'deenkids7-dev/deenkids',pr_number:940,
 head_sha:'a'.repeat(40),model:'qwen/qwen3-coder-30b-a3b-instruct',
 service_comment_id:9222,owner_consent_comment_id:9333,
 month_utc:'2026-10',upper_micro_eur:15000000,
 nonce:'11111111-2222-4333-8444-555555555555',
 issued_at:'2026-10-20T10:00:00Z',
 expires_at:'2026-10-20T10:01:30Z',
};
const ctx=Object.fromEntries(['repository','pr_number','head_sha','model',
 'service_comment_id','owner_consent_comment_id','month_utc']
 .map(k=>[k,shadowPayload[k]]));
const shadowDomain=Buffer.from('DEVFACTORY-SHADOW-BUDGET-CLAIM-V1\0');
const serviceDomain=Buffer.from('DEVFACTORY-SHADOW-SERVICE-BINDING-V1\0');
function signed(payload,key,prefix,key_id){
 const p={...payload};
 return {payload:p,signature:{algorithm:'Ed25519',key_id,
  value:sign(null,Buffer.concat([prefix,Buffer.from(canonicalJson(p))]),
   key).toString('base64')}};
}
const shadow=(p=shadowPayload)=>signed(p,pairA.privateKey,
 shadowDomain,'shadow-key');
function service(s,claim=shadow()){
 const payload={
   schema:'devfactory.shadow.service-binding.v1',
   issuer,audience,scope:'SHADOW_SERVICE_TRANSPORT_ONLY',
   shadow_envelope_sha256:createHash('sha256')
     .update(canonicalJson(claim)).digest('hex'),
   challenge,issued_at:'2026-10-20T10:00:20Z',
   expires_at:'2026-10-20T10:01:10Z',...s,
 };
 return signed(payload,pairS.privateKey,serviceDomain,'svc-key');
}
function check(p={}){
 const claim=p.shadowEnvelope||shadow();
 const envelope=p.serviceEnvelope||service({},claim);
 return verifyShadowServiceBindingOffline({
  shadowEnvelope:claim,serviceEnvelope:envelope,
  trustedShadowKeys:shadowKeys(),trustedGitHubContext:ctx,
  seenClaimNonces:new Set(),trustedServiceKeys:serviceKeys(),
  expectedIssuer:issuer,expectedAudience:audience,
  expectedChallenge:challenge,seenChallenges:new Set(),now:NOW,
  ...p,
 });
}
function rejected(title,fn,reason){
 test(title,()=>assert.throws(fn,error=>error.message===reason));
}
test('dual signatures bind one shadow claim to one expected receiver',()=>{
 const v=check();
 assert.equal(v.shadowClaimSignatureVerified,true);
 assert.equal(v.serviceSignatureVerified,true);
 assert.equal(v.intendedAudienceVerified,true);
 assert.equal(v.receiverChallengeMatches,true);
 for(const k of ['maySpend','mayReserve','mayMerge','mayPublish',
  'atomicChallengeConsumptionVerified','providerBillingAuthenticated',
  'protectedServiceAuthenticationDeployed'])
  assert.equal(v[k],false,k);
 assert.ok(Object.isFrozen(v));
});
rejected('service binding cannot be replayed to another receiver',()=>check({
 expectedAudience:'different-receiver',
}),'SHADOW_SERVICE_BINDING_SCOPE_OR_TTL');
rejected('different challenge cannot satisfy receiver-issued nonce',()=>check({
 expectedChallenge:'33333333-4444-4333-8444-555555555555',
}),'SHADOW_SERVICE_BINDING_SCOPE_OR_TTL');
rejected('already seen challenge snapshot denies replay',()=>check({
 seenChallenges:new Set([challenge]),
}),'SHADOW_SERVICE_CHALLENGE_REPLAY');
rejected('invalid service signature fails',()=>{
 const c=shadow(),env=service({},c);
 env.signature.value=sign(null,Buffer.from('evil'),extra.privateKey).toString('base64');
 check({shadowEnvelope:c,serviceEnvelope:env});
},'SHADOW_SERVICE_SIGNATURE_INVALID');
rejected('body signed by wrong service private key cannot spoof key ID',()=>{
 const c=shadow(),env=service({},c);
 env.signature.value=sign(null,Buffer.concat([
   serviceDomain,Buffer.from(canonicalJson(env.payload))]),
   extra.privateKey).toString('base64');
 check({shadowEnvelope:c,serviceEnvelope:env});
},'SHADOW_SERVICE_SIGNATURE_INVALID');
rejected('wrong issuer signed with correct key still fails audience policy',()=>{
 const c=shadow();
 check({shadowEnvelope:c,serviceEnvelope:service({issuer:'evil-issuer'},c)});
},'SHADOW_SERVICE_BINDING_SCOPE_OR_TTL');
rejected('valid service signature cannot bind a tampered shadow claim',()=>{
 const c=shadow(),env=service({},c);
 c.payload.pr_number=941;
 check({shadowEnvelope:c,serviceEnvelope:env});
},'SHADOW_SERVICE_CLAIM_DIGEST_MISMATCH');
rejected('claim bound to wrong GitHub HEAD is never allowed',()=>check({
 trustedGitHubContext:{...ctx,head_sha:'b'.repeat(40)},
}),'SHADOW_INDEPENDENT_GITHUB_CONTEXT_MISMATCH');
rejected('shadow nonce replay snapshot denies even two valid signatures',()=>check({
 seenClaimNonces:new Set([shadowPayload.nonce]),
}),'SHADOW_NONCE_ALREADY_SEEN');
rejected('revoked transport signer cannot use a previously valid signature',()=>check({
 trustedServiceKeys:new Map([['svc-key',{
  ...serviceKeys().get('svc-key'),revokedAtMs:ms('10:00:30')}]]),
}),'SHADOW_SERVICE_SIGNER_REVOKED_OR_RETIRED');
rejected('service key purpose cannot equal ordinary code-review attestation',()=>check({
 trustedServiceKeys:new Map([['svc-key',{
  ...serviceKeys().get('svc-key'),purpose:'reviewer-code-approval'}]]),
}),'SHADOW_SERVICE_KEY_POLICY_UNTRUSTED');
rejected('duplicate SPKI on two service key IDs fails closed',()=>check({
 trustedServiceKeys:new Map([['svc-key',serviceKeys().get('svc-key')],
  ['alias',serviceKeys().get('svc-key')]]),
}),'SHADOW_SERVICE_KEY_ALIAS_UNTRUSTED');
rejected('envelope cannot inject a maySpend field',()=>{
 const c=shadow();
 const env=service({},c);env.payload.maySpend=true;
 check({shadowEnvelope:c,serviceEnvelope:env});
},'SHADOW_SERVICE_FIELDS_INVALID');
rejected('malicious envelope timestamp getter never executes',()=>{
 const c=shadow();const env=service({},c);
 Object.defineProperty(env.payload,'issued_at',{enumerable:true,
  get(){throw Error('GETTER_EXECUTED')}});
 check({shadowEnvelope:c,serviceEnvelope:env});
},'SHADOW_SERVICE_JSON_UNTRUSTED');
rejected('missing independent receiver challenge rejects proof',()=>check({
 expectedChallenge:undefined,
}),'SHADOW_SERVICE_INDEPENDENT_CONTEXT_MISSING');
rejected('invalid service clock fails closed',()=>check({
 now:Number.MAX_SAFE_INTEGER,
}),'SHADOW_SERVICE_CLOCK_UNTRUSTED');
rejected('future-issued binding denied before cryptographic acceptance',()=>{
 const c=shadow();
 check({shadowEnvelope:c,serviceEnvelope:service({
  issued_at:'2026-10-20T10:02:00Z',
  expires_at:'2026-10-20T10:02:30Z',
 },c)});
},'SHADOW_SERVICE_BINDING_SCOPE_OR_TTL');
test('protected spend gate and paid Publisher import no service binding module',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const path of ['../scripts/openrouter-only-spend-gate.mjs',
    '../scripts/protected-real-openrouter-review.mjs']){
   const s=readFileSync(new URL(path,import.meta.url),'utf8');
   assert.doesNotMatch(s,/openrouter-shadow-service-binding-offline/);
 }
 const g=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',
   import.meta.url),'utf8');
 assert.match(g,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
});
