# Reviewer B — independent financial reservation for every OpenRouter shard

Status: Publisher **code-only fail-closed integration**, NOT a production GO.
This change does not deploy or provision an independent financial authority,
authorize third-party spending, review a private PR, merge code or start Runner.

## Trust boundary

The Publisher's monthly OpenRouter API-key cap, owner consent and
GitHub anti-replay command are necessary, **not sufficient** to admit a
paid request. An independent service must durably reserve the conservative
upper bound for **each exact shard** before the Publisher performs any
OpenRouter POST. A missing, stale, altered, unsigned or reused reservation
blocks the OpenRouter POST. Publisher cannot mint a reservation.

The service must run outside the Publisher/Actions trust boundary, maintain
an atomic cross-process, cross-key UTC-month ledger, refuse duplicate
idempotency keys and count every uncertain request as possibly billed
**without auto-release**. Before signing, it must independently authenticate
the $13.00 global October 2026 cap and $3.00 Reviewer B role cap, reconcile
all relevant OpenRouter keys and handle month rollover atomically. The
Publisher cannot verify the service's *internal* atomicity from a signature:
that requires a separate deployment audit and end-to-end acceptance.

## Protected GitHub configuration — currently not provisioned

The protected `reviewer-b-publish` environment must separately provide:

- `REVIEWER_B_FINANCIAL_AUTHORITY_URL`: reviewed HTTPS FQDN at exactly
  `/v1/financial-reservations/openrouter-reviewer-b`; no redirect.
- `REVIEWER_B_FINANCIAL_SIGNER_PUBLIC_KEY_PEM`: service-owned Ed25519
  *public* signing key, from independent owner-reviewed provisioning.
- `REVIEWER_B_FINANCIAL_SIGNER_FINGERPRINT_SHA256`: SHA-256 hex of that
  key's DER SPKI, pinned out of band (never accepted from the receipt).

Do not invent a public endpoint, commit credentials, install a signer in the
Publisher, enable a workflow, or trigger a paid test to satisfy these fields.

## v1 HTTP contract

Publisher sends JSON to the independent authority containing only:
`schemaVersion:1`, `role:"reviewer-b"`, `prNumber`,
`headSha`, `runId`, `shardIndex` (0–95), exact Qwen `model`,
`requestSha256` of the exact JSON payload about to be sent to OpenRouter,
`upperMicroUsd` conservatively rounded up, `monthUtc` (UTC YYYY-MM),
`globalMonthCapMicroUsd:13000000`,
`reviewerMonthCapMicroUsd:3000000`, and `idempotencyKey`.

`idempotencyKey` is SHA-256 of
`DEVFACTORY_REVIEWER_B_FINANCIAL_RESERVATION_V1\\n` concatenated with
canonical JavaScript `JSON.stringify` of the ordered fields before
`idempotencyKey`. The service must atomically reject duplicates across
jobs, machines, restarts and month changes.

After durable reservation, it returns HTTP 200 JSON containing *all*
request fields unchanged, plus:

- `status:"RESERVED_POSSIBLY_BILLED_NO_AUTO_REFUND"`
- `reservationId:"res-"` followed by 32–64 lowercase hex characters
- `expiresAtMs`: server issuance expiry (within 60 seconds of request)
- `signature`: canonical base64 Ed25519 over
  `DEVFACTORY_REVIEWER_B_FINANCIAL_RESERVATION_V1\\n` + JSON-stringified
  ordered receipt fields *excluding signature*.

The ordered receipt fields are explicitly defined in
`scripts/openrouter-independent-financial-reservation.mjs`
(`receiptBytes`). The broker implementation should use independent
cross-language test vectors before first production deployment.

Publisher checks the pinned signer, exact binding, expiry and upper bound,
and internally burns the opaque proof **before** the paid POST. It never
retries ambiguous provider errors or broker timeouts. The broker receives
metadata/digests, not the private diff; the already authorized OpenRouter
provider remains the only external model processor.

## Acceptance and release (separate future authorization)

1. Independently audit the financial authority's signer custody,
   durable atomic accounting, replay denial across workers/restarts,
   outage handling and authenticated provider reconciliation.
2. Provision the reviewed endpoint and pinned public key to GitHub's
   protected environment (operator approval, not this PR).
3. Test with a non-paying provider stub, including concurrent shards,
   invalid signatures, model/SHA substitution, month rollover,
   duplicate jobs and crash-after-reserve.
4. Obtain an actual Reviewer B OpenRouter-only review on the *current*
   private PR #955 head under fresh exact-head consent, within remaining
   budget and ZDR policy. This commit **does not** do that.
5. Enforce distinct HUMAN_GO/MERGE_GO, CI and native-review controls before
   any protected merge. No Runner or Supervisor start is implied.
