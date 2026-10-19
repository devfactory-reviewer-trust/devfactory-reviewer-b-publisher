/**
 * R138 synthetic-only SSH loopback bridge planner.
 * NO RunPod API, no secrets, no network, no private PR source.
 * The remote GPU Pod must already be running under a separately
 * independently enforced external spending/stop control.
 */
import path from 'node:path';
import {planBoundedRunPodGpuTest} from './runpod-gpu-budget.mjs';

const POD='ao1z73um41h61i';
const MODEL='qwen3.6:35b-a3b-coding';
const GPU7B='qwen2.5-coder:7b';
const reject=reason=>Object.freeze({
  ok:false,reason,canReviewPrivateCode:false,mayStartPod:false,
  mayMerge:false,mayPublishReview:false
});
const absoluteFile=value=>typeof value==='string' &&
  value.startsWith('/') && value.length<256 &&
  !/[\r\n\0]/.test(value) &&
  path.posix.normalize(value)===value && value!=='/dev/null';
const hostValid=h=>typeof h==='string'&&
  h.length>=3&&h.length<=253 &&
  /^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/.test(h) &&
  !/\.\.|--/.test(h) && h!=='localhost' &&
  h!=='127.0.0.1' && h!=='0.0.0.0';
export function planPinnedSyntheticSshTunnel({
  podId=POD,host,port,sshPrivateKeyPath,knownHostsPath,
  budgetQuote,model=MODEL,
  externalProviderStopProof=false,providerPortExposureVerified=false,
}={}){
  if(podId!==POD||![MODEL,GPU7B].includes(model))return reject('GPU_POD_OR_MODEL_IDENTITY_UNVERIFIED');
  if(!hostValid(host)||!Number.isSafeInteger(port)||port<1||port>65535)
    return reject('GPU_PINNED_SSH_ENDPOINT_MISSING');
  if(!absoluteFile(sshPrivateKeyPath)||!absoluteFile(knownHostsPath)||
     sshPrivateKeyPath===knownHostsPath)
    return reject('GPU_SSH_KEY_OR_HOST_PIN_PATH_INVALID');
  const budget=planBoundedRunPodGpuTest({...budgetQuote,podId});
  if(!budget.ok)return reject(budget.reason);
  if(externalProviderStopProof!==true)
    return reject('GPU_EXTERNAL_STOP_PROOF_UNVERIFIED');
  if(providerPortExposureVerified!==true)
    return reject('GPU_OLLAMA_PUBLIC_PORT_EXPOSURE_UNVERIFIED');
  const args=[
    '-F','/dev/null',
    '-o','BatchMode=yes',
    '-o','IdentitiesOnly=yes',
    '-o','StrictHostKeyChecking=yes',
    '-o','PasswordAuthentication=no',
    '-o','KbdInteractiveAuthentication=no',
    '-o','ForwardAgent=no',
    '-o','PermitLocalCommand=no',
    '-o','ExitOnForwardFailure=yes',
    '-o','ServerAliveInterval=10',
    '-o','ServerAliveCountMax=2',
    '-o','ConnectTimeout=10',
    '-o','RequestTTY=no',
    '-o','LogLevel=ERROR',
    '-o','GlobalKnownHostsFile=/dev/null',
    '-o','UserKnownHostsFile='+knownHostsPath,
    '-i',sshPrivateKeyPath,
    '-p',String(port),
    '-L','127.0.0.1:11434:127.0.0.1:11434',
    '-N','root@'+host
  ];
  return Object.freeze({
    ok:true,
    executable:'ssh',
    args:Object.freeze(args),
    model,
    podId,
    localEndpoint:'http://127.0.0.1:11434',
    plannedMinutes:budget.proposedMinutes,
    projectedMonthlySpendEur:budget.projectedMonthlySpendEur,
    benchmarkArgs:Object.freeze(['bench/ollama-synthetic-benchmark.mjs',
      model===GPU7B?'--runpod-7b-holdout':'--runpod-35b-holdout']),
    benchmarkContainsOnlyPublicSyntheticFixtures:true,
    remoteGitHubPrivateKeyNeverForwarded:true,
    canReviewPrivateCode:false,mayStartPod:false,
    mayMerge:false,mayPublishReview:false,chargeAuthorized:false,
    note:'No account-level charge cap is enforced by this bridge. Keep independent provider stop active.'
  });
}
