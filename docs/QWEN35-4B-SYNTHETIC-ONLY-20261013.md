# Reviewer B — Qwen 3.5 4B isolated synthetic canary (2026-10-13)

## Scope / authoritative boundaries

This document and its branch are **EXPERIMENT ONLY, NOT A PRODUCTION UPGRADE**.

- No modifications to protected Publisher `main` or private DevFactory `master`.
- No live/private DevFactory diff, workflow authorization, App key, GitHub PAT, private code, or other secret may be supplied to the experiment.
- No change to the protected live Reviewer B, whose model remains `qwen2.5-coder:7b`.
- No model result is `APPROVED`, a security certification, an independent human PASS, HUMAN_GO, MERGE_GO, or merge authority.
- The only supported opt-in label for this experimental new model is `reviewer-b-benchmark-qwen35`, selecting one `qwen3.5:4b` job on a public, secret-free standard runner.
- Existing strict ten/twelve-case oracle and JSON / changed-line restrictions are reused, **never bypassed**. The current benchmark consists of 12 fixtures (five seeded semantic regressions, five clean changes, two deterministic static blockers).
- A quality-gate FAILURE is an experiment outcome, not permission to loosen checks. Passing a small synthetic test also does not authorize production.

## Safe test steps

1. Confirm the candidate draft PR changes ONLY this public Publisher and not the private DevFactory repository.
2. Confirm all tests and static security checks on the exact draft head. Do not reconfigure protected environments.
3. On the draft PR only, an authorized operator may apply the opt-in label `reviewer-b-benchmark-qwen35` to run **one public synthetic-only job**. No label means no model download and no inference call.
4. Record model digest, runner image, Ollama digest, elapsed wall time (including setup), token usage, seeded bugs correctly described, clean false alerts, response truncation, and JSON/schema errors.
5. Compare against the Qwen 2.5 Coder 7B baseline under the same strict fixture set and runner configuration. Do not claim a quality or speed victory from different fixture versions.
6. Keep the draft PR **unmerged** until a separate security, quality, authorization, and operator decision. Do not send private source to a cloud model or restart the MSI for this evaluation.

## Explicit stop conditions

Stop and report without fallback if an unexpected/private repository is targeted, branch HEAD changes while measurements are collected, any action sees a secret, model identity mismatches, a Git diff is incomplete, a response violates the JSON schema, an external inference API is invoked, the model cannot load on 4 vCPU / 16 GiB, or a runtime/cost limit would be exceeded. Never silently turn an unqualified benchmark into a live Reviewer B.

## Merge isolation

Pending DevFactory R0 and #876/#878 authorizations are deliberately out of scope. The experimental PR must not be merged, applied to protected main, or used to post GitHub reviews. It neither resolves nor modifies any existing DevFactory stabilization PR.
