/**
 * Reviewer B native OpenRouter key-level spending ceiling (3 USD/month).
 * No private egress here. The sole auth capability is a recent verified
 * READ-ONLY /api/v1/key + ZDR catalog proof bound to the same secret key.
 * Unlike the retired offline reservation stub, this delegates the hard cap
 * to OpenRouter. It never promises atomic multi-key accounting.
 */
import {verifyAuthenticatedOpenRouterNativeCap}
 from './openrouter-zdr-executor.mjs';

const SHA40=/^[a-f0-9]{40}$/;
const POLICY='reviewer-b-openrouter-native-cap-usd3-v1';
export function assessAuthenticatedOpenRouterSpendAuthorization(untrusted={}){
 const i=untrusted&&typeof untrusted==='object'?untrusted:{};
 let verified=false;
 try{
  const drift=Date.now()-i.now;
  verified=Number.isSafeInteger(i.prNumber)&&i.prNumber>=1&&
   i.prNumber<=2147483647&&
   typeof i.headSha==='string'&&SHA40.test(i.headSha)&&
   Number.isSafeInteger(i.now)&&drift>=0&&drift<=15*60*1000&&
   i.consentVerified===true&&i.uniqueFirstAttempt===true&&
   verifyAuthenticatedOpenRouterNativeCap({
    apiKey:i.apiKey,preflight:i.preflight,model:i.model,maxMonthlyUsd:3
   });
 }catch{verified=false}
 return Object.freeze({
  schemaVersion:3,policy:POLICY,
  status:verified?'AUTHORIZED_NATIVE_CAP':'BLOCKED',
  reason:verified?null:'OR_NATIVE_KEY_MONTHLY_CAP_OR_SCOPE_UNVERIFIED',
  monthlyCapUsd:3,
  verified,maySpend:verified,mayReserve:false,
  mayRetryAmbiguousRequest:false
 });
}
