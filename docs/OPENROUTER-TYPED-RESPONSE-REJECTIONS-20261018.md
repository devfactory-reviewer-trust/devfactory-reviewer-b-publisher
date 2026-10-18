# OpenRouter Reviewer B — typed response rejection without relaxing trust

Status: public Publisher candidate, offline-only development. Existing
diagnostic PR #66 is deployed on protected Publisher main `a3a67737`.

## Evidence and uncertainty

Failed private PR #939 / Publisher run #39121299576 reached stage
`OPENROUTER` after protected approval, then failed without any native review.
Owner-provided OpenRouter generations log screenshots at approximately
2026-10-18 13:00 Paris show actual Qwen3 Coder 30B A3B Instruct calls through
SiliconFlow, nonzero billed individual costs, and one row with a missing UI
finish reason. Detailed metadata for that exact generation showed
1101 prompt tokens, 557 completion tokens, $0.000233 and a `Cached` badge.
This is **not** proof of the raw API response finish_reason or attribution to
the failed GitHub run; nor proof of a response-cache HIT or a data leak.

OpenRouter may report provider prompt-token caching while still generating
new billed output. Only the explicitly rejected
`x-openrouter-cache-status: HIT` header triggers the existing private
response-cache prohibition. Neither this PR nor the screenshot authorizes
turning off that prohibition.

## Narrow prospective change

The old response guard rejected any of the following as a single
`OR_COMPLETION_OR_COST_UNVERIFIED` code. The candidate preserves every one
of those negative predicates in the same sequence, but separates four
internal, **static** failure categories:

- `PROVIDER_ENVELOPE` — model mismatch, missing/extra choices, null or non-object choice.
- `PROVIDER_FINISH` — finish reason anything other than exact `stop`.
- `PROVIDER_MESSAGE` — non-assistant, refusal, tools, non-string content.
- `PROVIDER_USAGE` — missing/invalid token accounting, completion budget,
  total context limit, cost missing, out of range or nonfinite.

Only a category label can be printed by the already-protected diagnostics
catch path. No finish-reason literal from the provider, prompt, output,
provider response body, API key, headers, private path, token counts,
request ID, secret, stack trace or upstream error message is exposed.

The legacy `PROVIDER_COMPLETION` category is retained for compatibility.
Successful output still goes through exact immutable diff fingerprinting and
strict finding schema validation. `stop` remains required; malformed
responses **never** become a review, partial result, PASS or merge clearance.

## Validation and release gates

- New synthetic offline fixtures: missing/null/length/error/content_filter/
  tool_calls reasons, wrong model, wrong message, refusal, bad usage and costs,
  cache-hit gate. No requests sent to OpenRouter.
- Run targeted and full Node24 suites and required exact-HEAD GitHub checks.
- Independent native review and bounded owner-protected squash before deploy.
- No running Qwen review, no new Publisher #62 command, no RunPod billing,
  no environment release, no private #939 merge or Runner/Supervisor restart.
- This does NOT retroactively prove #939 root cause. Any new attempt needs
  independent billing reconciliation for RunPod+OpenRouter against EUR 15,
  exact-HEAD owner consent, duplicate-control judgment and a separate decision
  for potentially charged work. Never auto-retry interrupted requests.
