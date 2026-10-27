import test from 'node:test';
import assert from 'node:assert/strict';
import {planBoundedRunPodGpuTest} from '../bench/runpod-gpu-budget.mjs';
const quote={
  podId:'ao1z73um41h61i',
  spentToDateEur:1,
  providerGpuEurPerHour:0.75,
  providerStorageEurPerHour:0.08,
  proposedMinutes:30,
  quoteVerified:true,
  availableEuroBalanceVerified:true,
  independentlyEnforcedStop:true
};
test('budget preflight is pure, nonauthorizing, reserves three euros',()=>{
 const x=planBoundedRunPodGpuTest(quote);
 assert.equal(x.ok,true,x.reason);
 assert.equal(x.projectedMonthlySpendEur,1.415);
 assert.equal(x.reservedMarginEur,3);
 assert.equal(x.monthlyHardPreferenceEur,15);
 assert.equal(x.operatingEnvelopeEur,12);
 assert.equal(x.mayResumePod,false);
 assert.equal(x.chargeAuthorized,false);
 assert.equal(x.mayHandlePrivateCode,false);
 assert.equal(Object.isFrozen(x),true);
});
test('a missing verified provider bill or stop watchdog denies cloud spend',()=>{
 const failures=[
  {spentToDateEur:undefined},
  {providerStorageEurPerHour:undefined},
  {providerGpuEurPerHour:undefined},
  {providerGpuEurPerHour:-1},
  {quoteVerified:false},
  {availableEuroBalanceVerified:false},
  {independentlyEnforcedStop:false},
  {podId:'foreign'},
  {podId:'65d120da1098'}, // previously tested Pod is NOT today's Pod
  {proposedMinutes:0},
  {proposedMinutes:61},
  {spentToDateEur:11.99},
  {spentToDateEur:14.99},
  {extraEur:100},
  {standbyEur:12},
 ];
 for(const override of failures){
  const x=planBoundedRunPodGpuTest({...quote,...override});
  assert.equal(x.ok,false,JSON.stringify(override));
  assert.equal(x.mayResumePod,false);
  assert.equal(x.mayHandlePrivateCode,false);
 }
});
test('EUR operating envelope accepts only a provable bounded 12 EUR session',()=>{
 const allowed=planBoundedRunPodGpuTest({...quote,spentToDateEur:11.4,providerGpuEurPerHour:0.75,providerStorageEurPerHour:0.08,proposedMinutes:30});
 assert.equal(allowed.ok,true,allowed.reason);
 const blocked=planBoundedRunPodGpuTest({...quote,spentToDateEur:11.6});
 assert.equal(blocked.ok,false);
 assert.equal(blocked.reason,'GPU_TWELVE_EURO_OPERATING_ENVELOPE_EXCEEDED');
 assert.equal(blocked.chargeAuthorized,false);
});
test('session may not be inferred from previous throughput or an assumed exchange rate',()=>{
 const x=planBoundedRunPodGpuTest({
   providerGpuEurPerHour:0.53,proposedMinutes:30,
   independentlyEnforcedStop:true,
 });
 assert.equal(x.reason,'GPU_COST_QUOTE_MISSING');
});
