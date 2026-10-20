# Synthetic signed GitHub/Ed25519 → PostgreSQL challenge adapter

**20 October 2026. DRAFT. Not a production server, security attestation
or real budget authority. NO-GO OPENROUTER SPEND / MERGE / DEPLOY / RUNNER.**

## Why this separate adapter exists

The Publisher's shadow verification and database migrations were created
independently. Earlier PostgreSQL tests authenticated only an isolated
*test login* while accepted nonces, HEADs and signed hashes were merely
strings supplied to SQL. Earlier Ed25519 tests verified two signed JSON
documents but never passed the exact validated document hashes into
the restricted PostgreSQL function. This new component connects them
**in a synthetic, non-authorizing test process only**.

`scripts/openrouter-shadow-signed-admission-synthetic-only.mjs`
requires `REVIEWER_B_SYNTHETIC_SHADOW_ONLY=1`, accepting only JSON
**strings**, not callable JS envelopes. It rejects oversized, invalid
and unsafe-key payloads before verification and creates a detached
canonical JSON snapshot of each document.

It invokes the existing `verifyShadowServiceBindingOffline` using
separately supplied *test* keyrings, exact Github context, expected
service actor, audience, challenge and replay snapshots. **Only after
both Ed25519 signatures are validated** may the adapter create the SQL
parameters of `propose_exposure_with_challenge`. All of repo,
PR number, exact SHA, service comment, model, fixed synthetic EUR15
proposal, nonce, signed-shadow envelope hash, receiver challenge and
signed-service envelope hash are reconstructed from those two
detached verified JSON documents.

No value from a caller's pricing, fake `maySpend` or arbitrary
accounting month is passed through. Both hashes use the same local
`canonicalJson` representation as the signers and are never copied
from arbitrary additional request fields.

An unknown DB outcome produces **NO AUTO RETRY**. A successful
synthetic PostgreSQL row still returns `maySpend:false`,
`mayReserve:false`, `mayMerge:false`, `mayPublish:false`,
`protectedServiceAuthenticationDeployed:false` and
`providerBillingAuthenticated:false`. A test DB callback that
falsely returns `recorded:true` remains untrusted: this is **not**
an authority, only a test of argument construction.

## Tests

`test/openrouter-shadow-signed-admission-synthetic-only.test.mjs`
generates new ephemeral Ed25519 signers. It verifies:
- no DB call for forged signature, HEAD, model, service challenge, shadow
  digest, revoked signer, unsafe JSON or unverified owner context;
- exactly eleven immutable derivations of positional SQL values for
  fully verified synthetic signatures, without caller-supplied cost;
- fail-closed handling of ambiguous DB errors and unexpected paid flags;
- an isolated PGlite test that provisions a synthetic challenge through
  the test superuser, calls the function under the restricted NOLOGIN
  invoker role and confirms one nonce/challenge/budget entry with
  duplicate replay denied;
- that paid Publisher entrypoints and the locked
  `openrouter-only-spend-gate.mjs` do not import this adapter.

The existing [synthetic admission GitHub Actions workflow](
../.github/workflows/reviewer-b-shadow-admission-synthetic.yml)
runs these tests with a disposable PGlite version, synthetic keys and
zero access to real OpenRouter or the private DevFactory PR source.

## Critical outstanding trust boundaries

1. The `db`, keyrings, `trustedGitHubContext`, `seenChallenges`,
   `seenClaimNonces`, issuer/audience and receiver challenge are
   injectable **test fixtures**. An adversary controlling these values
   can fabricate evidence. A future protected service must obtain
   them independently from trusted IAM and Github API interactions.
2. The adapter does not control real DB transactions or COMMIT time.
   An arbitrary SQL caller can hold a transaction open past challenge
   expiry. Production needs a restricted application-owned,
   short-lived one-statement transaction, bounded statement and
   idle-transaction timeouts, authenticated service principal and
   independent final HEAD checks before sensitive egress.
3. The binary Ed25519 signature and canonical JSON are not JCS/RFC 8785;
   all signers and verifiers need one hardened, reviewed protocol.
   No production signing key is available or provisioned.
4. No account-wide OpenRouter provider invoices, pending requests,
   ambiguous billables, multi-key USD/EUR FX, budget lock or ZDR
   verification exists in this component.
5. There has been **no official independent Reviewer B APPROVED**
   review. HUMAN_GO/MERGE_GO exact SHA and ZERO_CURSOR_GO governance
   remains explicitly in force.

**Conclusion: test evidence only. Do not wire into the protected paid
Publisher or enable OpenRouter spending based on a green CI result.**
