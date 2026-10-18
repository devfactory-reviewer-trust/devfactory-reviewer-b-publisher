import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {classifyOpenRouterSafeFailure}
  from '../scripts/openrouter-safe-failure-diagnostic.mjs';

test('maps known internal failures to bounded non-secret categories', () => {
  const cases = [
    ['OR_PREFLIGHT_NETWORK_FAILED', 'PREFLIGHT_NETWORK'],
    ['OR_MONTHLY_KEY_BUDGET_NOT_PROVEN', 'KEY_BUDGET'],
    ['OR_FULL_REVIEW_BUDGET_NOT_PROVEN', 'KEY_BUDGET'],
    ['OR_MODEL_PRICE_DRIFT', 'MODEL_CAPABILITY'],
    ['OR_ZDR_MODEL_CAPABILITY_MISSING', 'MODEL_CAPABILITY'],
    ['OR_REQUEST_INTERRUPTED_NO_AUTORETRY', 'PROVIDER_TRANSPORT'],
    ['OR_ENDPOINT_UNVERIFIED', 'PROVIDER_PROTOCOL'],
    ['OR_COMPLETION_OR_COST_UNVERIFIED', 'PROVIDER_COMPLETION'],
    ['OR_COMPLETION_ENVELOPE_UNVERIFIED', 'PROVIDER_ENVELOPE'],
    ['OR_COMPLETION_FINISH_NOT_STOP', 'PROVIDER_FINISH'],
    ['OR_COMPLETION_MESSAGE_UNVERIFIED', 'PROVIDER_MESSAGE'],
    ['OR_COMPLETION_USAGE_UNVERIFIED', 'PROVIDER_USAGE'],
    ['OR_PREFLIGHT_PROOF_NOT_AUTHENTIC_OR_EXPIRED', 'PREFLIGHT_PROOF'],
    ['OR_FULL_DIFF_MISMATCH', 'PRIVATE_DIFF_INTEGRITY'],
    ['OR_FULL_REPORT_INVALID', 'REPORT_VALIDATION'],
    ['OR_GLOBAL_BUDGET_NOT_VERIFIED', 'INTERNAL_GUARD'],
  ];
  for (const [input, expected] of cases)
    assert.equal(classifyOpenRouterSafeFailure(new Error(input)), expected);
});

test('fails closed with UNKNOWN for all untrusted messages or objects', () => {
  const hidden = 'SECRET_TOKEN_PRIVATE_DIFF_123456789';
  const unsafe = [
    undefined, null, {}, {message: hidden}, hidden,
    new Error('OR_ENDPOINT_UNVERIFIED ' + hidden),
    new Error('OR_ENDPOINT_UNVERIFIED\n' + hidden),
    new Error(hidden),
    new Error('401 Unauthorized: ' + hidden),
    new Error('OR_' + hidden),
  ];
  const throwing = new Error();
  Object.defineProperty(throwing, 'message', {get() {throw Error(hidden);}});
  unsafe.push(throwing);
  for (const x of unsafe) {
    const outcome = classifyOpenRouterSafeFailure(x);
    assert.equal(outcome, 'UNKNOWN');
    assert.ok(!outcome.includes(hidden));
    assert.match(outcome, /^[A-Z_]{3,32}$/);
  }
});

test('protected review never logs an exception message, only allowlisted outcome', () => {
  const src = readFileSync(fileURLToPath(
    new URL('../scripts/protected-real-openrouter-review.mjs', import.meta.url)), 'utf8');
  assert.match(src, /if\(stage==='OPENROUTER'\)/);
  assert.match(src, /classifyOpenRouterSafeFailure\(error\)/);
  assert.doesNotMatch(src, /console\.(?:log|error)\([^\n]*error\.(?:message|stack|cause)/);
});

test('diagnostic remains pure and incapable of authorizing release or billing', () => {
  const src = readFileSync(fileURLToPath(
    new URL('../scripts/openrouter-safe-failure-diagnostic.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /\b(fetch|process|globalThis|Date|console|writeFile|execFile|spawn)\s*\(/);
  assert.doesNotMatch(src, /privateDiffText|apiKey|OPENROUTER_API_KEY|GITHUB_APP_PRIVATE_KEY/);
  assert.equal(classifyOpenRouterSafeFailure(new Error('OR_REQUEST_INTERRUPTED_NO_AUTORETRY')),
    'PROVIDER_TRANSPORT');
});
