# R147 — Exact Ollama GPU memory residency readback (PUBLIC holdout only)

## Scope
This is a synthetic-only extension to existing Publisher PR #42, not a
production model switch. Real protected Reviewer B stays on qwen2.5-coder:7b.
PR #926, the active reviewer job, GitHub Apps and all HUMAN_GO/MERGE_GO
policies are untouched.

## What is now checked
The existing strict known-host SSH tunnel is already in place before the
public 12-fixture synthetic holdout. After it completes, one read-only GET
to http://127.0.0.1:11434/api/ps checks the exact expected
qwen3.6:35b-a3b-coding model and Ollama-reported size_vram >= size.
It checks URL, JSON type, full bounded response, single model identity,
and safe integral memory metrics, failing closed on partial CPU offload.

A successful readback proves only Ollama's claim that the whole model is
resident in GPU VRAM at inspection time; it is NOT evidence of actual
CUDA kernel utilization, A6000 device identity, timing improvement,
quality, provider stop/billing, or private-source egress authorization.

The model must remain loaded via the existing public benchmark keep-alive.
The SSH process is still torn down on success or failure. No provider
Pod start or stop action is implemented.

## Remaining gates
A live RunPod Pod, authenticated complete monthly spend in EUR (<= 10),
independently enforced stop with provider readback, verified SSH host identity,
GPU and model identity, strict public holdout quality, distinct independent
security assessment, private-source egress authorization, and protected
Publisher policy review are necessary before changing production.

Tests: node --test test/runpod-gpu-residency.test.mjs
       node --test test/runpod-gpu-synthetic-ssh.test.mjs
       node --test
All tests are offline mocks and never start a billable GPU.
