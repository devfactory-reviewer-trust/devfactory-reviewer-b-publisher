/**
 * Publisher: fixed-code OpenRouter failure diagnostics (independent fix).
 *
 * Never publish exception messages, status bodies, URLs, credentials, paths,
 * model output or private source.  Code mapping is an exact allowlist only.
 * This module is pure and neither retries a billable request nor authorizes
 * private source export, spending, review publication or a merge.
 */
const GROUPS = Object.freeze({
  PREFLIGHT_NETWORK: [
    'OR_PREFLIGHT_NETWORK_FAILED',
  ],
  KEY_BUDGET: [
    'OR_MONTHLY_KEY_BUDGET_NOT_PROVEN',
    'OR_FULL_REVIEW_BUDGET_NOT_PROVEN',
    'OR_FULL_REVIEW_BUDGET_EXCEEDED',
  ],
  MODEL_CAPABILITY: [
    'OR_ZDR_MODEL_CAPABILITY_MISSING',
    'OR_MODEL_PRICE_DRIFT',
    'OR_MODEL_NOT_ALLOWLISTED',
  ],
  PROVIDER_TRANSPORT: [
    'OR_REQUEST_INTERRUPTED_NO_AUTORETRY',
  ],
  PROVIDER_PROTOCOL: [
    'OR_ENDPOINT_UNVERIFIED',
    'OR_RESPONSE_TOO_LARGE',
    'OR_BODY_INVALID',
    'OR_RESPONSE_ENCODING_INVALID',
    'OR_RESPONSE_INVALID_JSON',
    'OR_PRIVATE_RESPONSE_CACHE_FORBIDDEN',
  ],
  PROVIDER_COMPLETION: [
    'OR_COMPLETION_OR_COST_UNVERIFIED',
  ],
  PREFLIGHT_PROOF: [
    'OR_PREFLIGHT_PROOF_INVALID',
    'OR_PREFLIGHT_PROOF_NOT_AUTHENTIC_OR_EXPIRED',
  ],
  PRIVATE_DIFF_INTEGRITY: [
    'OR_FULL_DIFF_MISMATCH',
    'OR_FULL_COVERAGE_NOT_PROVEN',
    'OR_SHARD_PROOF_FAILED',
    'OR_DIFF_SCOPE_MISMATCH',
    'OR_REQUEST_TOO_LARGE',
    'OR_FULL_SCOPE_INVALID',
  ],
  REPORT_VALIDATION: [
    'OR_FULL_REVIEW_INCOMPLETE',
    'OR_FULL_REPORT_INVALID',
    'OR_FULL_REPORT_DUPLICATE_OR_INVALID',
    'OR_FULL_REPORT_INCOMPLETE',
    'OR_FULL_REPORT_TOO_LARGE',
  ],
  INTERNAL_GUARD: [
    'OR_CLOCK_INVALID',
    'OR_OUTPUT_BUDGET_INVALID',
    'OR_KEY_OR_MODEL_UNVERIFIED',
    'OR_INPUT_UNVERIFIED',
    'OR_FULL_REVIEW_FAILED_CLOSED',
    'OR_PRIVATE_EGRESS_NOT_AUTHORIZED',
    'OR_GLOBAL_BUDGET_NOT_VERIFIED',
  ],
});
const LOOKUP = new Map(
  Object.entries(GROUPS).flatMap(([group, codes]) => codes.map(code => [code, group]))
);

/**
 * A fixed, low-cardinality public diagnostic. Arbitrary exception fields,
 * error.cause, stack traces and upstream response text are untrusted.
 */
export function classifyOpenRouterSafeFailure(error) {
  let code;
  try {
    if (!(error instanceof Error)) return 'UNKNOWN';
    code = error.message;
  } catch {
    return 'UNKNOWN';
  }
  if (typeof code !== 'string') return 'UNKNOWN';
  return LOOKUP.get(code) ?? 'UNKNOWN';
}
