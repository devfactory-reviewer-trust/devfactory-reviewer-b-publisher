import test from 'node:test';
import assert from 'node:assert/strict';

import {assessOfflineBudgetCapacity as check}
  from '../scripts/openrouter-budget-capacity-offline.mjs';

const base = {
  role: 'reviewer_b',
  globalBilledMicroEur: 0n,
  globalHeldMicroEur: 0n,
  requestMicroEur: 1_000_000n,
  keyBilledMicroUsd: 0n,
  keyHeldMicroUsd: 0n,
  requestMicroUsd: 1_000_000n,
};

const noAuthority = result => {
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.verified, false);
  assert.equal(result.mayReserve, false);
  assert.equal(result.maySpend, false);
  assert.equal(result.mayMerge, false);
  assert.equal(result.mayDeploy, false);
  assert.equal(result.mayStartRunner, false);
  assert.equal(result.mayRetryAmbiguousRequest, false);
  assert.ok(Object.isFrozen(result));
};

test('valid arithmetic never grants spend', () => {
  const result = check(base);
  assert.equal(result.arithmeticFits, true);
  noAuthority(result);
});

test('global 15 EUR cap is enforced', () => {
  const result = check({
    ...base,
    globalBilledMicroEur: 14_500_000n,
  });
  assert.equal(result.arithmeticFits, false);
  noAuthority(result);
});

test('reviewer B 3 USD cap is enforced', () => {
  const result = check({
    ...base,
    keyHeldMicroUsd: 2_500_000n,
  });
  assert.equal(result.arithmeticFits, false);
  noAuthority(result);
});

test('developer 10 USD cap is enforced', () => {
  const result = check({
    ...base,
    role: 'development',
    requestMicroUsd: 10_000_001n,
  });
  assert.equal(result.arithmeticFits, false);
  noAuthority(result);
});

test('invalid amounts fail closed', () => {
  for (const amount of [-1n, 1.5, NaN, '1000000', null]) {
    const result = check({
      ...base,
      requestMicroEur: amount,
    });
    assert.equal(result.arithmeticFits, false);
    noAuthority(result);
  }
});

test('fake authorization cannot grant spend', () => {
  const result = check({
    ...base,
    verified: true,
    providerAuthenticated: true,
    maySpend: true,
    mayReserve: true,
    HUMAN_GO: true,
    MERGE_GO: true,
  });
  noAuthority(result);
});
