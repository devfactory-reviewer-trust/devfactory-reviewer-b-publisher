# R212 — Shared EUR budget preadmission (shadow only)

This candidate supplements the existing PUBLIC Publisher RunPod read-only billing probe, OpenRouter key-limit checks and private DevFactory inference budget. It does NOT replace those mechanisms or introduce a second scheduler.

The pure assessor consumes untrusted snapshots of actual cumulative monthly USD charges for RunPod and OpenRouter, outstanding reservations, one review upper bound and an indicative USD-to-EUR rate. It rejects top-up receipts or a remaining balance in place of charges, wrong month or billing windows, unknown FX, duplicate reservations and amounts that could exceed EUR 15 after conservative upward rounding.

**Every result is BLOCKED, budgetAuthorized=false, mayReserve=false, maySpend=false, mayStartPod=false and mayPublishReview=false.** Arithmetic is not provider billing authentication, a real budget reservation, legal permission or private code egress consent.

Production promotion requires independently authenticated and complete provider charges, billing-lag bounds, FX source provenance, a single durable atomic cross-process reservation ledger, narrowly scoped and revocable owner consent, protected GitHub App/environment approvals, and explicit authorized live trials.

This change creates no workflow, secret, deployment, private-source transfer, provider request, environment bypass, budget increase, Runtime clearance, LOT, claim, fusion, Runner or Supervisor startup. Existing native COMMENTED reports remain non-authoritative for merges.
