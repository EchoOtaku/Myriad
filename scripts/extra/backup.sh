#!/usr/bin/env bash
# Site disaster backup / restore: PostgreSQL + backend_data + .env.
# Does not include regenerable cache volumes. Updater ./pgdata snapshots are
# not a substitute for this backup.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}$1${NC}"; }
info() { echo -e "${CYAN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
err()  { echo -e "${RED}$1${NC}"; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

COMMAND="${1:-}"
shift || true

env_file_value() {
    local key="$1"
    [ -f .env ] || return 0
    grep -E "^${key}=" .env 2>/dev/null | head -1 | cut -d= -f2-
}

compose_bin() {
    if docker compose version >/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
    else
        err "neither docker compose nor docker-compose is available"
        exit 1
    fi
}

project_name() {
    local project="${COMPOSE_PROJECT_NAME:-}"
    [ -z "$project" ] && project="$(env_file_value COMPOSE_PROJECT_NAME)"
    [ -z "$project" ] && project="myriad"
    printf '%s' "$project"
}

compose() {
    local kind
    kind="$(compose_bin)"
    # shellcheck disable=SC2086
    $kind --env-file .env -p "$(project_name)" "$@"
}

data_volume() {
    printf '%s_backend_data' "$(project_name)"
}

show_usage() {
    cat <<EOF
Usage: $0 <backup|restore> [options]

  backup [--out DIR] [--no-stop]
      Dump Postgres, archive the backend_data volume, and copy .env.
      Stops backend briefly unless --no-stop is set. Excludes cache.

  restore --from DIR [--no-stop]
      Restore Postgres, backend_data, and .env from a backup directory.
      Destructive. Stops backend unless --no-stop is set.

Notes:
  - Updater file-level ./pgdata snapshots are rollback material, not this backup.
  - Secrets are copied as files; this script never prints .env values.
  - cache / backend_cache is omitted on purpose (regenerable).
EOF
}

stamp_dir() {
    local dest="${BACKUP_OUT:-$ROOT/backups}"
    mkdir -p "$dest"
    printf '%s/myriad-%s' "$dest" "$(date +%Y%m%d_%H%M%S)"
}

do_backup() {
    local out="" no_stop=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --out) out="$2"; shift 2 ;;
            --no-stop) no_stop=1; shift ;;
            *) err "unknown option: $1"; exit 1 ;;
        esac
    done
    [ -f .env ] || { err ".env is missing; refuse to backup without deploy secrets"; exit 1; }
    [ -n "$out" ] || out="$(stamp_dir)"
    mkdir -p "$out"
    chmod 700 "$out"

    info "==> backup directory $out"
    if [ "$no_stop" -eq 0 ]; then
        info "==> stopping backend to quiesce writes"
        compose stop backend || warn "backend was not running"
    else
        warn "backend left running; dump may be crash-consistent only"
    fi

    info "==> PostgreSQL dump"
    compose exec -T postgres pg_dump -U myriad -d myriad -Fc > "$out/postgres.dump"
    chmod 600 "$out/postgres.dump"

    local volume
    volume="$(data_volume)"
    info "==> backend_data volume ($volume)"
    docker run --rm \
        -v "${volume}:/data:ro" \
        -v "$out:/out" \
        alpine:3.20 \
        tar czf /out/backend_data.tar.gz -C /data .
    chmod 600 "$out/backend_data.tar.gz"

    umask 077
    cp .env "$out/env"
    chmod 600 "$out/env"

    cat > "$out/MANIFEST.txt" <<EOF
created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
project=$(project_name)
includes=postgres.dump backend_data.tar.gz env
excludes=backend_cache ./pgdata (updater rollback only)
EOF
    chmod 600 "$out/MANIFEST.txt"

    if [ "$no_stop" -eq 0 ]; then
        info "==> starting backend"
        compose start backend || warn "could not start backend; start it with scripts/extra/deploy.sh"
    fi
    ok "backup complete: $out"
}

do_restore() {
    local from="" no_stop=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --from) from="$2"; shift 2 ;;
            --no-stop) no_stop=1; shift ;;
            *) err "unknown option: $1"; exit 1 ;;
        esac
    done
    [ -n "$from" ] || { err "--from DIR is required"; exit 1; }
    [ -f "$from/postgres.dump" ] || { err "missing $from/postgres.dump"; exit 1; }
    [ -f "$from/backend_data.tar.gz" ] || { err "missing $from/backend_data.tar.gz"; exit 1; }
    [ -f "$from/env" ] || { err "missing $from/env"; exit 1; }

    if [ "$no_stop" -eq 0 ]; then
        info "==> stopping backend"
        compose stop backend || warn "backend was not running"
    fi

    info "==> restoring .env (previous file kept as .env.bak.restore)"
    if [ -f .env ]; then
        cp .env ".env.bak.restore"
        chmod 600 ".env.bak.restore"
    fi
    umask 077
    cp "$from/env" .env
    chmod 600 .env

    info "==> restoring PostgreSQL"
    compose exec -T postgres pg_restore -U myriad -d myriad --clean --if-exists < "$from/postgres.dump"

    local volume
    volume="$(data_volume)"
    info "==> restoring backend_data ($volume)"
    docker run --rm \
        -v "${volume}:/data" \
        -v "$from:/in:ro" \
        alpine:3.20 \
        sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null; tar xzf /in/backend_data.tar.gz -C /data'

    if [ "$no_stop" -eq 0 ]; then
        info "==> starting backend"
        compose start backend || warn "could not start backend; start it with scripts/extra/deploy.sh"
    fi
    ok "restore complete from $from"
}

case "$COMMAND" in
    backup) do_backup "$@" ;;
    restore) do_restore "$@" ;;
    help|-h|--help|"") show_usage ;;
    *) err "unknown command: $COMMAND"; show_usage; exit 1 ;;
esac
