/**
 * Offline service-identity binding for a signed SHADOW budget proposal.
 * No network endpoint, private keys, DB connection or spend authorization.
 * Authentication requires independently protected issuer/receiver trust.
 */
import {createHash,createPublicKey,verify as edVerify,timingSafeEqual}
  from 'node:crypto';
import {canonicalJson} from '../src/canonical.mjs';
import {verifyRotatingShadowClaimOffline}
  from './openrouter-shadow-key-rotation-offline.mjs';

const SCHEMA='devfactory.shadow.service-binding.v1';
const DOMAIN=Buffer.from('DEVFACTORY-SHADOW-SERVICE-BINDING-V1\0');
const PURPOSE='SHADOW_SERVICE_TRANSPORT_ONLY';
const SPKI='devfactory.shadow-service-identity-only.v1';
const SH=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const MAX=8_640_000_000_000_000;
const fields=['schema','issuer','audience','scope','shadow_envelope_sha256',
  'challenge','issued_at','expires_at'];
const keyFields=['issuer','purpose','publicKeyPem','spkiSha256',
  'activatedAtMs','retiredAtMs','revokedAtMs'];
const fail=reason=>{throw Error(reason)};
const validTime=n=>Number.isSafeInteger(n)&&n>=1&&n<MAX;
function snapshot(value,depth=0){
  if(depth>5)fail('SHADOW_SERVICE_JSON_UNTRUSTED');
  if(value===null||typeof value==='string'||typeof value==='boolean') {
    if(typeof value==='string'&&value.length>4096)
      fail('SHADOW_SERVICE_JSON_UNTRUSTED');
    return value;
  }
  if(typeof value==='number'&&Number.isSafeInteger(value))return value;
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.getPrototypeOf(value)!==Object.prototype)
    fail('SHADOW_SERVICE_JSON_UNTRUSTED');
  const desc=Object.getOwnPropertyDescriptors(value),result={};
  const keys=Reflect.ownKeys(desc);
  if(keys.length>30)fail('SHADOW_SERVICE_JSON_UNTRUSTED');
  for(const k of keys){
    if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||
       !Object.hasOwn(desc[k],'value'))
      fail('SHADOW_SERVICE_JSON_UNTRUSTED');
    result[k]=snapshot(desc[k].value,depth+1);
  }
  return Object.freeze(result);
}
function exact(obj,expected){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))
    fail('SHADOW_SERVICE_FIELDS_INVALID');
  const have=Object.keys(obj).sort(),want=[...expected].sort();
  if(have.length!==want.length||have.some((k,i)=>k!==want[i]))
    fail('SHADOW_SERVICE_FIELDS_INVALID');
}
function parsedTime(s){
  if(typeof s!=='string'||!ISO.test(s))
    fail('SHADOW_SERVICE_TIME_INVALID');
  const n=Date.parse(s);
  if(!validTime(n)||new Date(n).toISOString().replace('.000Z','Z')!==s)
    fail('SHADOW_SERVICE_TIME_INVALID');
  return n;
}
function loadKeys(operatorKeys){
  if(!(operatorKeys instanceof Map)||operatorKeys.size<1||
     operatorKeys.size>3)
    fail('SHADOW_SERVICE_KEYRING_UNTRUSTED');
  const out=new Map(),fingerprints=new Set();
  for(const [keyId,untrusted] of operatorKeys){
    if(typeof keyId!=='string'||!ID.test(keyId))
      fail('SHADOW_SERVICE_KEYRING_UNTRUSTED');
    const r=snapshot(untrusted);
    exact(r,keyFields);
    if(typeof r.issuer!=='string'||!ID.test(r.issuer)||
       r.purpose!==SPKI||
       typeof r.spkiSha256!=='string'||!SH.test(r.spkiSha256)||
       typeof r.publicKeyPem!=='string'||
       !r.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n')||
       r.publicKeyPem.length>2048||
       !validTime(r.activatedAtMs)||!validTime(r.retiredAtMs)||
       r.retiredAtMs<=r.activatedAtMs||
       (r.revokedAtMs!==null&&(!validTime(r.revokedAtMs)||
         r.revokedAtMs<r.activatedAtMs||
         r.revokedAtMs>r.retiredAtMs)))
      fail('SHADOW_SERVICE_KEY_POLICY_UNTRUSTED');
    if(fingerprints.has(r.spkiSha256))
      fail('SHADOW_SERVICE_KEY_ALIAS_UNTRUSTED');
    fingerprints.add(r.spkiSha256);
    out.set(keyId,r);
  }
  return out;
}
/**
 * cryptographic binding only: service issuer/audience and challenge are
 * independently supplied by an operator/receiver, NEVER the envelope.
 * This function does NOT consume a challenge or propose to PostgreSQL.
 */
export function verifyShadowServiceBindingOffline({
  shadowEnvelope,serviceEnvelope,trustedShadowKeys,
  trustedGitHubContext,seenClaimNonces,trustedServiceKeys,
  expectedIssuer,expectedAudience,expectedChallenge,
  seenChallenges,now=Date.now(),
}={}){
  if(!validTime(now))fail('SHADOW_SERVICE_CLOCK_UNTRUSTED');
  if(typeof expectedIssuer!=='string'||!ID.test(expectedIssuer)||
     typeof expectedAudience!=='string'||!ID.test(expectedAudience)||
     typeof expectedChallenge!=='string'||!UUID.test(expectedChallenge)||
     !(seenChallenges instanceof Set))
    fail('SHADOW_SERVICE_INDEPENDENT_CONTEXT_MISSING');
  // Snapshot all bytes before crypto; never re-read mutable JS values.
  const claim=snapshot(shadowEnvelope),transport=snapshot(serviceEnvelope);
  if(Buffer.byteLength(canonicalJson(claim))>24576||
     Buffer.byteLength(canonicalJson(transport))>8192)
    fail('SHADOW_SERVICE_JSON_TOO_LARGE');
  exact(transport,['payload','signature']);
  exact(transport.payload,fields);
  exact(transport.signature,['algorithm','key_id','value']);
  const p=transport.payload,s=transport.signature;
  const issue=parsedTime(p.issued_at),expiry=parsedTime(p.expires_at);
  if(p.schema!==SCHEMA||p.scope!==PURPOSE||
     p.issuer!==expectedIssuer||p.audience!==expectedAudience||
     p.challenge!==expectedChallenge||!SH.test(p.shadow_envelope_sha256)||
     issue>now+30000||issue<now-90000||expiry<=now||
     expiry<=issue||expiry-issue>60000)
    fail('SHADOW_SERVICE_BINDING_SCOPE_OR_TTL');
  if(seenChallenges.has(p.challenge))
    fail('SHADOW_SERVICE_CHALLENGE_REPLAY');
  const hash=createHash('sha256')
    .update(canonicalJson(claim),'utf8').digest('hex');
  if(!timingSafeEqual(
     Buffer.from(p.shadow_envelope_sha256,'hex'),Buffer.from(hash,'hex')))
    fail('SHADOW_SERVICE_CLAIM_DIGEST_MISMATCH');
  const ring=loadKeys(trustedServiceKeys);
  if(s.algorithm!=='Ed25519'||typeof s.key_id!=='string'||
     !ID.test(s.key_id)||typeof s.value!=='string'||
     !/^[A-Za-z0-9+/]{86}==$/.test(s.value))
    fail('SHADOW_SERVICE_SIGNATURE_FIELDS_UNTRUSTED');
  const pub=ring.get(s.key_id);
  if(!pub||pub.issuer!==expectedIssuer)
    fail('SHADOW_SERVICE_SIGNER_NOT_AUTHORIZED');
  if(issue<pub.activatedAtMs||expiry>pub.retiredAtMs||
     now<pub.activatedAtMs||now>=pub.retiredAtMs||
     (pub.revokedAtMs!==null&&
       (issue>=pub.revokedAtMs||now>=pub.revokedAtMs)))
    fail('SHADOW_SERVICE_SIGNER_REVOKED_OR_RETIRED');
  const signature=Buffer.from(s.value,'base64');
  if(signature.length!==64||signature.toString('base64')!==s.value)
    fail('SHADOW_SERVICE_SIGNATURE_INVALID');
  let key;
  try{key=createPublicKey(pub.publicKeyPem)}
  catch{fail('SHADOW_SERVICE_SIGNER_KEY_INVALID')}
  if(key.asymmetricKeyType!=='ed25519')
    fail('SHADOW_SERVICE_SIGNER_KEY_INVALID');
  const fp=createHash('sha256').update(key.export({
    type:'spki',format:'der'})).digest('hex');
  if(!timingSafeEqual(Buffer.from(fp,'hex'),
     Buffer.from(pub.spkiSha256,'hex')))
    fail('SHADOW_SERVICE_SIGNER_UNPINNED');
  if(!edVerify(null,Buffer.concat([DOMAIN,Buffer.from(canonicalJson(p))]),
      key,signature))
    fail('SHADOW_SERVICE_SIGNATURE_INVALID');
  const approved=verifyRotatingShadowClaimOffline({
    envelope:claim,keyring:trustedShadowKeys,
    trustedContext:trustedGitHubContext,
    seenNonces:seenClaimNonces,now,
  });
  if(approved.cryptographicIntegrityVerified!==true||
     approved.maySpend!==false||approved.mayReserve!==false)
    fail('SHADOW_SERVICE_CLAIM_VERIFICATION_FAILED');
  return Object.freeze({
    shadowClaimSignatureVerified:true,
    serviceSignatureVerified:true,
    intendedAudienceVerified:true,
    receiverChallengeMatches:true,
    atomicChallengeConsumptionVerified:false,
    protectedServiceAuthenticationDeployed:false,
    providerBillingAuthenticated:false,
    mayReserve:false,maySpend:false,mayPublish:false,mayMerge:false,
  });
}
