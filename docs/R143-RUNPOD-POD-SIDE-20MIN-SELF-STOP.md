# R143 — Extra on-Pod 20-minute RunPod self-stop safeguard (PUBLIC synthetic only)

**DRAFT. ZERO GPU START, ZERO REAL STOP, ZERO PRIVATE CODE TRANSFER.**
No production Qwen model, protected workflow, approval rules, exact PR
authorization, owner acceptance, or cloud credentials are changed.

## Evidence and limits (15 October 2026)

- Owner RunPod Billing screenshot at 11:15 Paris time: **$3.23
  account balance**, **$0.000/hour current spend**, **Auto-Pay disabled**.
  The displayed $80.00/hour "spend rate limit" is **NOT** the requested
  €10/month ceiling and does not prove historical expenditure.
- Owner's prior Pod screenshot: current Pod `ao1z73um41h61i`,
  RTX A6000 48GB, *advertised* $0.59/hour when running. The prior
  benchmark Pod `65d120da1098` is a different Pod.
  Running the current Pod for 20 minutes would have about $0.197
  GPU-compute charge at the *quoted* rate, **before** storage and other
  charges, without guaranteeing GPU availability or model persistence.
- The earlier CPU Qwen Reviewer B run #38688836132 FAILED with
  `LOCAL_MODEL_TRANSPORT_INTERRUPTED` after approximately 59 minutes;
  that failure does not authorize sending PRIVATE diff bytes to RunPod.
- RunPod's official 2026 funding guidance describes an on-Pod shell
  `nohup sleep …; runpodctl stop pod $RUNPOD_POD_ID` timer.
  Reference: https://www.runpod.io/blog/manage-runpod-account-funding .
  The command is extra defense, **NOT** a provider-independent stop
  guarantee: OS crash, Pod/container termination, missing runpodctl or
  scheduling failure could prevent it from firing.

## New tested helper (not active)

`bench/runpod-gpu-pod-self-stop.sh` is meant to run only **inside**
the already-running, exact Pod `ao1z73um41h61i`. It has two modes:

```bash
# Inspect *on the correct Pod*, before doing anything chargeable:
RUNPOD_POD_ID=ao1z73um41h61i bash bench/runpod-gpu-pod-self-stop.sh --check
# ONLY with an independent provider stop and budget verification:
RUNPOD_POD_ID=ao1z73um41h61i bash bench/runpod-gpu-pod-self-stop.sh ARM-20M ao1z73um41h61i
```

The second mode starts an owner-directed `nohup` timer for **1200 seconds**
and calls `runpodctl stop pod ao1z73um41h61i`. The script never calls
`start`, `resume`, `create`, or any remote API itself, never reads API
tokens, and refuses foreign/missing Pod identity or wrong confirmation.
Success means only that a local timer was launched; the actual provider
STOPPED state must be checked via the separate, authenticated
`runpod-provider-stop.mjs` readback. Do not replace an authenticated
stop readback with this script's local success line.

## Required before any GPU spend

1. Confirm *all* month-to-date spend in RunPod Billing Explorer in
   EUR or with verified conversion, storage/network-volume charges,
   available balance, number of active Pods and exact current GPU tariff.
2. Establish an independent verified provider-side stop mechanism that
   still works if local SSH/ChatGPT/MSI disconnects. Pod-side `nohup`
   is a second defense, **not** sufficient alone. Prove it with
   provider-signed STOPPED status readback on an authorized trial.
3. Establish exact current Pod SSH endpoint, pinned verified host key,
   GPU and installed model identity; no public Ollama port. Use only
   existing PUBLIC fixed 12-scenario synthetic test and independent
   holdout first, not a private PR.
4. Test R135/R138 strict quality benchmark. Pass requires **5/5**
   real seeded bugs and **zero** false positives, with 100% GPU Ollama
   residency, quality+wall-time evidence and proper provider stop.
5. Only after independent security authorization for external private
   diff egress may protected production Reviewer B be designed to use
   the GPU. Keep GitHub App keys on Publisher and native review strictly
   COMMENTED; no auto HUMAN_GO or MERGE_GO.

## Evidence

`node --test test/runpod-gpu-pod-self-stop.test.mjs`: 5 PASS, 0 FAIL
against mock `runpodctl` and `nohup` (no cloud calls).
The full Publisher suite is tested separately. This work is added only to
draft PR #42 and must **not** be merged/promoted to protected main by
a synthetic benchmark result alone.
