# Publisher OpenRouter — static, non-sensitive failure classification

**Scope:** independent, review-only Publisher change after workflow run
`39121299576` (2026-10-18). No new LOT, no provider invocation and no
Runner, environment, secret, budget or merge-rule changes.

## Reproduced evidence (no private content)

- Protected workflow `reviewer-b-private-openrouter.yml` was triggered for
  private PR #939 at HEAD `b431daa0ebd7dba914c54910702627100febbf0c`.
- Publisher run `39121299576` entered the protected job and passed the
  publisher-source and authenticated-request steps.
- `OPENROUTER_PROTECTED_OPENROUTER_FAILED_CLOSED` was emitted around
  2026-10-18T11:01:09Z. GitHub reported FAILURE and no native review was
  published for the exact private HEAD.
- OpenRouter's account dashboard displayed roughly $0.02 of month-to-date
  Qwen Coder 30B consumption, but not transaction-level attribution to this
  run. **One or more requests may already have been billed.** No blind rerun.
- Root cause of the historical run remains **UNKNOWN**: old logs deliberately
  did not include the internal error. This patch is prospective, not a
  post-hoc claim of diagnosing or fixing the provider failure.

## New future evidence

On the existing protected OPENROUTER-stage failure path, emit exactly
`OPENROUTER_PROTECTED_DIAGNOSTIC_<CATEGORY>` before the existing
`OPENROUTER_PROTECTED_OPENROUTER_FAILED_CLOSED` message.

The category comes solely from a strict, exact-match, fixed list of
internal error messages:
- `PREFLIGHT_NETWORK`: catalog/key preflight network failed.
- `KEY_BUDGET`: key limit/remaining/spend check failed.
- `MODEL_CAPABILITY`: model ZDR, price or capability check failed.
- `PROVIDER_TRANSPORT`: a paid POST was interrupted or timed out; assume
  possible billing. **Never automatically retry.**
- `PROVIDER_PROTOCOL`: provider endpoint/response format or cache rejected.
- `PROVIDER_COMPLETION`: finished response/usage/cost validation rejected.
- `PREFLIGHT_PROOF`: ephemeral proof mismatch or expiry.
- `PRIVATE_DIFF_INTEGRITY`: bounded immutable diff or shard guard rejected.
- `REPORT_VALIDATION`: full analysis/report completeness rejected.
- `INTERNAL_GUARD`: protected internal scope/clock/authority guard rejected.
- `UNKNOWN`: all unrecognized exceptions, input or upstream messages.

**Never** print raw exception messages, URL, status body, private source,
model completion, access token, API key, stack/cause, per-file data,
prompt, request ID or billing metadata. This diagnostic is a label,
not assurance of provider cost, an independent PASS, or permission to spend.

## Verification and release

- Run Node24 targeted and entire Publisher tests, diff whitespace check,
  protected Publisher CI checks, and independent native GitHub review.
- Keep private diff outside public Publisher branches, PR body and logs.
- No direct push to protected main, no speculative HEAD update or force push.
- No replay of #939: owner must separately decide on a new billable attempt
  after checking OpenRouter request-level Activity and cross-provider EUR 15
  spend. A fresh GitHub owner consent may be needed if the existing one ages
  past the 4-hour verified window.
- This change does **not** activate shadow delegation, reserved R214
  automated-merge work, key rotation, release approval or the Runner.
