import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const POD='ao1z73um41h61i';
const script=fileURLToPath(new URL('../bench/runpod-gpu-pod-self-stop.sh',import.meta.url));
function fixture({installCli=true,installFakeNohup=true}={}){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'df-r143-runpod-'));
 const output=path.join(folder,'noop.log');
 const pathBase=folder+':/usr/bin:/bin';
 const fake=(name,body)=>{
  const p=path.join(folder,name);
  fs.writeFileSync(p,'#!/bin/sh\n'+body+'\n',{mode:0o700});
 };
 if(installCli)fake('runpodctl','exit 0');
 if(installFakeNohup)fake('nohup',`printf '%s\\n' "$*" > "${output}"; exit 0`);
 const run=(args,env={})=>spawnSync('/bin/bash',[script,...args],{
  encoding:'utf8',timeout:2000,
  env:{...process.env,PATH:pathBase,RUNPOD_POD_ID:POD,...env},
 });
 return {folder,output,run,cleanup:()=>fs.rmSync(folder,{recursive:true,force:true})};
}
test('R143 exact stopped-Pod identity required even for check',()=>{
 const f=fixture();
 try{
  for(const id of ['', '65d120da1098','ao1z73um41h61i\n','$(whoami)']){
   const r=f.run(['--check'],{RUNPOD_POD_ID:id});
   assert.equal(r.status,2);
   assert.match(r.stderr,/GPU_SELF_STOP_FOREIGN_OR_UNKNOWN_POD/);
   assert.equal(fs.existsSync(f.output),false);
  }
 }finally{f.cleanup();}
});
test('R143 a check never launches any stop and reveals no key',()=>{
 const f=fixture();
 try{
  const r=f.run(['--check']);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/EXACT_POD_AND_CLI_READY_NO_ARM/);
  assert.equal(fs.existsSync(f.output),false);
 }finally{f.cleanup();}
});
test('R143 foreign/extra/ambiguous operator confirmation never arms',()=>{
 const f=fixture();
 try{
  for(const args of [
   [],['ARM-20M'],['ARM-20M','65d120da1098'],
   ['ARM-10M',POD],['ARM-20M',POD,'extra'],
   ['ARM-20M',POD+';touch /tmp/unsafe'],
  ]){
   const r=f.run(args);
   assert.equal(r.status,2,JSON.stringify(args));
   assert.equal(fs.existsSync(f.output),false);
  }
 }finally{f.cleanup();}
});
test('R143 dry synthetic fake nohup verifies exact fixed timer and never touches provider',async()=>{
 const f=fixture();
 try{
  const r=f.run(['ARM-20M',POD]);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/TIMER_LAUNCHED_UNVERIFIED/);
  assert.match(r.stdout,/NOT_PROVIDER_STOP_PROOF/);
  for(let i=0;i<25&&!fs.existsSync(f.output);i++)
   await new Promise(r=>setTimeout(r,20));
  const args=fs.readFileSync(f.output,'utf8');
  assert.match(args,/bash -c sleep 1200; exec runpodctl stop pod ao1z73um41h61i/);
  assert.equal(args.includes('65d120da1098'),false);
 }finally{f.cleanup();}
});
test('R143 source has no remote activation, keys or private-source transport',()=>{
 const source=fs.readFileSync(script,'utf8');
 assert.equal(source.includes('runpodctl start'),false);
 assert.equal(source.includes('git clone'),false);
 assert.equal(source.includes('curl '),false);
 assert.equal(source.includes('api.runpod.io'),false);
 assert.equal(source.includes('RUNPOD_API_KEY'),false);
 assert.match(source,/sleep 1200/);
 assert.match(source,/runpodctl stop pod ao1z73um41h61i/);
});
