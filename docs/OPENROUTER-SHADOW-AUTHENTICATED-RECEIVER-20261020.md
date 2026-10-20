# DevFactory Reviewer B — PostgreSQL authenticated receiver boundary

**20 October 2026 — synthetic integration proposal only.**

This additive migration comes *after* the existing PostgreSQL
shadow budget, protected owner/invoker roles, nonce and challenge migrations.
It does **not** connect the proof verifier to a live DB, and grants no
spending authority.

## Threat model and behavior

Merely having membership in the existing
`reviewer_b_shadow_invoker_v1` role is insufficient protection.
A database login could otherwise invoke the challenge function with
arbitrary nonce and digest strings without demonstrating that an Ed25519
verifier examined them.

The new migration:

- Creates `reviewer_b_shadow_receiver_v1` as **NOLOGIN**,
  NOSUPERUSER, NOCREATEDB, NOCREATEROLE by default, with no password,
  no service endpoint and no operator API credential.
- Removes `EXECUTE` of the prior 11-parameter admission entrypoint
  from the generic invoker and `PUBLIC`. Its replacement
  `propose_exposure_authenticated_receiver` is executable only
  by the receiver role.
- Enforces inside the SECURITY DEFINER function that PostgreSQL's
  authenticated `session_user` equals the exact approved receiver
  role, rather than trusting `current_user`, which changes inside
  SECURITY DEFINER or after `SET ROLE`.
- Relies on the existing role-owned, qualified budget/challenge
  functions and returns **may_spend=false** and
  **provider_billing_authenticated=false** for every response.
- Verifies that the schema and function owner are trusted, the
  owner has no members and pre-existing grants on the previous function
  have not leaked to unrelated roles.

The migration is deliberately **not deployable as a functioning
receiver**: its account has NOLOGIN. A *future authorized operator*
would first need a production security review, out-of-band identity
provisioning and a protected authenticated verification service.
No such action is performed here.

## Real PostgreSQL CI regression

The isolated PostgreSQL 16 test creates a synthetic generic login
and confirms that it cannot invoke the old or new entrypoint, set
session authorization to the receiver, or set the receiver role.
The test then deliberately grants receiver role membership to the
wrong login (an adversarial privilege-misconfiguration simulation):
even after `SET ROLE`, its `session_user` remains the original
wrong login and the receiver function rejects the request.

Only in a disposable PostgreSQL container does the test operator
temporarily enable LOGIN for the receiver with the **synthetic** test
password. The test proves the account cannot create its own challenge,
the old route remains denied, a valid pre-provisioned synthetic challenge
can be consumed once, a ROLLBACK erases nonce+challenge+budget, and a
duplicate is refused after COMMIT. No real private app code, API key,
provider request, service identity certificate or permanent DB is used.

## Crucial remaining security risks

- The receiver role is **not** a real deployed, authenticated service
  identity. A compromised receiver login or malicious code operating as
  that role could supply invented challenge/digest fields. PostgreSQL
  does not verify either Ed25519 signature.
- The future protected receiver must independently authenticate GitHub
  PR/HEAD and owner consent, validate both signed envelopes against
  trusted/rotated keys and verify challenge issue/nonce uniqueness
  before a single short transaction. The existing offline source
  `fetchImpl` and `Map` mocks are not credible production trust roots.
- A client able to leave a transaction open could COMMIT after a
  challenge's expiry despite a function-time expiry check. A future
  controlled transaction executor, bounded transaction timeout
  and explicit unknown-outcome recovery policy are essential.
- PostgreSQL superusers and role/password administrators remain
  privileged trust; they can bypass any in-database roles. Future
  service authentication must use TLS/network ACL, secret custody,
  audit logs and emergency revocation.
- Provider-authenticated OpenRouter bills/account-wide exposure,
  pending charges, FX and ZDR are absent. The protected spend gate
  must remain explicitly blocked. Independent official Reviewer B
  security review, HUMAN_GO, exact-HEAD MERGE_GO and ZERO_CURSOR_GO
  remain separate mandatory requirements.

**NO-GO MERGE / DEPLOY / PAID OPENROUTER / RUNNER.**
