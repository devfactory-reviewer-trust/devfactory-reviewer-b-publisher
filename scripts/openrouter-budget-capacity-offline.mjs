/**
 * Offline budget capacity calculation.
 *
 * NOT a financial reservation.
 * NOT an authenticated provider balance.
 * NOT safe for provider authorization.
 *
 * All money uses integer micro-units (BigInt).
 */

export const BUDGET_CAPS = Object.freeze({
  globalMicroEur: 15_000_000n,
  reviewerBMicroUsd: 3_000_000n,
  developmentMicroUsd: 10_000_000n,
});

const deny = (reason, arithmeticFits = false) =>
  Object.freeze({
    status: 'BLOCKED',
    reason,
    verified: false,
    arithmeticFits,
    mayReserve: false,
    maySpend: false,
    mayRetryAmbiguousRequest: false,
    mayMerge: false,
    mayDeploy: false,
    mayStartRunner: false,
  });

const isAmount = value =>
  typeof value === 'bigint' && value >= 0n;

export function assessOfflineBudgetCapacity(input = {}) {
  if (input === null || typeof input !== 'object') {
    return deny('INVALID_OFFLINE_INPUT');
  }

  const role = input.role;

  if (role !== 'reviewer_b' && role !== 'development') {
    return deny('INVALID_BUDGET_ROLE');
  }

  const fields = [
    'globalBilledMicroEur',
    'globalHeldMicroEur',
    'requestMicroEur',
    'keyBilledMicroUsd',
    'keyHeldMicroUsd',
    'requestMicroUsd',
  ];

  if (!fields.every(field => isAmount(input[field]))) {
    return deny('INVALID_INTEGER_MONEY');
  }

  if (
    input.requestMicroEur === 0n ||
    input.requestMicroUsd === 0n
  ) {
    return deny('INVALID_ZERO_COST_REQUEST');
  }

  const totalGlobal =
    input.globalBilledMicroEur +
    input.globalHeldMicroEur +
    input.requestMicroEur;

  const totalKey =
    input.keyBilledMicroUsd +
    input.keyHeldMicroUsd +
    input.requestMicroUsd;

  const keyCap = role === 'reviewer_b'
    ? BUDGET_CAPS.reviewerBMicroUsd
    : BUDGET_CAPS.developmentMicroUsd;

  const fits =
    totalGlobal <= BUDGET_CAPS.globalMicroEur &&
    totalKey <= keyCap;

  return deny(
    fits
      ? 'OFFLINE_ARITHMETIC_ONLY_NO_ATOMIC_AUTHENTICATED_LEDGER'
      : 'OFFLINE_BUDGET_CAPACITY_EXCEEDED',
    fits
  );
}
