import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const yaml=readFileSync(resolve(import.meta.dirname,
  '../.github/workflows/reviewer-b-financial-auth-no-spend.yml'),'utf8')
  .replace(/\r\n/g,'\n');
const url='https://devfactory-finance-broker.deenkids7.workers.dev/v1/financial-reservations/openrouter-reviewer-b';
const fake='SYNTHETIC_TEST_AUTH_ONLY_NO_REAL_GITHUB_SECRET_01234567890';
const part=yaml.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE(?:\n|$)/);
assert.ok(part,'no-cost probe must contain one inline Node program');
const script=part[1].split('\n').map(line=>
  line.startsWith('          ')?line.slice(10):line).join('\n');
function simulate({status=503,body={error:'ADMISSION_DISABLED'},
  token=fake,endpoint=url}={}) {
  const prefix=`globalThis.fetch=async (url,options)=> {
  if(url!==${JSON.stringify(url)} || options.method!=='POST' ||
    options.body!=='{}'|| options.redirect!=='error' ||
    !options.headers.Authorization.startsWith('Bearer '))
    throw Error('FORBIDDEN_PROVIDER_EGRESS');
  return {url,redirected:false,status:${status},
    headers:{get:()=> 'application/json'},
    text:async()=>${JSON.stringify(JSON.stringify(body))}};
};\n`;
  return spawnSync(process.execPath,['--input-type=module','-'],{
    input:prefix+script,encoding:'utf8',timeout:6000,
    env:{PATH:process.env.PATH,
      REVIEWER_B_FINANCIAL_AUTHORITY_URL:endpoint,
      REVIEWER_B_FINANCIAL_BROKER_TOKEN:token},
  });
}
test('diagnostic can only run on protected main, service actor, first attempt',()=>{
  assert.match(yaml,/^on:\n  workflow_dispatch:/m);
  assert.match(yaml,/^permissions: \{\}$/m);
  assert.match(yaml,/environment: reviewer-b-publish/);
  assert.match(yaml,/github\.ref == 'refs\/heads\/main'/);
  assert.match(yaml,/github\.actor == 'devfactory-reviewer-service'/);
  assert.match(yaml,/github\.run_attempt == 1/);
  assert.match(yaml,/github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(yaml,/(?:pull_request_target|issue_comment|workflow_run):/);
  assert.doesNotMatch(yaml,/REVIEWER_B_OPENROUTER_API_KEY|checkout@|permissions:\s*write/);
  assert.match(yaml,/secrets\.REVIEWER_B_FINANCIAL_BROKER_TOKEN/);
  assert.match(yaml,/secrets\.REVIEWER_B_FINANCIAL_AUTHORITY_URL/);
});
test('synthetic authenticated 503 ADMISSION_DISABLED is the sole positive result',()=>{
  const result=simulate();
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/BROKER_GITHUB_PROTECTED_TOKEN_VALID_AND_PAID_ADMISSION_DISABLED/);
  assert.doesNotMatch(result.stdout+result.stderr,new RegExp(fake));
});
test('wrong GitHub secret, absent secret or wrong Cloudflare URL cannot pass',()=>{
  for(const overrides of [
    {token:'bad'}, {token:''}, {endpoint:'https://attacker.invalid/path'},
  ]) {
    const result=simulate(overrides);
    assert.equal(result.status,1);
    assert.doesNotMatch(result.stdout,/PROTECTED_TOKEN_VALID/);
    assert.doesNotMatch(result.stdout+result.stderr,new RegExp(fake));
  }
});
test('valid token but unauthorized or admission-on response remains NO-GO',()=>{
  for(const overrides of [
    {status:401,body:{error:'UNAUTHORIZED'}},
    {status:200,body:{status:'RESERVED_POSSIBLY_BILLED_NO_AUTO_REFUND'}},
    {status:503,body:{error:'STORAGE_UNAVAILABLE'}},
  ]) {
    const result=simulate(overrides);
    assert.equal(result.status,1);
    assert.doesNotMatch(result.stdout,/PROTECTED_TOKEN_VALID/);
    assert.doesNotMatch(result.stdout+result.stderr,new RegExp(fake));
  }
});
