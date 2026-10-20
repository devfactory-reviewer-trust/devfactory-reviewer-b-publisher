# Reviewer B — offline Ed25519 key rotation and revocation policy

**20 October 2026 · SECURITY PREPARATION ONLY · NO-GO paid OpenRouter / merge / Runner**

This patch provides a **read-only public-key policy evaluator** for the
separate signed shadow-budget claim format. It extends
`scripts/openrouter-shadow-signed-claim-offline.mjs`, but is **not imported**
by the paid Publisher, any GitHub Action with billable authority, or the
DevFactory Runner.

## Exact trust boundary

The future *protected* verifier/receiver must obtain its keyring, its
current GitHub PR/HEAD/comment context, nonce replay snapshot and clock
**independently** of the claimant. Nothing here provisions secrets,
authorizes a real service account or distributes production trust roots.

`verifyRotatingShadowClaimOffline` verifies:

- A nonempty, bounded **1–4 key** operator-supplied `Map`, keyed by
  explicitly allowlisted `key_id`. Each key policy has exactly seven
  fields: issuer, mandatory `devfactory.shadow-only.v1` purpose, public
  SPKI PEM, pinned lowercase SHA-256 fingerprint, activation, retirement
  and optional revocation millisecond timestamps. Unknown/private-key
  fields, accessors, invalid times and duplicate SPKI fingerprints under
  multiple key IDs are rejected.
- **Overlap for rotation:** old and new keys may coexist temporarily if
  their independently configured windows overlap. A claim must have
  been signed after key activation, must expire no later than key
  retirement, and must be examined while the key is currently active.
- **Emergency revocation:** at or after `revokedAtMs`, previously signed
  messages fail *immediately*, even if their Ed25519 signatures still
  verify. Revocation is not a grace period. A future scheduled revocation
  does not prematurely revoke a claim being checked beforehand.
- The existing signed-claim verifier still enforces the strict signed
  payload schema, domain separation from official Reviewer B reports,
  key-SPKI fingerprint match, Ed25519 signature, two-minute TTL,
  UTC month, owner/service comment references, **independently obtained**
  exact Github context, and rejection of an already-seen nonce snapshot.
- Both envelope data and key-policy entries are copied from own
  **data-property descriptors**, rejecting getters/setters. This handles
  ordinary JavaScript object mutation without executing accessors;
  malicious proxies or compromised same-process modules are outside the
  trust model.

Every successful result is explicitly **non-authorizing**:
`maySpend:false`, `mayReserve:false`, `mayMerge:false`,
`mayPublish:false`, `providerBillingAuthenticated:false`,
`nonceConsumptionVerified:false`. **Key authentication does not mean
authenticated OpenRouter billing, consent to spend, or durable replay use.**

## Offline synthetic test cases

`test/openrouter-shadow-key-rotation-offline.test.mjs` creates two
ephemeral Ed25519 keypairs and verifies acceptance while both keys are
active; planned retirement, future activation, expiry beyond retirement,
emergency revocation, wrong signatory/key ID, duplicate SPKI under aliases,
untrusted fingerprints/purpose, unrelated GitHub HEAD, nonce snapshot,
accessor attacks, unexpected private-key fields and oversized keyrings.

No keypair is exported to the user or stored in a GitHub secret. Test keys
are generated per Node test process.

## Operational blockers — do not deploy

1. **Authoritative trust-store deployment**: key provisioning and
   rotation must be audited, signed out-of-band, persistently protected
   and independent of the user-submitted signed envelope. A supplied
   `Map` in a test is not a trust anchor or an authenticated identity.
2. **Revocation propagation**: production receivers must have a
   freshness-bounded, fail-closed method to obtain newly revoked keys;
   stale cached keyrings may accept compromised signatures.
3. **Atomic replay consumption**: the older nonce SQL prototype
   prevents duplicate UUID/digest insertions, but *has not linked*
   this Ed25519 verification to PostgreSQL through a secured service
   principal. An in-memory Set is not multi-process replay protection.
4. **Audience/machine identity**: a protected issuer, receiver identity,
   authenticated transport, nonce-to-request binding and key custody
   remain unimplemented; never accept this test module as an API endpoint.
5. **Financial controls**: provider-authenticated total spend across
   all keys and calls, pending/unknown-billed requests, approved FX
   policy, ZDR, independent review and owner approval are outstanding.
6. **Human governance**: exact-head HUMAN_GO/MERGE_GO, independent
   Reviewer B review and later ZERO_CURSOR_GO remain required.

Run as an offline validation from the repository root:

```bash
node --test test/openrouter-shadow-key-rotation-offline.test.mjs
npm test
```

**Decision: NO-GO DEPLOY / PAID INFERENCE / MERGE / RUNNER.**
The real `openrouter-only-spend-gate.mjs` must still return
`OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED`.

## Additional adversarial desk review — without the MSI

After the first all-green CI run, a manual security pass identified that
`Date.parse` could invoke an attacker-defined `Symbol.toPrimitive` on a
malformed payload timestamp **before** signature verification. This is now
refused by type and exact-UTC timestamp syntax checks before calling
`Date.parse`; a synthetic regression asserts that the malicious method
is never executed. The policy also rejects an impossible revocation date
scheduled after retirement. These changes do not authenticate a remote
service, create a private key, or authorize spending. They require a
new exact-HEAD CI run after publication.
