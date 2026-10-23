/**
 * OpenRouter-only Reviewer B budget authorization cutover.
 *
 * The historical GPU-cloud provider has been retired by owner decision.
 * The user's monthly ceiling is EUR 15 for OpenRouter ONLY.
 *
 * The existing owner comment and authenticated OpenRouter key preflight do
 * not prove cross-run or cross-key spend, pending ambiguous billed requests,
 * durable reservation, idempotency, or exchange-rate provenance.
 *
 * This deliberately non-authorizing stub remains BLOCKED, even when the
 * caller supplies forged proof fields. A future independently approved
 * provider-only budget implementation MUST replace this boundary before
 * any PRIVATE billable request. Never automatically retry failed requests.
 *
 * No external provider calls, key reads, state mutations or scheduling.
 */
export function assessAuthenticatedOpenRouterSpendAuthorization(_untrusted={}) {
  return Object.freeze({
    schemaVersion: 2,
    policy: 'reviewer-b-openrouter-only-eur15-v1',
    status: 'BLOCKED',
    reason: 'OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED',
    monthlyCapEur: 15,
    verified: false,
    maySpend: false,
    mayReserve: false,
    mayRetryAmbiguousRequest: false,
    mayMerge: false,
    mayDeploy: false,
    mayStartRunner: false,
  });
}
