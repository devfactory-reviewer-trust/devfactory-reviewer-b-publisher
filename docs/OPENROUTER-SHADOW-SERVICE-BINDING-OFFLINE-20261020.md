# Synthetic service-to-service shadow proof binding — 20 October 2026

**DRAFT, CRYPTOGRAPHIC INTEGRITY DEMONSTRATION ONLY. No deployed service,
OpenRouter invocation, signing key or PostgreSQL permission is created.**

`scripts/openrouter-shadow-service-binding-offline.mjs` checks two
**different Ed25519 signature domains** within one read-only operation:

1. A previously defined shadow-budget claim, pinned to independently
   obtained GitHub PR/HEAD, owner/service comments, a short TTL,
   a rotating non-revoked *shadow-only* signer and nonce snapshot.
2. A separate `devfactory.shadow.service-binding.v1` transport statement
   signed using an independently provisioned **service-identity-only**
   key, with the cryptographic SHA-256 digest of that precise signed
   shadow envelope, a mandatory receiver audience, a 60-second maximum
   validity window and a receiver-expected unique UUID challenge.

All nested input records are copied using plain data-property descriptors
into a bounded snapshot before signature or digest checks. Data accessors,
unknown payload fields, incorrect audience, wrong public-key purpose,
revoked signer, unpinned SPKI, tampered claim, unexpected challenge and
stale/non-matching GitHub context fail closed. The claim digest is derived
from the **same immutable snapshot** that is subsequently verified.

This offline package uses in-memory keys, `seenChallenges` and
`seenClaimNonces` supplied by an independent test environment. They
are **NOT protected remote identities or distributed atomic consumption**.
The future receiver must generate and remember challenges atomically in
one trusted persistent store, authenticate its transport, independently
retrieve the current Github HEAD, verify key rotation/revocations and
join the verified evidence to the PostgreSQL nonce reservation without
a TOCTOU gap.

No server, IAM role, mTLS deployment, private signing key, secret, live
service account, persistent ledger, provider cost or owner approval is
provisioned. The existing `reviewer_b_shadow.propose_exposure_once`
is intentionally **not** called. The real Publisher
`openrouter-only-spend-gate.mjs` remains blocked.

The successful result explicitly states
`mayReserve:false`, `maySpend:false`, `mayMerge:false`,
`mayPublish:false`, `atomicChallengeConsumptionVerified:false`,
`protectedServiceAuthenticationDeployed:false` and
`providerBillingAuthenticated:false`. These flags are not overridable
by envelope data.

## Offline tests

`test/openrouter-shadow-service-binding-offline.test.mjs` creates
temporary synthetic *separate* Ed25519 signer and service keypairs and
tests positive dual verification; wrong audience, challenge, issuer, key,
scope, model and GitHub context; revoked/aliased keys; malformed payload
getters; changed claim body/digest; challenge and claim nonce replay
snapshots; expiry; and strict lack of production imports.

The test is executed with `node --test` in the normal GitHub Actions
attestation suite; no PostgreSQL, OpenRouter, user private source, or
external service call occurs in this new test.

## Still required for the real service

- Protected independently operated issuer and receiver identities
  (service-to-service authentication, identity attestation, ACL, TLS);
- Trusted private-key custody, public-key distribution, revocation
  freshness and emergency compromise procedures;
- Fresh challenge issuance and **atomic** challenge and shadow nonce
  consumption in PostgreSQL with no ambiguous retry;
- Compare-and-swap recheck of PR HEAD before actual sensitive egress;
- Provider-authenticated account-wide usage/charges, pending unknown
  billables, vetted USD/EUR FX and worst-case bound, ZDR;
- Formal independent review and separately authorized HUMAN_GO,
  exact-HEAD MERGE_GO and ZERO_CURSOR_GO.

**NO-GO PAID OPENROUTER / MERGE / DEPLOY / RUNNER.**
