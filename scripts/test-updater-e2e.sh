#!/usr/bin/env bash
# =============================================================================
# Myriad updater + proxy end-to-end smoke test
# =============================================================================
# Spins up the release binaries against a self-contained testbed in /tmp.
# Verifies:
#   1. proxy /healthz, /_proxy/status
#   2. maintenance.json switch -> proxy serves the maintenance HTML
#   3. updater /healthz, /status
#   4. /admin/self-update (direct mode) returns 401 without token
#   5. updater rescue CLI status
#
# Does NOT verify the full update flow (would require a working release.json on
# GitHub + a real docker stack). For that, run a real `docker compose up -d` and
# trigger an update from the admin UI.
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TESTBED="${TESTBED:-/tmp/myriad-e2e}"
UPDATER_BIN="${UPDATER_BIN:-$ROOT/updater/target/release/myriad-updater}"
RESCUE_BIN="${RESCUE_BIN:-$ROOT/updater/target/release/myriad-rescue}"
PROXY_BIN="${PROXY_BIN:-$ROOT/proxy/target/release/myriad-proxy}"
UPDATER_PORT="${UPDATER_PORT:-19090}"
PROXY_PORT="${PROXY_PORT:-18080}"
# 32+ chars, no dictionary words (avoids weak-token check)
TOKEN="9xQ3vN8mP2rT5wY7zA1bC4dF6hJ8kL0n"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "${CYAN}== $1${NC}"; }
warn() { echo -e "${YELLOW}! $1${NC}"; }

UPDATER_PID=""
PROXY_PID=""
cleanup() {
    set +e
    [ -n "$UPDATER_PID" ] && kill "$UPDATER_PID" 2>/dev/null
    [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null
    # Wait briefly for processes to exit
    wait 2>/dev/null
}
trap cleanup EXIT

# Pre-flight: binaries must exist
[ -x "$UPDATER_BIN" ] || fail "updater binary missing: $UPDATER_BIN (run: cd updater && cargo build --release --bins)"
[ -x "$RESCUE_BIN" ]  || fail "rescue binary missing: $RESCUE_BIN"
[ -x "$PROXY_BIN" ]   || fail "proxy binary missing: $PROXY_BIN (run: cd proxy && cargo build --release)"

info "Preparing testbed at $TESTBED"
rm -rf "$TESTBED"
mkdir -p "$TESTBED"/{state,pgdata,backups}

# Minimal compose file referencing the required tag variables (probe needs this).
cat > "$TESTBED/compose.yaml" <<'YML'
services:
  postgres:
    image: postgres:16-alpine
  backend:
    image: example/myriad-backend:${MYRIAD_TAG}
  frontend:
    image: example/myriad-frontend:${MYRIAD_TAG}
  proxy:
    image: example/myriad-proxy:${PROXY_TAG}
  updater:
    image: example/myriad-updater:${UPDATER_TAG}
YML

cat > "$TESTBED/.env" <<EOF
MYRIAD_TAG=v0.0.0-e2e
PROXY_TAG=v0.0.0-e2e
UPDATER_TAG=v0.0.0-e2e
COMPOSE_PROJECT_NAME=myriad-e2e
POSTGRES_PASSWORD=e2etestpassword12345678901234567890
JWT_SECRET=e2etestjwtsecret12345678901234567890
CORS_ORIGINS=http://localhost
EOF

# Updater env (for `from_env` config loader)
export UPDATE_TOKEN="$TOKEN"
export CHANNEL="stable"
export MYRIAD_GITHUB_REPO="Myriad-You/Myriad"
export CHECK_INTERVAL_SECS=0   # disable periodic ticker for the test
export COMPOSE_PROJECT_NAME="myriad-e2e"

# pgdata: stub a layout that satisfies the probe (it just needs a directory)
mkdir -p "$TESTBED/pgdata/PG_VERSION_STUB"

# ============================================================================
# Start proxy first (so we can probe maintenance behavior independently)
# ============================================================================
info "Starting proxy on :$PROXY_PORT"
PROXY_LISTEN="0.0.0.0:$PROXY_PORT" \
PROXY_STATE_FILE="$TESTBED/state/maintenance.json" \
PROXY_BACKEND_UPSTREAM="http://127.0.0.1:65500" \
PROXY_FRONTEND_UPSTREAM="http://127.0.0.1:65501" \
PROXY_UPDATER_UPSTREAM="http://127.0.0.1:$UPDATER_PORT" \
PROXY_ALLOW_DIRECT_UPDATER=true \
  "$PROXY_BIN" >"$TESTBED/proxy.log" 2>&1 &
PROXY_PID=$!
sleep 1

# ============================================================================
# Start updater
# ============================================================================
info "Starting updater on :$UPDATER_PORT"
"$UPDATER_BIN" \
  --state-dir "$TESTBED/state" \
  --compose-dir "$TESTBED" \
  --env-file "$TESTBED/.env" \
  --pgdata "$TESTBED/pgdata" \
  --listen "0.0.0.0:$UPDATER_PORT" \
  >"$TESTBED/updater.log" 2>&1 &
UPDATER_PID=$!

# Wait for HTTP readiness
info "Waiting for services to be ready"
for i in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$PROXY_PORT/healthz" 2>/dev/null \
       && curl -fsS -o /dev/null "http://127.0.0.1:$UPDATER_PORT/healthz" 2>/dev/null; then
        break
    fi
    if [ "$i" = "30" ]; then
        echo "--- proxy.log ---"; tail -30 "$TESTBED/proxy.log"
        echo "--- updater.log ---"; tail -30 "$TESTBED/updater.log"
        fail "services did not become ready in 30s"
    fi
    sleep 0.3
done

# ============================================================================
# Tests
# ============================================================================
PASS=0
FAIL=0
run_check() {
    local label="$1"
    shift
    if "$@"; then
        ok "$label"; PASS=$((PASS+1))
    else
        warn "$label FAILED"; FAIL=$((FAIL+1))
    fi
}

# 1. proxy /healthz
check_proxy_health() {
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PROXY_PORT/healthz")
    [ "$code" = "200" ]
}
run_check "proxy /healthz returns 200" check_proxy_health

# 2. proxy /_proxy/status (no maintenance)
check_proxy_status_inactive() {
    local body active
    body=$(curl -fsS "http://127.0.0.1:$PROXY_PORT/_proxy/status")
    active=$(echo "$body" | jq -r '.maintenance.active')
    [ "$active" = "false" ]
}
run_check "proxy /_proxy/status reports inactive maintenance" check_proxy_status_inactive

# 3. updater /healthz
check_updater_health() {
    local code body
    body=$(curl -fsS "http://127.0.0.1:$UPDATER_PORT/healthz")
    [ "$(echo "$body" | jq -r '.ok')" = "true" ]
}
run_check "updater /healthz returns ok" check_updater_health

# 4. updater /status schema
check_updater_status() {
    local body
    body=$(curl -fsS "http://127.0.0.1:$UPDATER_PORT/status")
    # Must contain required fields per spec §13
    echo "$body" | jq -e '
        .schema_version == 1
        and (.updater_version | type) == "string"
        and (.channel | type) == "string"
        and (.maintenance_active | type) == "boolean"
        and (.maintenance_phase | type) == "string"
        and (.update_available | type) == "boolean"
        and (.requires_self_update | type) == "boolean"
    ' >/dev/null
}
run_check "updater /status returns spec-conformant shape" check_updater_status

# 5. updater /update without token returns 401
check_update_no_token() {
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' \
        -X POST "http://127.0.0.1:$UPDATER_PORT/update" \
        -H 'Content-Type: application/json' \
        -d '{"target_version":"v1.0.0"}')
    [ "$code" = "401" ]
}
run_check "POST /update without token returns 401" check_update_no_token

# 6. updater /update with token but invalid version → 400
check_update_bad_version() {
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' \
        -X POST "http://127.0.0.1:$UPDATER_PORT/update" \
        -H 'Content-Type: application/json' \
        -H "X-Update-Token: $TOKEN" \
        -d '{"target_version":"not-a-version"}')
    [ "$code" = "400" ]
}
run_check "POST /update with bad version returns 400" check_update_bad_version

# 7. proxy /_updater/* forwards when ALLOW_DIRECT_UPDATER=true
check_proxy_forwards_updater() {
    local body
    body=$(curl -fsS "http://127.0.0.1:$PROXY_PORT/_updater/healthz")
    [ "$(echo "$body" | jq -r '.ok')" = "true" ]
}
run_check "proxy /_updater/healthz forwards to updater" check_proxy_forwards_updater

# 8. Maintenance mode switch: write maintenance.json, proxy must serve maintenance page
check_maintenance_engages() {
    cat > "$TESTBED/state/maintenance.json" <<JSON
{
  "schema_version": 1,
  "active": true,
  "phase": "stopping",
  "from_version": "v0.1.0",
  "to_version": "v0.2.0",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "job_id": "e2e-job",
  "message_key": "updater.phase.stopping"
}
JSON
    sleep 0.3
    local code body
    code=$(curl -s -o /tmp/myriad-e2e-maintresp -w '%{http_code}' "http://127.0.0.1:$PROXY_PORT/")
    body=$(cat /tmp/myriad-e2e-maintresp)
    [ "$code" = "503" ] && echo "$body" | grep -q 'Myriad' && echo "$body" | grep -q 'maintenance'
}
run_check "maintenance mode serves 503 + maintenance HTML" check_maintenance_engages

# 9. maintenance OFF: clear file, proxy should fail open (forward, then get connection refused
#    because there is no real backend on 65500 — expecting 502)
check_maintenance_clears() {
    rm -f "$TESTBED/state/maintenance.json"
    sleep 0.3
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PROXY_PORT/")
    # 502 means proxy forwarded normally but upstream is unreachable (expected in this testbed)
    [ "$code" = "502" ]
}
run_check "maintenance OFF: proxy forwards (502 from missing upstream)" check_maintenance_clears

# 10. rescue CLI status
check_rescue_status() {
    "$RESCUE_BIN" --state-dir "$TESTBED/state" --pgdata "$TESTBED/pgdata" \
        --env-file "$TESTBED/.env" --compose-dir "$TESTBED" \
        status >/dev/null 2>&1
}
run_check "myriad-rescue status succeeds against testbed" check_rescue_status

# ============================================================================
# Summary
# ============================================================================
echo ""
if [ "$FAIL" -eq 0 ]; then
    ok "All $PASS checks passed"
    echo ""
    info "Testbed left at $TESTBED for inspection"
    info "Logs:"
    info "  $TESTBED/proxy.log"
    info "  $TESTBED/updater.log"
    exit 0
else
    fail "$FAIL/$((PASS+FAIL)) checks failed (see logs in $TESTBED/*.log)"
fi
