#!/usr/bin/env bash
# Runs web/tests/oidc.spec.ts once per sign-in configuration, each against a
# fresh PocketBase (scripts/e2e-setup.sh) and the mock OIDC provider
# (scripts/mock-oidc.mjs). The password-only default is covered by the normal
# e2e run, which leaves E2E_AUTH unset.
# Usage: scripts/e2e-oidc.sh <path-to-pocketbase-binary>   (from the repo root, after `pnpm build`)
# Extra Playwright arguments: E2E_PW_ARGS="--headed" scripts/e2e-oidc.sh ./pocketbase
set -euo pipefail

PB="$1"

stop_pb() {
  if [ -f /tmp/pb_e2e.pid ]; then
    kill "$(cat /tmp/pb_e2e.pid)" 2>/dev/null || true
    rm -f /tmp/pb_e2e.pid
  fi
  for _ in $(seq 1 40); do curl -fs http://127.0.0.1:8090/api/health >/dev/null || return 0; sleep 0.25; done
  echo "PocketBase on :8090 did not stop" >&2
  return 1
}

node scripts/mock-oidc.mjs > /tmp/mock-oidc.log 2>&1 &
MOCK=$!
trap 'kill $MOCK 2>/dev/null || true; stop_pb || true' EXIT
for _ in $(seq 1 20); do curl -fs http://127.0.0.1:9099/.well-known/openid-configuration >/dev/null && break; sleep 0.25; done

OIDC=(OIDC_ISSUER=http://127.0.0.1:9099 OIDC_CLIENT_ID=shopapp OIDC_CLIENT_SECRET=shopapp-secret "OIDC_NAME=Test provider")

run_mode() {
  local mode=$1
  shift
  echo "=== sign-in mode: $mode ($*)"
  stop_pb
  env "$@" sh scripts/e2e-setup.sh "$PB"
  grep '\[sign-in\]' /tmp/pb_e2e.log || true
  (cd web && E2E_AUTH="$mode" pnpm exec playwright test ${E2E_PW_ARGS:-} tests/oidc.spec.ts)
}

run_mode both "${OIDC[@]}"
run_mode off "${OIDC[@]}" PASSWORD_LOGIN=off
run_mode guard PASSWORD_LOGIN=off
echo "all sign-in modes OK"
