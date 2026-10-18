import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSharedReviewerBBudgetShadow as assess} from '../scripts/shared-review-budget-readiness.mjs';
const month='2026-10';
const snapshot=()=>({month,
  runpod:{month,periodStart:month+'-01T00:00:00Z',cumulativeUsd:7.02},
  openrouter:{month,periodStart:month+'-01T00:00:00Z',cumulativeUsd:0.50},
  usdToEur:0.95,newReviewUpperBoundUsd:0.05,
  outstandingReservations:[{id:'review-a',month,upperBoundUsd:0.15}],
  ownerConsent:true,providerBillingAuthenticated:true,atomicallyReserved:true,
});
const deny=x=>{
 assert.equal(x.status,'BLOCKED');
 for(const key of ['budgetAuthorized','mayReserve','maySpend','providerCallsAuthorized','mayStartPod','mayPublishReview'])
   assert.equal(x[key],false,key);
 for(const code of ['SHARED_BUDGET_BILLING_LAG_NOT_INDEPENDENTLY_PROVEN',
   'SHARED_BUDGET_SOURCE_AUTHENTICATION_REQUIRED',
   'SHARED_BUDGET_FX_AUTHENTICATION_REQUIRED',
   'SHARED_BUDGET_ATOMIC_LEDGER_NOT_IMPLEMENTED'])
   assert.ok(x.blockers.includes(code),code);
};
test('normal arithmetic snapshot remains fully unauthorized',()=>{
 const v=snapshot();const before=JSON.stringify(v);
 const out=assess(v);deny(out);
 assert.equal(out.arithmeticWithinLimit,true);
 assert.equal(JSON.stringify(v),before);
 assert.equal(JSON.stringify(out).includes('ownerConsent'),false);
});
test('higher cumulative total blocks arithmetic too',()=>{
 const s=snapshot();s.runpod.cumulativeUsd=22;
 const out=assess(s);deny(out);
 assert.equal(out.arithmeticWithinLimit,false);
 assert.ok(out.blockers.includes('SHARED_BUDGET_LIMIT_WOULD_BE_EXCEEDED'));
});
test('provider top-up or balance cannot masquerade as monthly charges',()=>{
 const s=snapshot();s.openrouter={month,periodStart:month+'-01T00:00:00Z',balanceUsd:10};
 const out=assess(s);deny(out);
 assert.equal(out.arithmeticWithinLimit,null);
 assert.ok(out.blockers.includes('SHARED_BUDGET_PROVIDER_TOTAL_UNVERIFIED'));
});
test('different month or incomplete billing window blocks',()=>{
 for(const edit of [
   x=>x.openrouter.month='2026-09',
   x=>x.openrouter.periodStart='2026-10-02T00:00:00Z',
   x=>x.month='2026-00',
   x=>x.runpod.cumulativeUsd=null,
 ]){const s=snapshot();edit(s);const out=assess(s);deny(out);assert.equal(out.arithmeticWithinLimit,null);}
});
test('duplicated, missing, malformed, or wrong-month reservations block',()=>{
 for(const mutate of [
   x=>x.outstandingReservations.push({...x.outstandingReservations[0]}),
   x=>x.outstandingReservations[0].upperBoundUsd=0,
   x=>x.outstandingReservations[0].month='2026-09',
   x=>x.outstandingReservations[0].id='bad id',
   x=>x.outstandingReservations=null,
 ]){const s=snapshot();mutate(s);const out=assess(s);deny(out);assert.ok(out.blockers.includes('SHARED_BUDGET_RESERVATIONS_UNVERIFIED'));}
});
test('unknown FX or quote, and malformed untrusted arguments, cannot authorize',()=>{
 for(const s of [null,{},[],42,{...snapshot(),usdToEur:0},
   {...snapshot(),usdToEur:Infinity},
   {...snapshot(),newReviewUpperBoundUsd:0},
   {...snapshot(),newReviewUpperBoundUsd:'0.05'}])deny(assess(s));
});
test('a rounding-edge USD value still errs upward and never authorizes',()=>{
 const s=snapshot();s.runpod.cumulativeUsd=15.789474;
 s.openrouter.cumulativeUsd=0;
 s.newReviewUpperBoundUsd=0.000001;
 s.outstandingReservations=[];
 s.usdToEur=0.95;
 const out=assess(s);deny(out);
 assert.ok(out.untrustedProjectedEurCeiling>='15.00');
});
