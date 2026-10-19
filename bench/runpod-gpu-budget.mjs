/**
 * Strictly nonauthorizing RunPod GPU spend preflight.
 * No API, cloud token, private diff, pod creation/resume or provider changes.
 * The owner-approved monthly target is 15 EUR inclusive of storage, with
 * a 12 EUR operating envelope and 3 EUR reserve. This is NOT an enforced
 * RunPod account spend cap, and never allows a billed Pod action by itself.
 * A quote is NOT an actual bill; this cannot guarantee an account-level cap.
 */
const MAX_MONTHLY_EUR=15;
const OPERATING_ENVELOPE_EUR=12;
const RUNPOD_POD_ID='ao1z73um41h61i';
const validMoney=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=10000;
const deny=reason=>Object.freeze({
  ok:false,reason,mayResumePod:false,mayHandlePrivateCode:false,
  chargeAuthorized:false
});
export function planBoundedRunPodGpuTest({
  podId=RUNPOD_POD_ID,
  spentToDateEur,
  providerGpuEurPerHour,
  providerStorageEurPerHour,
  extraEur=0,
  proposedMinutes=30,
  standbyEur=0,
  independentlyEnforcedStop=false,
  quoteVerified=false,
  availableEuroBalanceVerified=false
}={}){
  if(podId!==RUNPOD_POD_ID)return deny('GPU_FOREIGN_POD');
  if(![spentToDateEur,providerGpuEurPerHour,
    providerStorageEurPerHour,extraEur,standbyEur].every(validMoney)||
    providerGpuEurPerHour<=0)return deny('GPU_COST_QUOTE_MISSING');
  if(!Number.isSafeInteger(proposedMinutes)||
    proposedMinutes<1||proposedMinutes>60)return deny('GPU_SESSION_DURATION_INVALID');
  if(!quoteVerified||!availableEuroBalanceVerified)
    return deny('GPU_BILLING_SNAPSHOT_UNVERIFIED');
  if(!independentlyEnforcedStop)
    return deny('GPU_EXTERNAL_AUTO_STOP_UNPROVEN');
  const conservativeEur=spentToDateEur+standbyEur+extraEur+
    (providerGpuEurPerHour+providerStorageEurPerHour)*(proposedMinutes/60);
  if(!Number.isFinite(conservativeEur)||
    conservativeEur>OPERATING_ENVELOPE_EUR+1e-9)
    return deny('GPU_TWELVE_EURO_OPERATING_ENVELOPE_EXCEEDED');
  return Object.freeze({
    ok:true,
    podId,proposedMinutes,
    projectedMonthlySpendEur:Number(conservativeEur.toFixed(3)),
    monthlyHardPreferenceEur:MAX_MONTHLY_EUR,
    operatingEnvelopeEur:OPERATING_ENVELOPE_EUR,
    reservedMarginEur:MAX_MONTHLY_EUR-OPERATING_ENVELOPE_EUR,
    mayResumePod:false,mayHandlePrivateCode:false,chargeAuthorized:false,
    note:'Pure arithmetic only. A separately audited RunPod start/stop controller and owner consent are required.',
  });
}
