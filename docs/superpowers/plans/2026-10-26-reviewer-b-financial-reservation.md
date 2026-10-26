# Plan — protected Publisher financial reservation (2026-10-26)

Scope: no OpenRouter spend, no private diff egress, no merge, no Runner.

1. Inspect the current Publisher code and independent DevFactory broker
   evidence; identify the unreserved paid shard boundary.
2. RED: reproduce the claim-only bypass with a test that witnesses an
   OpenRouter POST despite absent independent financial authorization.
3. GREEN: implement a signer-pinned, exact-request-bound, one-use
   reservation verifier; place it immediately before the paid POST.
4. Require a fresh independent reservation per adaptive review shard and
   protected workflow config. Missing service fails closed.
5. Test absence, forged flag, scope mismatch, stale receipt, wrong signer,
   timeout, one-use consumption, no provider retry, valid synthetic path.
6. Publish on a separate branch and open a draft review PR; do not merge.
7. Independently deploy/audit the broker and run protected no-spend
   acceptance before authorizing any real reviewer spend.

No financial authority is claimed operational merely because unit tests
can sign synthetic fixture receipts.
