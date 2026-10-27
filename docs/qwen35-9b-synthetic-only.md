# Reviewer B — Qwen 3.5 9B synthetic-only trial

**DRAFT / NO MERGE / NO PRODUCTION CUTOVER.**

- Model: `qwen3.5:9b`, public Ollama model.
- Only 12 fixed public synthetic fixtures, no private code, no tokens or credentials.
- Opt-in GitHub label: `reviewer-b-benchmark-qwen35-9b`; selector `--qwen35-9b-synthetic`.
- One GitHub-hosted Ubuntu model job, bounded by a 45-minute job timeout. Only loopback Ollama requests.
- Context 8192; bounded JSON output; `think:false`.
- Preserve the strict quality gate: 5 of 5 semantics correctly described, 0 alerts and 0 blockers on the 5 safe changes. Two independent static security fixtures stay protected.
- Fail closed on any error. Results do not authorize independent provenance, private source processing, native GitHub reviews, approval, merges or releases.
- Previous public comparisons (already used to improve scoring): 7B 3/5 bugs, 4/5 false alerts; Qwen 3.5 4B 5/5 bugs, 2/5 false alerts; Qwen 3 8B at most 3/5 bugs, 5/5 false alerts. None passed.
- **Success on these reused fixtures is not an independent model-quality certification.** Require unseen holdout evaluation and protected security architecture verification before any cutover.
- No changes to protected Publisher main, DevFactory, PR #876, Runner, Supervisor, ownership, Reviewer B authorization or release policy.
