import test from 'node:test';
import assert from 'node:assert/strict';
import {planPinnedSyntheticSshTunnel} from '../bench/runpod-gpu-ssh-plan.mjs';

const quote=Object.freeze({
 spentToDateEur:1.4,providerGpuEurPerHour:0.7,
 providerStorageEurPerHour:0.1,
 extraEur:0.1,standbyEur:0.1,proposedMinutes:20,
 independentlyEnforcedStop:true,quoteVerified:true,
 availableEuroBalanceVerified:true
});
const options=()=>({
 podId:'ao1z73um41h61i',
 host:'gpu-tcp.runpod.net',port:21053,
 sshPrivateKeyPath:'/home/owner/.ssh/runpod-dedicated',
 knownHostsPath:'/home/owner/.ssh/known_hosts_runpod',
 budgetQuote:{...quote},model:'qwen3.6:35b-a3b-coding',
 externalProviderStopProof:true,
 providerPortExposureVerified:true
});
test('synthetic-only bridge uses pinned strict SSH, loopback Ollama and no remote review authority',()=>{
 const v=planPinnedSyntheticSshTunnel(options());
 assert.equal(v.ok,true,v.reason);
 assert.equal(v.executable,'ssh');
 assert.ok(v.args.includes('StrictHostKeyChecking=yes'));
 assert.ok(v.args.includes('ForwardAgent=no'));
 assert.ok(v.args.includes('ExitOnForwardFailure=yes'));
 assert.ok(v.args.includes('PasswordAuthentication=no'));
 assert.ok(v.args.includes('UserKnownHostsFile=/home/owner/.ssh/known_hosts_runpod'));
 assert.deepEqual(v.args.slice(-4),
  ['-L','127.0.0.1:11434:127.0.0.1:11434','-N','root@gpu-tcp.runpod.net']);
 assert.equal(v.remoteGitHubPrivateKeyNeverForwarded,true);
 assert.equal(v.canReviewPrivateCode,false);
 assert.equal(v.mayStartPod,false);
 assert.equal(v.mayPublishReview,false);
 assert.equal(v.chargeAuthorized,false);
 assert.equal(v.benchmarkContainsOnlyPublicSyntheticFixtures,true);
 assert.equal(Object.isFrozen(v.args),true);
});
test('no quote, unverified host, or missing independent stop prevents bridge',()=>{
 const invalid=[
 {podId:'foreign'},
 {podId:'65d120da1098'}, // never reuse old Pod identity
 {model:'qwen3.5:9b'},
 {host:'localhost'},
 {host:'127.0.0.1'},
 {host:'a;$(touch /tmp/attack)'},
 {host:'gpu..example.net'},
 {port:0},
 {port:65536},
 {port:'22'},
 {sshPrivateKeyPath:'relative/private'},
 {sshPrivateKeyPath:'/tmp/evil\nkey'},
 {sshPrivateKeyPath:'/dev/null'},
 {knownHostsPath:'/dev/null'},
 {knownHostsPath:'/home/owner/.ssh/runpod-dedicated'},
 {budgetQuote:{}},
 {budgetQuote:{...quote,spentToDateEur:11.8}},
 {budgetQuote:{...quote,independentlyEnforcedStop:false}},
 {externalProviderStopProof:false},
 {providerPortExposureVerified:false}
 ];
 for(const bad of invalid){
  const r=planPinnedSyntheticSshTunnel({...options(),...bad});
  assert.equal(r.ok,false,JSON.stringify(bad));
  assert.equal(r.canReviewPrivateCode,false);
  assert.equal(r.mayStartPod,false);
  assert.equal(r.mayPublishReview,false);
 }
});
test('model cannot be changed by environment variables or by shell metacharacter injection',()=>{
 const r=planPinnedSyntheticSshTunnel(options());
 assert.equal(r.model,'qwen3.6:35b-a3b-coding');
 assert.ok(r.args.every(x=>!/[\r\n\0]/.test(x)));
 assert.equal(r.args.filter(x=>x==='-L').length,1);
 assert.equal(r.args.includes('0.0.0.0:11434:127.0.0.1:11434'),false);
 assert.equal(r.args.includes('-R'),false);
 assert.equal(r.args.includes('-A'),false);
});
