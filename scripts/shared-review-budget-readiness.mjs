/**
 * R212: arithmetic-only SHADOW of RunPod + OpenRouter shared EUR 15 budget.
 *
 * NEVER authorizes a paid request. No provider polling, key read, ledger
 * mutation or reservation happens here. Inputs are untrusted candidate data;
 * independently authenticated invoices, FX provenance, lag checks and a
 * durable compare-and-swap reservation authority MUST live elsewhere.
 */
const MONTH = /^20[2-9][0-9]-(0[1-9]|1[0-2])$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const MAX_USD = 1000000;
const DENIAL = Object.freeze({
  INPUT:'SHARED_BUDGET_INPUT_UNVERIFIED',
  PERIOD:'SHARED_BUDGET_MONTH_UNVERIFIED',
  SOURCE:'SHARED_BUDGET_PROVIDER_TOTAL_UNVERIFIED',
  RESERVATION:'SHARED_BUDGET_RESERVATIONS_UNVERIFIED',
  FX:'SHARED_BUDGET_FX_UNVERIFIED',
  LIMIT:'SHARED_BUDGET_LIMIT_WOULD_BE_EXCEEDED',
  BILLING_LAG:'SHARED_BUDGET_BILLING_LAG_NOT_INDEPENDENTLY_PROVEN',
  SOURCE_AUTH:'SHARED_BUDGET_SOURCE_AUTHENTICATION_REQUIRED',
  FX_AUTH:'SHARED_BUDGET_FX_AUTHENTICATION_REQUIRED',
  ATOMIC:'SHARED_BUDGET_ATOMIC_LEDGER_NOT_IMPLEMENTED',
});
function validDollar(v){return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=MAX_USD;}
function dollarsToMicroUsd(v){return BigInt(Math.ceil(v*1e6-1e-9));}
function observedMonth(source,month){
  return source&&typeof source==='object'&&!Array.isArray(source)
   &&source.month===month&&source.periodStart===month+'-01T00:00:00Z'
   &&validDollar(source.cumulativeUsd);
}
function freezeResult(blockers,shadow){
  return Object.freeze({
    schemaVersion:1,kind:'reviewer_b_shared_eur_budget_shadow',
    status:'BLOCKED',budgetAuthorized:false,mayReserve:false,maySpend:false,
    providerCallsAuthorized:false,mayStartPod:false,mayPublishReview:false,
    arithmeticWithinLimit:shadow?.within??null,
    untrustedProjectedEurCeiling:shadow?.projected??null,
    monthlyLimitEur:15,
    blockers:Object.freeze([...new Set(blockers)]),
  });
}
export function assessSharedReviewerBBudgetShadow(input={}){
 const v=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const errors=[];const add=k=>errors.push(k);
 const month=v.month;
 if(typeof month!=='string'||!MONTH.test(month))add(DENIAL.PERIOD);
 const r=v.runpod,o=v.openrouter;
 if(!observedMonth(r,month)||!observedMonth(o,month))add(DENIAL.SOURCE);
 const fx=v.usdToEur;
 if(typeof fx!=='number'||!Number.isFinite(fx)||fx<0.25||fx>3)
   add(DENIAL.FX);
 const estimate=v.newReviewUpperBoundUsd;
 if(!validDollar(estimate)||estimate<=0)add(DENIAL.INPUT);
 const reservations=v.outstandingReservations;
 if(!Array.isArray(reservations)||reservations.length>500)add(DENIAL.RESERVATION);
 else {
   const ids=new Set();
   for(const x of reservations){
     if(!x||typeof x!=='object'||Array.isArray(x)||
       typeof x.id!=='string'||!ID.test(x.id)||ids.has(x.id)||
       x.month!==month||!validDollar(x.upperBoundUsd)||
       x.upperBoundUsd<=0){add(DENIAL.RESERVATION);break;}
     ids.add(x.id);
   }
 }
 let shadow=null;
 if(errors.length===0){
   // Round every monetary input upward: no optimistic underestimation.
   let total=dollarsToMicroUsd(r.cumulativeUsd)+dollarsToMicroUsd(o.cumulativeUsd)
     +dollarsToMicroUsd(estimate);
   for(const x of reservations)total+=dollarsToMicroUsd(x.upperBoundUsd);
   const projectedCents=Math.ceil(Number(total)*fx/1e4-1e-9);
   const limitCents=1500;
   const within=projectedCents<=limitCents;
   shadow={projected:(projectedCents/100).toFixed(2),within};
   if(!within)add(DENIAL.LIMIT);
 }
 // An arithmetic snapshot never proves provider billing completeness,
 // authenticated FX, or cross-process reservation atomicity. Always deny.
 add(DENIAL.BILLING_LAG);add(DENIAL.SOURCE_AUTH);add(DENIAL.FX_AUTH);add(DENIAL.ATOMIC);
 return freezeResult(errors,shadow);
}
