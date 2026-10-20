/**
 * SYNTHETIC-ONLY: signed shadow claim + signed service-binding -> PG args.
 * NEVER a production identity service, budget reserve authority or HTTP API.
 * No private keys, real GitHub token, provider call or live DB credentials.
 */
import {createHash} from 'node:crypto';
import {canonicalJson} from '../src/canonical.mjs';
import {verifyShadowServiceBindingOffline}
  from './openrouter-shadow-service-binding-offline.mjs';

const TARGET='deenkids7-dev/deenkids';
const PG_SQL='SELECT * FROM reviewer_b_shadow.propose_exposure_with_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';
const upper=15_000_000;
const maxShadow=24576,maxService=8192;
const good=(reason)=>Object.freeze({
  ok:false,reason,recorded:false,syntheticOnly:true,
  maySpend:false,mayReserve:false,mayPublish:false,mayMerge:false,
  providerBillingAuthenticated:false,protectedServiceAuthenticationDeployed:false,
  serviceChallengeConsumedInProtectedProduction:false,
});
function jsonObject(input,max){
  // Byte-length BEFORE parsing to reject unbounded attacker-supplied text.
  if(typeof input!=='string'||Buffer.byteLength(input,'utf8')>max)
    throw Error('SHADOW_SYNTHETIC_JSON_UNTRUSTED');
  let object;
  try{object=JSON.parse(input)}catch{throw Error('SHADOW_SYNTHETIC_JSON_UNTRUSTED')}
  if(!object||Array.isArray(object)||typeof object!=='object')
    throw Error('SHADOW_SYNTHETIC_JSON_UNTRUSTED');
  // This local canonicalizer disallows __proto__/constructor/prototype and
  // numbers not exactly representable as safe integers.
  const normalized=canonicalJson(object);
  if(Buffer.byteLength(normalized,'utf8')>max)
    throw Error('SHADOW_SYNTHETIC_JSON_UNTRUSTED');
  // canonical JSON makes a second detached, getter-free identity snapshot.
  return Object.freeze(JSON.parse(normalized));
}
const sha=o=>createHash('sha256').update(canonicalJson(o),'utf8').digest('hex');

export async function submitSignedShadowProposalSyntheticOnly({
  signedShadowJson,signedServiceJson,
  trustedShadowKeys,trustedServiceKeys,trustedGitHubContext,
  seenClaimNonces,seenChallenges,expectedIssuer,expectedAudience,
  expectedChallenge,db,
}={}){
  // This is only a test tripwire, not authentication of service identity.
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return good('SHADOW_SYNTHETIC_SWITCH_REQUIRED');
  if(typeof db?.query!=='function')
    return good('SHADOW_SYNTHETIC_DATABASE_UNAVAILABLE');
  let shadow,service;
  try{
    shadow=jsonObject(signedShadowJson,maxShadow);
    service=jsonObject(signedServiceJson,maxService);
  }catch{
    return good('SHADOW_SYNTHETIC_JSON_INVALID');
  }
  const checkedAt=Date.now();
  let verdict;
  try{
    verdict=verifyShadowServiceBindingOffline({
      shadowEnvelope:shadow,serviceEnvelope:service,
      trustedShadowKeys,trustedServiceKeys,trustedGitHubContext,
      seenClaimNonces,seenChallenges,
      expectedIssuer,expectedAudience,expectedChallenge,
      now:checkedAt,
    });
  }catch{
    return good('SHADOW_SYNTHETIC_DUAL_SIGNATURE_UNVERIFIED');
  }
  if(verdict?.serviceSignatureVerified!==true||
     verdict?.shadowClaimSignatureVerified!==true||
     verdict?.intendedAudienceVerified!==true||
     verdict?.receiverChallengeMatches!==true||
     verdict?.maySpend!==false||verdict?.mayReserve!==false||
     verdict?.atomicChallengeConsumptionVerified!==false)
    return good('SHADOW_SYNTHETIC_VERDICT_NOT_PROOF');
  const p=shadow.payload,s=service.payload;
  // Do not take pricing, repo, HEAD, challenge, hashes or SQL from caller
  // options. All eleven positional SQL values must be from the same
  // detached, cryptographically checked JSON pair.
  if(p.repository!==TARGET||p.upper_micro_eur!==upper||
     p.month_utc!==new Date(checkedAt).toISOString().slice(0,7)||
     s.challenge!==expectedChallenge||
     sha(shadow)!==s.shadow_envelope_sha256)
    return good('SHADOW_SYNTHETIC_CLAIM_SCOPE_NOT_VERIFIED');
  const run='synthetic-'+p.service_comment_id;
  if(run.length>96)return good('SHADOW_SYNTHETIC_RUN_ID_INVALID');
  const params=[
    p.repository,p.pr_number,p.head_sha,p.service_comment_id,p.model,
    run,upper,p.nonce,sha(shadow),s.challenge,sha(service),
  ];
  let result;
  try{
    result=await db.query(PG_SQL,params);
  }catch{
    // Unknown DB state (timeout, connection loss): no automatic replay.
    return good('SHADOW_SYNTHETIC_DB_OUTCOME_UNKNOWN_NO_RETRY');
  }
  const row=result?.rows?.[0];
  if(!Array.isArray(result?.rows)||result.rows.length!==1||
     typeof row?.recorded!=='boolean'||row.may_spend!==false||
     row.provider_billing_authenticated!==false)
    return good('SHADOW_SYNTHETIC_DB_RESPONSE_UNTRUSTED');
  return Object.freeze({
    ok:row.recorded===true,recorded:row.recorded===true,
    status:row.recorded===true?
      'SYNTHETIC_SIGNED_CHALLENGE_AND_NONCE_RECORDED_NO_SPEND':
      'SYNTHETIC_SIGNED_CHALLENGE_AND_NONCE_DENIED',
    syntheticOnly:true,
    maySpend:false,mayReserve:false,mayPublish:false,mayMerge:false,
    providerBillingAuthenticated:false,
    protectedServiceAuthenticationDeployed:false,
    serviceChallengeConsumedInProtectedProduction:false,
  });
}
