#!/usr/bin/env bash
# OFFLINE TEST ONLY. Always creates a new PostgreSQL 16 instance with Unix
# socket access under a private /tmp directory; NEVER touches Windows 5432.
set -euo pipefail
if [[ "$(uname -s)" != Linux ]]; then
  echo "REFUSED: Linux/WSL is required (Windows may contain a personal PG)." >&2
  exit 2
fi
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pg16bin="${SHADOW_PG16_BIN:-/usr/lib/postgresql/16/bin}"
initdb="$pg16bin/initdb"
pgctl="$pg16bin/pg_ctl"
if [[ ! -x "$initdb" || ! -x "$pgctl" ]]; then
  echo "REFUSED: no PostgreSQL 16 initdb/pg_ctl at $pg16bin" >&2
  exit 2
fi
if [[ "$("$pgctl" --version)" != *"PostgreSQL) 16."* ]]; then
  echo "REFUSED: binary is not PostgreSQL 16" >&2
  exit 2
fi
root="$(mktemp -d /tmp/devfactory-pg16-XXXXXXXX)"
chmod 700 "$root"
mkdir -m 700 "$root/socket"
started=0
cleanup() {
  local rc=$?
  trap - EXIT
  local stopped=1
  if [[ "$started" == 1 ]]; then
    if ! "$pgctl" -D "$root/data" -m immediate -w stop >/dev/null 2>&1; then
      stopped=0
      echo "WARNING: temporary server stop failed; preserve $root for inspection" >&2
    fi
  fi
  if [[ "$stopped" == 1 && "$root" == /tmp/devfactory-pg16-* ]]; then
    rm -rf -- "$root"
  fi
  exit "$rc"
}
trap cleanup EXIT
"$initdb" --no-instructions -D "$root/data" \
  --auth-local=trust --auth-host=reject >/dev/null
"$pgctl" -D "$root/data" -l "$root/server.log" -w \
  -o "-c listen_addresses='' -c unix_socket_directories=$root/socket -c unix_socket_permissions=0700 -c port=5432" \
  start >/dev/null
started=1
# The disposable role is created by initdb with the current WSL username.
# Auth-local trust is safe ONLY because directory/socket permissions are 0700.
npm install --prefix "$root/node-deps" \
  --no-save --ignore-scripts --no-audit --no-fund --silent pg@8.13.3
entry="$root/node-deps/node_modules/pg/lib/index.js"
test -f "$entry"
export SHADOW_POSTGRES_REAL=1
export SHADOW_PG_CLIENT_ENTRY="$entry"
export SHADOW_PG_ISOLATED_SOCKET="$root/socket"
export SHADOW_PG_EXPECTED_DATA_DIR="$root/data"
export SHADOW_PG_TEST_USER="$(id -un)"
node --test "$repo/test/openrouter-budget-atomic-postgres-real.test.mjs"
