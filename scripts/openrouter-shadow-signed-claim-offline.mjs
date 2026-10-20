/**
 * Offline verifier for a PROPOSED signed GitHub-to-PostgreSQL shadow claim.
 * Separate domain from official Reviewer B analysis attestations.
 * Cryptographic integrity != authenticated provider billing, permission to
 * debit, sender authentication, or atomic replay consumption.
 *
 * No signer/private key, network connection, DB write or paid inference.
 * The caller's trustedContext/keyring MUST be supplied independently by
 * a protected authority, not copied from an untrusted envelope.
 */
import {createHash,createPublicKey,verify as edVerify,timingSafeEqual}
  from 'node:crypto';
import {canonicalJson} from '../src/canonical.mjs';

const SCHEMA='devfactory.reviewer-b.shadow-budget-claim.v1';
const DOMAIN=Buffer.from('DEVFACTORY-SHADOW-BUDGET-CLAIM-V1\0','utf8');
const REPO='deenkids7-dev/deenkids';
const MODELS=new Set([
  'qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b',
]);
const HEX40=/^[0-9a-f]{40}$/;
const HEX64=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const deny=(code)=>{throw Error(code)};
const only=(obj,fields,code)=>{
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
     Object.getPrototypeOf(obj)!==Object.prototype)
    deny(code);
  const desc=Object.getOwnPropertyDescriptors(obj);
  const a=Object.keys(desc).sort(),b=[...fields].sort();
  if(a.length!==b.length||a.some((x,i)=>x!==b[i]))deny(code);
  // Refuse JS getters/setters and copy field values into a new plain
  // snapshot. All later validation AND signature bytes use that snapshot,
  // never the mutable user-supplied object.
  const copy={};
  for(const key of fields){
    const d=desc[key];
    if(!d||!Object.hasOwn(d,'value')||typeof d.get==='function'||
       typeof d.set==='function')deny(code);
    copy[key]=d.value;
  }
  return Object.freeze(copy);
};
const matchHash=(a,b)=>{
  if(typeof a!=='string'||typeof b!=='string'||
     !HEX64.test(a)||!HEX64.test(b))return false;
  return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
};
function instant(iso){
  if(typeof iso!=='string'||!ISO.test(iso))deny('SHADOW_CLAIM_TIME_INVALID');
  const t=Date.parse(iso);
  if(!Number.isSafeInteger(t)||
     new Date(t).toISOString().replace('.000Z','Z')!==iso)
    deny('SHADOW_CLAIM_TIME_INVALID');
  return t;
}
const bytes=p=>Buffer.concat([DOMAIN,Buffer.from(canonicalJson(p),'utf8')]);
const fields=[
  'schema','issuer','key_purpose','repository','pr_number','head_sha',
  'model','service_comment_id','owner_consent_comment_id',
  'month_utc','upper_micro_eur','nonce','issued_at','expires_at',
];
export function verifyOfflineShadowClaim({
  envelope,trustedKeys,trustedContext,seenNonces,now=Date.now(),
}={}){
  const env=only(envelope,
    ['payload','signature'],'SHADOW_ENVELOPE_FIELDS_INVALID');
  const p=only(env.payload,fields,'SHADOW_PAYLOAD_FIELDS_INVALID');
  const s=only(env.signature,
    ['algorithm','key_id','value'],'SHADOW_SIGNATURE_FIELDS_INVALID');
  if(p.schema!==SCHEMA||p.key_purpose!=='SHADOW_PROPOSAL_ONLY'||
     p.repository!==REPO||typeof p.head_sha!=='string'||
     !HEX40.test(p.head_sha)||!MODELS.has(p.model)||
     !Number.isSafeInteger(p.pr_number)||p.pr_number<1||
     p.pr_number>2147483647||
     !Number.isSafeInteger(p.service_comment_id)||p.service_comment_id<1||
     !Number.isSafeInteger(p.owner_consent_comment_id)||
     p.owner_consent_comment_id<1||p.upper_micro_eur!==15_000_000||
     typeof p.month_utc!=='string'||!/^\d{4}-\d\d$/.test(p.month_utc)||
     typeof p.nonce!=='string'||!UUID.test(p.nonce)||
     typeof p.issuer!=='string'||!ID.test(p.issuer))
    deny('SHADOW_CLAIM_SCOPE_INVALID');
  if(!Number.isSafeInteger(now)||now<1||now>8_640_000_000_000_000)
    deny('SHADOW_CLOCK_UNVERIFIED');
  const t=instant(p.issued_at),exp=instant(p.expires_at);
  // Signed claims are extremely short-lived and non-authorizing.
  if(exp<=now||t>now+30000||exp<=t||
     exp-t>120000||t<now-150000||
     new Date(t).toISOString().slice(0,7)!==p.month_utc||
     new Date(now).toISOString().slice(0,7)!==p.month_utc)
    deny('SHADOW_CLAIM_EXPIRED_OR_MONTH_MISMATCH');

  if(!(trustedKeys instanceof Map)||trustedKeys.size<1||
     !(seenNonces instanceof Set)||
     !trustedContext||typeof trustedContext!=='object')
    deny('SHADOW_INDEPENDENT_TRUST_NOT_AVAILABLE');
  // Expected fields are independently obtained by the future receiver,
  // rather than copied from the signed envelope or a client payload.
  const names=['repository','pr_number','head_sha','model',
    'service_comment_id','owner_consent_comment_id','month_utc'];
  if(names.some(k=>p[k]!==trustedContext[k]))
    deny('SHADOW_INDEPENDENT_GITHUB_CONTEXT_MISMATCH');
  if(seenNonces.has(p.nonce))
    deny('SHADOW_NONCE_ALREADY_SEEN');
  if(s.algorithm!=='Ed25519'||typeof s.key_id!=='string'||
     !ID.test(s.key_id)||typeof s.value!=='string')
    deny('SHADOW_UNTRUSTED_SIGNER');
  const entry=trustedKeys.get(s.key_id);
  if(!entry||entry.issuer!==p.issuer||
     entry.purpose!=='devfactory.shadow-only.v1')
    deny('SHADOW_UNTRUSTED_SIGNER');
  if(!/^[A-Za-z0-9+/]{86}==$/.test(s.value))
    deny('SHADOW_SIGNATURE_ENCODING_INVALID');
  const sig=Buffer.from(s.value,'base64');
  if(sig.length!==64||sig.toString('base64')!==s.value)
    deny('SHADOW_SIGNATURE_ENCODING_INVALID');
  let key;
  try{key=createPublicKey(entry.publicKeyPem)}
  catch{deny('SHADOW_PUBLIC_KEY_INVALID')}
  if(key.asymmetricKeyType!=='ed25519')
    deny('SHADOW_PUBLIC_KEY_TYPE_INVALID');
  const digest=createHash('sha256')
    .update(key.export({type:'spki',format:'der'})).digest('hex');
  if(!matchHash(entry.spkiSha256,digest))
    deny('SHADOW_UNPINNED_SIGNING_KEY');
  let valid=false;
  try{valid=edVerify(null,bytes(p),key,sig)}
  catch{deny('SHADOW_SIGNATURE_INVALID')}
  if(!valid)deny('SHADOW_SIGNATURE_INVALID');
  // CRITICAL: This check does NOT consume a nonce atomically and is not a
  // real service admission decision. No trusted signer or persistent replay
  // authority has been provisioned in this project.
  return Object.freeze({
    cryptographicIntegrityVerified:true,
    boundToIndependentContext:true,
    nonceConsumptionVerified:false,
    providerBillingAuthenticated:false,
    ownerApprovalForPayment:false,
    mayReserve:false,maySpend:false,mayPublish:false,mayMerge:false,
  });
}
