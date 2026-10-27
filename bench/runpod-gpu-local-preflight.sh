#!/usr/bin/env bash
# Run INSIDE an owner-authorized GPU Pod. Zero private diff, zero cloud API.
# No sudo, install, Pod resume/stop, outgoing inference, or credentials.
set -euo pipefail
MODEL='qwen3.6:35b-a3b-coding'
export OLLAMA_HOST='127.0.0.1:11434'
export OLLAMA_NO_CLOUD=1
for binary in curl ollama nvidia-smi sha256sum; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    echo "GPU_PREFLIGHT_MISSING_DEPENDENCY"
    exit 2
  fi
done
if ! nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits |
  grep -F 'RTX A6000' >/dev/null; then
  echo "GPU_PREFLIGHT_GPU_MISMATCH"
  exit 3
fi
if ! curl --noproxy '*' --fail --silent --show-error --max-time 3 \
  'http://127.0.0.1:11434/api/tags' >/dev/null; then
  echo "GPU_PREFLIGHT_LOOPBACK_UNAVAILABLE"
  exit 4
fi
if ! ollama list | grep -F "$MODEL" >/dev/null; then
  echo "GPU_PREFLIGHT_MODEL_NOT_INSTALLED"
  exit 5
fi
if [[ "${NODE_BIN:-}" == "" || ! -x "${NODE_BIN:-}" ]]; then
  echo "GPU_PREFLIGHT_PORTABLE_NODE_NOT_READY"
  exit 6
fi
if ! "$NODE_BIN" --version | grep -E '^v24\.' >/dev/null; then
  echo "GPU_PREFLIGHT_NODE_VERSION_NOT_PINNED"
  exit 7
fi
echo 'GPU_PREFLIGHT_LOCAL_GPU_AND_MODEL_READY'
echo 'GPU_PREFLIGHT_NO_PRIVATE_SOURCE_OR_API_KEY_USED'
# After benchmarking, the operator MUST check that ollama ps shows 100% GPU
# residency. A reachable model alone does not prove GPU utilization.
