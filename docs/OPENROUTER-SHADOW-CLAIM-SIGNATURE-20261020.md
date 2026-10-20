# Reviewer B — offline signed shadow-claim verification (2026-10-20)

**PREPARATORY / TEST-ONLY. Never an OpenRouter paid-admission authority.**

This proposed verifier is a separate protocol from the existing
`devfactory.reviewer-b.attestation.v1` code-review attestations.
They must **never** share signing keys, reviewer authority or trust
policies. It imports the previously audited deterministic
`src/canonical.mjs` encoder and requires Ed25519 with a distinct
**`DEVFACTORY-SHADOW-BUDGET-CLAIM-V1\0`** signing prefix.

## What it checks

- Exact schema and field allowlists for envelope, payload and signature.
  No extension field such as `maySpend` or hidden approval can survive.
- Strict PR number, repository `deenkids7-dev/deenkids`, 40-character
  lowercase HEAD SHA, allowlisted Qwen model, public request-comment ID,
  consent-comment ID, UTC month, UUID nonce, issuer and a **fixed upper
  proposal of 15,000,000 micro-EUR**. This is a *proposed shadow bound*,
  NOT a checked bill, quote or real spending limit.
- Fresh UTC issued/expiry timestamps (max two minutes, no claims from a
  different month, with bounded clock skew).
- Cryptographic signer identity from a *separately provisioned*
  Ed25519 public key and exact pinned SPKI SHA-256 digest. The key's
  purpose must be `devfactory.shadow-only.v1`. Official Reviewer B
  report keys must not be reused.
- Matching **independently obtained** trusted GitHub context for PR
  number, HEAD, model, comment identities and month. These details
  must come from a protected verifier/receiver, NOT the signed
  envelope itself.
- Reject any nonce already present in the independently maintained
  replay snapshot. A locally supplied Set is **not** authoritative in a
  multi-client service; this verifier does **not consume a nonce**.
  A durable, atomic DB compare-and-set is still required.
- Even a fully valid result has:
  `mayReserve:false`, `maySpend:false`, `mayPublish:false`,
  `mayMerge:false`, `ownerApprovalForPayment:false`,
  `providerBillingAuthenticated:false` and
  `nonceConsumptionVerified:false`.

## Mandatory architecture still absent

1. A protected *issuer* which obtains the actual GitHub owner and
   service-command proofs at the moment of issuance and holds its
   private Ed25519 signing key outside untrusted PR jobs.
2. A protected *receiver* which sources the exact current GitHub HEAD
   independently, maintains a strictly rotated pinned keyring, checks
   time and persists nonce consumption atomically in PostgreSQL,
   ideally in the **same transaction** as the conservative reservation.
3. Mutual machine identity, restricted network/TLS endpoint, a signed
   key-rotation/runbook, audited DB privileges, and a fully specified
   recovery policy for unknown outcomes and replays.
4. Authenticated *provider-wide* OpenRouter actual and pending charges,
   a worst-case FX source/rounding policy and safe ceiling across keys,
   accounts, retries and other workflows. **No monetary spending may
   follow from shadow cryptographic integrity alone.**
5. Formal independent security review, exact-head HUMAN_GO/MERGE_GO,
   provider ZDR verification, and later ZERO_CURSOR_GO.

## Validation

```bash
node --test test/openrouter-shadow-signed-claim-offline.test.mjs
npm test
```

Tests sign entirely synthetic payloads using newly generated ephemeral
test Ed25519 keypairs; they do not use real signing keys, real user
consent, the private target source, any paid model, a deployed DB or
a network endpoint.

This module is **not imported by** either
`scripts/protected-real-openrouter-review.mjs` or
`scripts/openrouter-only-spend-gate.mjs`. The latter's
`OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED`
lock remains fully effective.

**NO-GO DEPLOY / SPEND / MERGE / RUNNER.**

## Finding from second-model advisory review — fixed before publication

The review found an in-process JavaScript accessor TOCTOU risk:
a malicious `signature.value` getter could replace the HEAD field
between the independent context comparison and the Ed25519 verification.
This is now **refused and regression-tested**: exact field descriptors
are inspected without invoking getters/setters, and all permitted data
fields are copied into frozen plain-object snapshots. The verifier uses
only these snapshots for time/scope checks, trusted-context comparison
and the signed byte sequence. An additional test mutates the original
payload via a trusted test Map callback and proves the original signature
bytes are still used. Out-of-range clocks are denied explicitly.

This guard protects ordinary plain JavaScript objects with accessors; it
is **not** a proof against a malicious JS `Proxy`, a compromised same-process
identity or untrusted script execution. A production receiver would accept
bounded JSON bytes in a separately controlled process, and would not
accept arbitrary executable JS objects across its trust boundary.
