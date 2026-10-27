# R135 — RunPod GPU Reviewer B synthetic readiness (15 October 2026)

**PREPARATORY ONLY. NOT DEPLOYED. NO PRIVATE REPOSITORY DIFF TO RUNPOD.**
This draft must never be interpreted as `APPROVED`, `PASS`, an owner acceptance,
HUMAN_GO, MERGE_GO, source permission change, or an independent GPU review.

## Existing verified hardware, and what is NOT proven

- Current owner RunPod Pod ID shown in the 15 October console screenshot:
  `ao1z73um41h61i`, stopped, RTX A6000 48 GB, quoted $0.59/hour
  when restarted. The previously benchmarked Pod ID was
  `65d120da1098`; **do not assume** it is the same instance or that
  yesterday's Ollama binaries/model persisted in the current Pod.
- On 14 October the previously tested owner-controlled Pod generated 3/3 short
  synthetic completions at approximately 56–73 output tokens/s and 3.1–7.7s
  elapsed. `ollama ps` reported 100% GPU. This is **not** a Reviewer B
  diff benchmark or a 50-part independent security acceptance trial.
- The owner stopped the Pod after the tests. Stop confirmation was by
  unreachable SSH; **whether storage continues to bill is not yet known**.
  Do not create another Pod or incur usage merely to obtain this readme.
- On 15 October the owner MSI has the dedicated SSH private key
  `~/.ssh/devfactory_runpod_reviewer_b_20261014` but **no configured
  `RUNPOD_API_KEY`** or `runpodctl` executable. Do not display/exfiltrate
  the key or copy it to Publisher. The Pod's prior remote host/port is
  not established by the current read-only snapshot.
- Prior Pod environment had Ollama and Python but **no Node.js**.
  R135's benchmark requires a separately verified Node 24 Linux
  executable, transferred only after an authorized Pod launch. No automatic
  `curl | sh` bootstrap and no private repo checkout.

## What was added WITHOUT activating GPU

1. The pre-existing **12 fixed synthetic diffs** benchmark supports
   `qwen3.6:35b-a3b-coding` via `--runpod-35b-synthetic`.
   This is an explicit synthetic-only opt-in. In
   `candidate/ollama-offline-contract.mjs` the 35B model remains rejected
   by default and the native review workflow remains PINNED to
   `qwen2.5-coder:7b`, on GitHub-hosted Ubuntu with loopback Ollama.
2. Optional output includes total wall duration, per-request p50/p95/max,
   and the aggregated Ollama `eval_count / eval_duration` throughput only
   when every response supplies a valid duration. It explicitly keeps
   `gpu_residency_verified:false` until separately audited local
   `ollama ps` and `nvidia-smi` evidence.
3. `bench/runpod-gpu-local-preflight.sh` only accepts local
   `nvidia-smi`, Ollama `127.0.0.1:11434`, pinned 35B model and an
   independently installed Node 24 executable via `NODE_BIN`.
4. `planBoundedRunPodGpuTest()` in
   `bench/runpod-gpu-budget.mjs` is a **pure arithmetic fail-closed
   preflight**, not a cloud controller and not a paid operation. It
   requires a verified account charge-to-date, live Euro-denominated
   GPU+storage quote and independently enforced stop, and reserves €2
   margin: a proposed job must stay within the €8 operating envelope
   under the overall €10/month preference. A good plan still returns
   `mayResumePod:false` and `chargeAuthorized:false`.
   Currency conversion, other active Pods, storage and remaining
   volume charges **must** be included in the provider quote; the
   advertised GPU hourly rate alone cannot prove the spending cap.

## Safe synthetic procedure, AFTER separately proving budget + stop

On the *GPU Pod only*, from a reviewed PUBLIC Publisher source snapshot
and with verified portable Linux Node 24:

```bash
export NODE_BIN=/path/to/verified/node-v24-linux-x64/bin/node
bash bench/runpod-gpu-local-preflight.sh
"$NODE_BIN" bench/ollama-synthetic-benchmark.mjs --runpod-35b-synthetic
ollama ps   # verify 100% GPU (not mixed CPU/GPU)
```

The test uses the existing 12 fixed synthetic cases. Quality requires
**all five seeded semantic bugs** detected with **zero false alerts
on all five safe changes**. A 4/5 result or any clean false alert
FAILS; do not lower thresholds or substitute a throughput win for
quality. Compare quality and wall time against a separate same-fixture
Qwen 7B GPU trial after explicitly authorized model download; Qwen 35B
has NOT passed this test on the RTX A6000 yet.

## The production GPU bridge remains a SECOND, review-gated step

The current protected Publisher workflow executes GitHub-hosted
`ubuntu-24.04` with private material held behind the
`reviewer-b-publish` owner approval, hardcoded Qwen 7B, and Ollama
on 127.0.0.1. It cannot use an external RunPod Ollama address by
changing an environment variable. Review source today actively
forbids remote model providers and unaudited private-source egress.

A prospective secure architecture would use an explicitly reviewed,
time-bounded, host-key-pinned **SSH encrypted port-forward** from the
protected trusted workflow into an isolated, owner-approved GPU Pod,
with Ollama on remote loopback only; it must never expose the Ollama
HTTP port publicly, pass the GitHub App private key to RunPod, or
install an untrusted model hook. The PRIVATE diff would nonetheless
leave the GitHub runner to RunPod and therefore requires **separate
explicit trust authorization and independent security review**.
Qwen 7B production model change to 35B requires synthetic model-quality
approval and a separate policy diff. Preserve immutable PR HEAD,
native COMMENTED provenance and HUMAN_GO/MERGE_GO exact gates.

Do not switch the active #926 Reviewer B CPU job (run 38688836132),
start a second concurrent review, mutate deenkids production or
#876/PR878, weaken fail-closed rules, or claim GPU deployment
before end-to-end evidence. No RunPod API credential was provisioned
by R135 and no GPU cost was triggered.
