#!/usr/bin/env bash
# Boot a disposable Postgres + backend, then run Playwright business smokes.
# Does not touch the operator's existing DATABASE_URL unless you export it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SMOKE_DIR="${MYRIAD_SMOKE_DIR:-$ROOT/.tmp/smoke}"
PG_NAME="${MYRIAD_SMOKE_PG_NAME:-myriad-smoke-pg}"
PG_PORT="${MYRIAD_SMOKE_PG_PORT:-55432}"
BACKEND_PORT="${MYRIAD_SMOKE_BACKEND_PORT:-1103}"
SETUP_SECRET="${MYRIAD_SETUP_SECRET:-smoke-setup-secret}"
JWT_SECRET="${JWT_SECRET:-smoke-jwt-key-abcdefghijklmnopqrstuvwxyz012}"

mkdir -p "$SMOKE_DIR/data" "$SMOKE_DIR/cache"
cleanup() {
    if [ -n "${BACKEND_PID:-}" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ "${MYRIAD_SMOKE_KEEP_PG:-}" != "1" ] && [ "${STARTED_PG:-}" = "1" ]; then
        docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

if [ -z "${DATABASE_URL:-}" ]; then
    if ! docker info >/dev/null 2>&1; then
        echo "smoke: docker is required to start a temporary Postgres" >&2
        exit 2
    fi
    docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
    docker run -d --name "$PG_NAME" \
        -e POSTGRES_DB=myriad_smoke \
        -e POSTGRES_USER=myriad \
        -e POSTGRES_PASSWORD=myriad_smoke \
        -p "${PG_PORT}:5432" \
        postgres:18-alpine >/dev/null
    STARTED_PG=1
    for _ in $(seq 1 40); do
        if docker exec "$PG_NAME" pg_isready -U myriad -d myriad_smoke >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    export DATABASE_URL="postgres://myriad:myriad_smoke@127.0.0.1:${PG_PORT}/myriad_smoke"
fi

export ENVIRONMENT="${ENVIRONMENT:-development}"
export JWT_SECRET
export MYRIAD_SETUP_SECRET="$SETUP_SECRET"
export DATA_DIR="$SMOKE_DIR/data"
export CACHE_DIR="$SMOKE_DIR/cache"
export SERVER_PORT="$BACKEND_PORT"
export RUST_LOG="${RUST_LOG:-warn}"

if [ -z "${MYRIAD_SMOKE_BACKEND_PID:-}" ]; then
    cargo run -p myriad-backend --quiet &
    BACKEND_PID=$!
    for _ in $(seq 1 90); do
        if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
            break
        fi
        if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
            echo "smoke: backend exited before /health" >&2
            exit 1
        fi
        sleep 1
    done
    curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null
fi

export MYRIAD_SMOKE_BASE_URL="http://127.0.0.1:${BACKEND_PORT}"
export MYRIAD_SETUP_SECRET="$SETUP_SECRET"
cd frontend
pnpm exec playwright test --config playwright.smoke.config.ts "$@"
