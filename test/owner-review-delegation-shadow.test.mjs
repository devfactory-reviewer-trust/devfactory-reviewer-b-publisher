import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOwnerOpenRouterDelegationShadow as assess} from '../scripts/owner-review-delegation-shadow.mjs';

const MONTH='2026-10',NOW=Date.parse('2026-10-18T11:03:00Z');
const OWNER={id:297379913,login:'deenkids7-dev'};
const grant=(epoch=1,extras={})=>({
 id:100+epoch,
 user:OWNER,
 created_at:'2026-10-18T08:00:00Z',
 body:'/devfactory-openrouter-grant-v2 2026-10 epoch='+epoch+
 ' repo=deenkids7-dev/deenkids model=qwen/qwen3-coder-30b-a3b-instruct'+
 ' scope=diff-only zdr=true fallback=false budget=15eur',
 ...extras,
});
const revoke=(epoch=1,extras={})=>({
 id:500+epoch,user:OWNER,created_at:'2026-10-18T09:00:00Z',
 body:'/devfactory-openrouter-revoke-v2 2026-10 epoch='+epoch,...extras,
});
const input=()=>({nowMs:NOW,month:MONTH,githubComments:[grant()],
 independentSourceAuthenticated:true,ownerPermission:true,protectedDeploymentApproved:true,
 atomicMonthlyBudgetRemainingEur:15,modelPrivateCodeExportApproved:true,
});
const noAuthority=x=>{
 assert.equal(x.status,'BLOCKED');
 assert.equal(x.monthlyMaxEur,15);
 for(const k of ['privateCodeEgressAuthorized','cloudReviewRequestAuthorized',
  'budgetAuthorized','environmentApprovalAuthorized','mergeAuthorized','mayStartRunner'])
  assert.equal(x[k],false,k);
 for(const k of ['OWNER_DELEGATION_GITHUB_SOURCE_NOT_AUTHENTICATED',
  'OWNER_DELEGATION_REVOKE_FRESHNESS_UNVERIFIED',
  'OWNER_DELEGATION_GLOBAL_BUDGET_NOT_RESERVED',
  'OWNER_DELEGATION_ENVIRONMENT_RELEASE_NOT_PROVEN'])
  assert.ok(x.blockers.includes(k),k);
};
test('R213 well formed candidate never authorizes paid review or private data egress',()=>{
 const x=input(),before=JSON.stringify(x),r=assess(x);
 noAuthority(r);
 assert.equal(r.candidateGrantPresent,true);
 assert.equal(r.candidateGrantEpoch,1);
 assert.equal(r.candidateGrantCommentId,101);
 assert.equal(JSON.stringify(x),before);
});
test('R213 no grant and malformed comment deny',()=>{
 for(const comments of [[],[{}],[{...grant(),body:'approve everything'}],
  [{...grant(),body:grant().body+' \n/unsafe'}]]){
   const r=assess({...input(),githubComments:comments});
   noAuthority(r);
   assert.ok(r.blockers.includes('OWNER_DELEGATION_GRANT_MISSING_OR_DUPLICATE'));
 }
});
test('R213 owner identity spoof and impossible timestamp deny',()=>{
 for(const change of [
  {user:{login:'attacker',id:297379913}},
  {user:{login:'deenkids7-dev',id:1}},
  {created_at:'2026-09-18T08:00:00Z'},
  {created_at:'2026-11-18T08:00:00Z'},
  {created_at:'not-a-date'},
  {id:0}
 ]){
  const r=assess({...input(),githubComments:[grant(1,change)]});
  noAuthority(r);assert.equal(r.candidateGrantPresent,false);
 }
});
test('R213 duplicate grant for the same owner/epoch denies, including distinct comment ids',()=>{
 const r=assess({...input(),githubComments:[grant(),grant(1,{id:987})]});
 noAuthority(r);
 assert.ok(r.blockers.includes('OWNER_DELEGATION_GRANT_MISSING_OR_DUPLICATE'));
});
test('R213 duplicate obsolete epochs cannot be hidden behind a fresh grant',()=>{
 const comments=[
  grant(1,{id:111}),
  grant(1,{id:112,created_at:'2026-10-18T08:30:00Z'}),
  grant(2,{id:201,created_at:'2026-10-18T10:00:00Z'})
 ];
 const result=assess({...input(),githubComments:comments});
 noAuthority(result);
 assert.equal(result.candidateGrantPresent,false);
 assert.equal(result.candidateGrantEpoch,null);
 assert.ok(result.blockers.includes('OWNER_DELEGATION_GRANT_MISSING_OR_DUPLICATE'));
});
test('R213 same epoch or higher epoch revocation is sticky and blocks',()=>{
 for(const e of [1,2,100]){
  const r=assess({...input(),githubComments:[grant(1),revoke(e)]});
  noAuthority(r);assert.ok(r.blockers.includes('OWNER_DELEGATION_REVOKED'));
 }
});
test('R213 revoked older epoch does not resurrect grant, higher epoch candidate remains blocked',()=>{
 const r=assess({...input(),githubComments:[grant(1),revoke(1),grant(2,{id:103,created_at:'2026-10-18T10:00:00Z'})]});
 noAuthority(r);
 assert.equal(r.candidateGrantEpoch,2);
 assert.equal(r.blockers.includes('OWNER_DELEGATION_REVOKED'),false);
});
test('R213 malicious non-owner revocation cannot manufacture permission',()=>{
 const x=input();
 x.githubComments.push(revoke(10,{user:{id:200,login:'any-other-user'}}));
 const r=assess(x);noAuthority(r);
 assert.equal(r.privateCodeEgressAuthorized,false);
});
test('R213 wrong or oversized epoch, scope, model and budget deny candidate',()=>{
 const bodies=[
 grant().body.replace('budget=15eur','budget=150eur'),
 grant().body.replace('scope=diff-only','scope=all-private-source'),
 grant().body.replace('zdr=true','zdr=false'),
 grant().body.replace('fallback=false','fallback=true'),
 grant().body.replace('repo=deenkids7-dev/deenkids','repo=other/repo'),
 grant().body.replace('coder-30b-a3b-instruct','coder-other'),
 grant().body.replace('epoch=1','epoch=0'),
 grant().body.replace('epoch=1','epoch=9999999999')
 ];
 for(const body of bodies){
  const r=assess({...input(),githubComments:[grant(1,{body})]});
  noAuthority(r);assert.equal(r.candidateGrantPresent,false,body);
 }
});
test('R213 created_at date shape rejects oversized and non-GitHub dates before parsing',()=>{
 for(const created_at of [
   'x'.repeat(200_000),
   '2026-10-18T08:00:00.000Z',
   '2026-10-18T08:00:00+00:00',
   '2026-10-18T08:00:00Z'+('x'.repeat(100_000)),
   'Sun, 18 Oct 2026 08:00:00 GMT',
   'not-a-date',
 ]){
   const out=assess({...input(),githubComments:[grant(1,{created_at})]});
   noAuthority(out);
   assert.equal(out.candidateGrantPresent,false);
 }
});
test('R213 extreme timestamps and invalid Date range fail closed without crashing',()=>{
 const edge=Date.parse('+275760-09-13T00:00:00.000Z');
 assert.equal(edge,8.64e15);
 for(const nearNow of [edge-60_000,edge,8.64e15+1]){
  const x={...input(),nowMs:nearNow,githubComments:[grant(1,{created_at:'+275760-09-13T00:00:00.000Z'})]};
  const r=assess(x);noAuthority(r);
  assert.equal(r.candidateGrantPresent,false);
 }
});
test('R213 expired month cannot be reused in another month',()=>{
 for(const [month,now]of [
  ['2026-09',NOW],
  ['2026-10',Date.parse('2026-11-01T00:00:00Z')],
  ['2026-13',NOW],
 ]){
  const r=assess({...input(),month,nowMs:now});
  noAuthority(r);
  assert.ok(r.blockers.includes('OWNER_DELEGATION_MONTH_NOT_CURRENT')||
    r.blockers.includes('OWNER_DELEGATION_MONTH_INVALID'));
 }
});
test('R213 invalid arrays, forged authorization booleans and impossible clock fail closed',()=>{
 for(const v of [undefined,null,42,[],{},'x',
  {...input(),githubComments:null},
  {...input(),githubComments:new Array(101).fill(grant())},
  {...input(),nowMs:8.64e15+1},
  {...input(),nowMs:Number.POSITIVE_INFINITY}
 ]){
  const r=assess(v);noAuthority(r);
 }
 const r=assess({...input(),ownerAuthenticated:true,signatureValid:true,
  delegationRevocationVerified:true,providerInvoiceValid:true});
 noAuthority(r);
});
