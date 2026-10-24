# OpenRouter native-cap cutover — 2026-10-24

Owner decision: replace the abandoned independent financial reservation broker with OpenRouter-native monthly key caps: developer $10, Reviewer B $3 (maximum combined $13). No RunPod, local inference, auto-provider fallback, or new external biller.

Reviewer B authorization requires: an authenticated same-key HTTPS GET /api/v1/key with monthly cap no greater than $3 and sufficient remaining funds; a fresh ZDR model catalog check; a four-hour fresh exact-PR/SHA/model/UTC-month owner consent expressly saying budget13usd; a unique first workflow paid attempt; and only then a bounded private review. No proof may be synthesized from caller-provided booleans. Fail closed for missing/expired/spoofed key proof, daily/unlimited cap, duplicate or ambiguous attempt, or stale consent. No auto retry after any billable POST; no APPROVED or merge authority from Reviewer B.

Reuse existing module-private WeakMap key proof in openrouter-zdr-executor; spend gate stays synchronous and network-free. Developer $10 cap verification, production ZDR account policy attestation and protected GitHub workflows are separate gates before starting the Runner.

Approaches considered: (1) offline reservation broker (abandoned by owner; blocked by signing and independent service), (2) native key-level caps (selected; simpler, provider-enforced), (3) bypass budget gate (rejected: unsafe). Trade-off: key caps do not provide a shared currency-conversion ledger or atomic reservation across distinct keys; total $13 holds only for these two independently constrained active keys and no additional spend-capable keys.
