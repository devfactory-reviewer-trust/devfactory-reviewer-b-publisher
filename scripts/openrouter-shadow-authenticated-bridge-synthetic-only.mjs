/**
 * OFFLINE SYNTHETIC ONLY: route verified Ed25519 proof arguments through
 * PostgreSQL's authenticated receiver SESSION_USER guard, not old bypass.
 * No network endpoint, production credential, paid model or authorization.
 */
import {submitSignedShadowProposalSyntheticOnly}
  from './openrouter-shadow-signed-admission-synthetic-only.mjs';

const OLD='SELECT * FROM reviewer_b_shadow.propose_exposure_with_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';
const GUARDED='SELECT * FROM reviewer_b_shadow.propose_exposure_authenticated_receiver($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';
const denial=reason=>Object.freeze({
  ok:false,reason,recorded:false,syntheticOnly:true,
  maySpend:false,mayReserve:false,mayMerge:false,mayPublish:false,
  providerBillingAuthenticated:false,
  protectedServiceAuthenticationDeployed:false,
});
// Explicit, frozen-scope CI adapter inputs. Do not accept caller-supplied SQL,
// repository, HEAD, price, clock, or database identity overrides. The input
// object's getters and unknown fields are rejected before signature checks.
const TEST_INPUTS=new Set([
  'signedShadowJson','signedServiceJson','trustedShadowKeys',
  'trustedServiceKeys','trustedGitHubContext','seenClaimNonces',
  'seenChallenges','expectedIssuer','expectedAudience',
  'expectedChallenge','db',
]);
function snapshotSyntheticInputs(options){
  if(!options||typeof options!=='object'||Array.isArray(options))return null;
  try{
    const proto=Object.getPrototypeOf(options);
    if(proto!==Object.prototype&&proto!==null)return null;
    const desc=Object.getOwnPropertyDescriptors(options);
    const names=Reflect.ownKeys(desc);
    if(names.length!==TEST_INPUTS.size||names.some(name=>
      typeof name!=='string'||!TEST_INPUTS.has(name)||
      !Object.hasOwn(desc[name],'value')||!desc[name].enumerable))
      return null;
    const input=Object.fromEntries(names.map(name=>[name,desc[name].value]));
    // pg.Client.query is a prototype method; find its DATA descriptor
    // without invoking a caller-controlled query getter. This is still
    // test dependency injection, NOT authentication of a DB service.
    if(!input.db||typeof input.db!=='object')return null;
    let current=input.db,query;
    for(let depth=0;current&&depth<8;depth++,current=Object.getPrototypeOf(current)){
      const method=Object.getOwnPropertyDescriptor(current,'query');
      if(method){
        if(!Object.hasOwn(method,'value')||typeof method.value!=='function')
          return null;
        query=method.value;
        break;
      }
    }
    return query?{input,query}:null;
  }catch{
    return null;
  }
}
export async function submitViaProtectedReceiverSyntheticOnly(options={}){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return denial('SHADOW_RECEIVER_SYNTHETIC_SWITCH_REQUIRED');
  const safe=snapshotSyntheticInputs(options);
  if(!safe)return denial('SHADOW_RECEIVER_SYNTHETIC_INPUT_UNTRUSTED');
  // Not authentication! A caller-provided callback can fake a DB success.
  // This function exists solely for ephemeral CI tests using an actual
  // independently password-authenticated PostgreSQL connection.
  const authenticatedFunctionOnly={
    query:async(sql,values)=>{
      if(sql!==OLD||!Array.isArray(values)||values.length!==11)
        throw Error('SHADOW_RECEIVER_OLD_ROUTE_FORBIDDEN');
      return safe.query.call(safe.input.db,GUARDED,values);
    },
  };
  return submitSignedShadowProposalSyntheticOnly({
    ...safe.input,db:authenticatedFunctionOnly,
  });
}
