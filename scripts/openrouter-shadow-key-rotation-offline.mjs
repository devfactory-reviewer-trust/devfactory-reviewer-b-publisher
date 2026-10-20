/**
 * OFFLINE-only rotation/revocation policy for signed SHADOW budget proofs.
 * There are NO secret signing keys, remote key fetches, or spend approvals.
 * keyring MUST be populated independently by a trusted operator; never
 * synthesize it from a submitted envelope or pull-request source.
 */
import {verifyOfflineShadowClaim}
  from './openrouter-shadow-signed-claim-offline.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX_TIME=8_640_000_000_000_000;
const FIELDS=['issuer','purpose','publicKeyPem','spkiSha256',
  'activatedAtMs','retiredAtMs','revokedAtMs'];
const refuse=reason=>{throw new Error(reason)};
const integer=n=>Number.isSafeInteger(n)&&n>=1&&n<MAX_TIME;

function freezeDataFields(obj,keys){
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
     Object.getPrototypeOf(obj)!==Object.prototype)
    refuse('SHADOW_KEY_POLICY_OBJECT_UNTRUSTED');
  const descriptors=Object.getOwnPropertyDescriptors(obj);
  const have=Reflect.ownKeys(descriptors);
  if(have.length!==keys.length||
     have.some(k=>typeof k!=='string'||!keys.includes(k)))
    refuse('SHADOW_KEY_POLICY_FIELDS_UNTRUSTED');
  const result={};
  for(const key of keys){
    const d=descriptors[key];
    if(!d||!Object.hasOwn(d,'value'))
      refuse('SHADOW_KEY_POLICY_ACCESSOR_FORBIDDEN');
    result[key]=d.value;
  }
  return Object.freeze(result);
}
function readKeyId(envelope){
  const outer=freezeDataFields(envelope,['payload','signature']);
  const sig=freezeDataFields(outer.signature,
    ['algorithm','key_id','value']);
  if(sig.algorithm!=='Ed25519'||typeof sig.key_id!=='string'||
     !ID.test(sig.key_id))
    refuse('SHADOW_KEY_ID_NOT_TRUSTED');
  return sig.key_id;
}
function freezeKeyring(keyring){
  if(!(keyring instanceof Map)||keyring.size<1||keyring.size>4)
    refuse('SHADOW_KEYRING_NOT_PROVISIONED');
  const output=new Map(),fingerprints=new Set();
  for(const [id,entry] of keyring){
    if(typeof id!=='string'||!ID.test(id))
      refuse('SHADOW_KEY_ID_NOT_TRUSTED');
    const r=freezeDataFields(entry,FIELDS);
    if(typeof r.issuer!=='string'||!ID.test(r.issuer)||
       r.purpose!=='devfactory.shadow-only.v1'||
       typeof r.publicKeyPem!=='string'||r.publicKeyPem.length>2048||
       !r.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n')||
       typeof r.spkiSha256!=='string'||!SHA.test(r.spkiSha256)||
       !integer(r.activatedAtMs)||!integer(r.retiredAtMs)||
       r.retiredAtMs<=r.activatedAtMs||
       (r.revokedAtMs!==null&&(!integer(r.revokedAtMs)||
          (r.revokedAtMs<r.activatedAtMs||
           r.revokedAtMs>r.retiredAtMs))) )
      refuse('SHADOW_KEY_POLICY_INVALID');
    if(fingerprints.has(r.spkiSha256))
      refuse('SHADOW_KEY_FINGERPRINT_ALIAS_FORBIDDEN');
    fingerprints.add(r.spkiSha256);
    output.set(id,r);
  }
  return output;
}
/**
 * Verification is read-only and NO-GO:
 * - live clock and candidate's signed issued/expires are bound to
 *   independently provisioned key activation/retirement/revocation;
 * - at most four pinned keys, no key-ID or public-key alias;
 * - old retired/revoked proofs fail even when Ed25519 signature is valid.
 *
 * This does NOT atomically consume a nonce or authenticate a service caller.
 */
export function verifyRotatingShadowClaimOffline({
  envelope,keyring,trustedContext,seenNonces,now=Date.now(),
}={}){
  if(!integer(now))refuse('SHADOW_KEY_CLOCK_INVALID');
  const stableRing=freezeKeyring(keyring);
  const keyId=readKeyId(envelope);
  const entry=stableRing.get(keyId);
  if(!entry)refuse('SHADOW_KEY_NOT_IN_TRUSTED_RING');
  const outer=freezeDataFields(envelope,['payload','signature']);
  const payload=freezeDataFields(outer.payload,[
    'schema','issuer','key_purpose','repository','pr_number','head_sha',
    'model','service_comment_id','owner_consent_comment_id',
    'month_utc','upper_micro_eur','nonce','issued_at','expires_at',
  ]);
  // Reject non-strings BEFORE Date.parse: objects with a custom
  // Symbol.toPrimitive can otherwise execute code during verification.
  const ISO_UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
  if(typeof payload.issued_at!=='string'||
     typeof payload.expires_at!=='string'||
     !ISO_UTC.test(payload.issued_at)||
     !ISO_UTC.test(payload.expires_at))
    refuse('SHADOW_KEY_SIGNED_TIMES_INVALID');
  const issued=Date.parse(payload.issued_at);
  const expires=Date.parse(payload.expires_at);
  if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||
     issued<entry.activatedAtMs||
     expires>entry.retiredAtMs||
     now<entry.activatedAtMs||
     now>=entry.retiredAtMs||
     (entry.revokedAtMs!==null &&
      (issued>=entry.revokedAtMs||now>=entry.revokedAtMs)))
    refuse('SHADOW_KEY_NOT_ACTIVE_OR_REVOKED');
  // The underlying verifier validates timestamps, exact field grammar,
  // signature encoding, pinned SPKI, independent GitHub context and replay.
  const ring=new Map([[keyId,{
    issuer:entry.issuer,purpose:entry.purpose,
    publicKeyPem:entry.publicKeyPem,spkiSha256:entry.spkiSha256,
  }]]);
  const checked=verifyOfflineShadowClaim({
    envelope,trustedKeys:ring,trustedContext,seenNonces,now,
  });
  if(checked?.cryptographicIntegrityVerified!==true||
     checked?.maySpend!==false||checked?.mayReserve!==false||
     checked?.nonceConsumptionVerified!==false)
    refuse('SHADOW_KEY_UNEXPECTED_VERIFICATION_RESULT');
  return Object.freeze({
    ...checked,activeKeyPolicyVerified:true,
    keyRotationChecked:true,keyRevocationChecked:true,
    signingKeyId:keyId,maySpend:false,mayReserve:false,
    mayMerge:false,mayPublish:false,
  });
}
