#!/bin/bash
# =============================================================================
# Myriad Docker Unified Deployment Script
# =============================================================================
# Brings up the full stack (proxy + frontend + backend + postgres + updater)
# defined in docker-compose.yml.
#
# This script wraps docker compose with a few conveniences:
#   - On first run, copies .env.production.example -> .env
#   - Ensures current production directories and updater env keys exist
#   - Provides quick subcommands: up / down / restart / logs / status / pull
#
# After this script bootstraps the stack, normal day-to-day operation is the
# admin UI -> 设置/关于 -> Update Management. See docs/UPDATER_QUICKSTART.md.
# =============================================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}$1${NC}"; }
info() { echo -e "${CYAN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
err()  { echo -e "${RED}$1${NC}"; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

COMMAND="${1:-up}"

show_usage() {
    cat <<EOF
Usage: $0 [command]

Commands:
  up        (default) Initialise .env / pgdata if needed, then \`docker compose up -d\`
  down      Stop and remove containers (volumes preserved)
  restart   docker compose restart
  pull      Pull images pinned by .env tags
  logs      docker compose logs -f
  status    docker compose ps + image versions
  doctor    Read-only topology / security checks (docker-guard, sock mounts, cosign)
  upgrade   Pull images pinned by .env tags + recreate (manual upgrade path)
  help      Show this help

Notes:
  - This script only handles bootstrap. Normal updates run through the admin UI.
  - To switch versions, edit MYRIAD_TAG / UPDATER_TAG / PROXY_TAG in .env then
    run \`$0 upgrade\`.
  - Optional host audit (privileged / docker.sock binds):
      bash scripts/security/docker-audit-example.sh scan

Examples:
  $0                 # Bootstrap + start
  $0 down            # Stop
  $0 status          # See running versions
  $0 doctor          # Topology security checks
  $0 upgrade         # After editing .env, recreate with new tags
EOF
}

detect_compose() {
    if docker compose version >/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
    else
        err "✗ neither \`docker compose\` v2 nor \`docker-compose\` v1 is available"
        exit 2
    fi
}

generate_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -base64 36 | tr -d '\n=' | tr '+/' '-_'
    else
        head -c 48 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_'
    fi
}

ensure_key() {
    local key="$1"
    local default="$2"
    if ! grep -qE "^${key}=" .env 2>/dev/null; then
        echo "${key}=${default}" >> .env
        info "  + appended ${key}"
    fi
}

ensure_update_token() {
    if grep -qE "^UPDATE_TOKEN=.+" .env 2>/dev/null; then
        return 0
    fi

    local token
    token="$(generate_secret)"
    if grep -qE "^UPDATE_TOKEN=" .env 2>/dev/null; then
        local tmp=".env.tmp.$$"
        awk -v token="$token" '
          BEGIN { replaced = 0 }
          /^UPDATE_TOKEN=/ && replaced == 0 {
            print "UPDATE_TOKEN=" token
            replaced = 1
            next
          }
          { print }
        ' .env > "$tmp"
        mv "$tmp" .env
        info "  + filled empty UPDATE_TOKEN"
    else
        echo "UPDATE_TOKEN=${token}" >> .env
        info "  + appended UPDATE_TOKEN"
    fi
}

ensure_env() {
    if [ ! -f .env ]; then
        if [ ! -f .env.production.example ]; then
            err "✗ Missing both .env and .env.production.example; cannot bootstrap"
            exit 2
        fi
        warn ".env not found — copying from .env.production.example"
        cp .env.production.example .env
        warn ""
        warn "Edit .env now and set at minimum:"
        warn "  - POSTGRES_PASSWORD (openssl rand -base64 32)"
        warn "  - JWT_SECRET        (openssl rand -base64 32)"
        warn "  - CORS_ORIGINS      (your domain)"
        warn ""
        warn "This script will create pgdata/state/backups and fill an empty UPDATE_TOKEN."
        warn ""
        read -r -p "Open .env in \$EDITOR now? (y/N): " r
        if [[ "$r" =~ ^[Yy]$ ]]; then
            ${EDITOR:-nano} .env
        fi
    fi
}

ensure_current_layout() {
    info "==> Ensuring current proxy + updater layout"
    mkdir -p pgdata state state/snapshots state/cache backups
    ensure_key MYRIAD_TAG v0.2.3
    ensure_key PROXY_TAG v0.2.3
    ensure_key UPDATER_TAG v0.2.3
    ensure_key BACKEND_IMAGE docker.io/somekawahitomi/myriad-backend
    ensure_key FRONTEND_IMAGE docker.io/somekawahitomi/myriad-frontend
    ensure_key COMPOSE_PROJECT_NAME myriad
    ensure_key CHANNEL stable
    ensure_key UPDATE_MODE release
    ensure_key MYRIAD_GITHUB_REPO Myriad-You/Myriad
    ensure_key CHECK_INTERVAL_SECS 3600
    ensure_key PROXY_ALLOW_DIRECT_UPDATER false
    ensure_update_token
}

# Backend runs as uid 1000 (USER myriad). Named volumes are root-owned on first
# create; chown so /app/cache and /app/data stay writable without forcing root.
ensure_backend_volume_perms() {
    local project
    project="$(grep -E '^COMPOSE_PROJECT_NAME=' .env 2>/dev/null | head -1 | cut -d= -f2-)"
    project="${project:-myriad}"
    # Strip optional quotes
    project="${project%\"}"
    project="${project#\"}"
    project="${project%\'}"
    project="${project#\'}"

    local cache_vol="${project}_backend_cache"
    local data_vol="${project}_backend_data"

    info "==> Ensuring backend named volumes writable by uid 1000 (myriad)"
    docker volume create "$cache_vol" >/dev/null
    docker volume create "$data_vol" >/dev/null
    if ! docker run --rm \
        -v "${cache_vol}:/app/cache" \
        -v "${data_vol}:/app/data" \
        alpine:3.20 \
        chown -R 1000:1000 /app/cache /app/data
    then
        warn "Could not chown backend volumes (docker run alpine failed)."
        warn "If backend cannot write /app/cache or /app/data, run as host admin:"
        warn "  docker run --rm -v ${cache_vol}:/app/cache -v ${data_vol}:/app/data alpine:3.20 chown -R 1000:1000 /app/cache /app/data"
    fi
}

cmd_up() {
    ensure_env
    ensure_current_layout
    ensure_backend_volume_perms
    info "==> docker compose up -d"
    $COMPOSE up -d
    echo ""
    ok "Stack started. Access via http://localhost:${HTTP_PORT:-80}/"
    ok "Admin UI: http://localhost:${HTTP_PORT:-80}/  → 设置 → 关于 → 更新管理"
}

cmd_down() {
    info "==> docker compose down (volumes preserved)"
    $COMPOSE down
}

cmd_restart() {
    info "==> docker compose restart"
    $COMPOSE restart
}

cmd_pull() {
    info "==> docker compose pull"
    $COMPOSE pull
}

cmd_logs() {
    $COMPOSE logs -f --tail=200
}

cmd_status() {
    $COMPOSE ps
    echo ""
    info "Image versions in use:"
    $COMPOSE images 2>/dev/null || $COMPOSE ps --format "table {{.Service}}\t{{.Image}}"
}

# Read-only topology checks. Does not migrate or restart services.
# Expected: docker-guard holds docker.sock; updater does not.
cmd_doctor() {
    local fail=0
    local skip=0
    info "==> Deploy topology doctor (read-only)"

    container_exists() {
        docker inspect "$1" >/dev/null 2>&1
    }

    container_mounts_sock() {
        # Match Source or Destination containing docker.sock
        docker inspect -f '{{range .Mounts}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' "$1" 2>/dev/null \
            | grep -q 'docker\.sock'
    }

    container_health() {
        docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null \
            || echo "unknown"
    }

    # --- docker-guard ---
    if container_exists myriad-docker-guard; then
        ok "PASS  myriad-docker-guard container exists"
        local gh
        gh="$(container_health myriad-docker-guard)"
        case "$gh" in
            healthy|running)
                ok "PASS  docker-guard status=$gh"
                ;;
            *)
                err "FAIL  docker-guard status=$gh (expected healthy or running)"
                fail=$((fail + 1))
                ;;
        esac
        if container_mounts_sock myriad-docker-guard; then
            ok "PASS  docker-guard mounts docker.sock"
        else
            err "FAIL  docker-guard does not mount docker.sock"
            fail=$((fail + 1))
        fi
    else
        err "FAIL  myriad-docker-guard not found (stack down or legacy pre-guard topology)"
        fail=$((fail + 1))
    fi

    # --- updater: must NOT mount docker.sock ---
    if container_exists myriad-updater; then
        ok "PASS  myriad-updater container exists"
        if container_mounts_sock myriad-updater; then
            err "FAIL  myriad-updater mounts docker.sock (legacy layout — sock should only be on docker-guard)"
            fail=$((fail + 1))
        else
            ok "PASS  myriad-updater does not mount docker.sock"
        fi
    else
        warn "SKIP  myriad-updater not running"
        skip=$((skip + 1))
    fi

    # --- .env cosign dual-key (optional, when file present) ---
    if [ -f .env ]; then
        local cosign_raw cosign_lc direct direct_lc
        cosign_raw="$(grep -E '^COSIGN_VERIFY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"'" || true)"
        cosign_raw="${cosign_raw:-strict}"
        cosign_lc="$(printf '%s' "$cosign_raw" | tr '[:upper:]' '[:lower:]')"
        case "$cosign_lc" in
            off|false|0)
                if grep -qiE '^(UPDATER_ALLOW_INSECURE_COSIGN|COSIGN_INSECURE_OK)=(true|1|yes|on)[[:space:]]*$' .env 2>/dev/null; then
                    warn "WARN  COSIGN_VERIFY=$cosign_raw with insecure allow key set (supply-chain risk)"
                else
                    err "FAIL  COSIGN_VERIFY=$cosign_raw without UPDATER_ALLOW_INSECURE_COSIGN=true (updater refuses to start)"
                    fail=$((fail + 1))
                fi
                ;;
            soft|warn)
                warn "WARN  COSIGN_VERIFY=$cosign_raw (prefer strict for production)"
                ;;
            *)
                ok "PASS  COSIGN_VERIFY=$cosign_raw"
                ;;
        esac

        direct="$(grep -E '^PROXY_ALLOW_DIRECT_UPDATER=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"'" || true)"
        direct_lc="$(printf '%s' "${direct:-false}" | tr '[:upper:]' '[:lower:]')"
        case "$direct_lc" in
            true|1|yes|on)
                warn "WARN  PROXY_ALLOW_DIRECT_UPDATER=$direct (rescue path; keep false for normal ops)"
                ;;
            *)
                ok "PASS  PROXY_ALLOW_DIRECT_UPDATER=${direct:-false}"
                ;;
        esac
    else
        warn "SKIP  .env not found (cosign / direct-updater checks)"
        skip=$((skip + 1))
    fi

    echo ""
    info "Optional host audit (not run automatically):"
    info "  bash scripts/security/docker-audit-example.sh scan"
    info "  bash scripts/security/docker-audit-example.sh events"
    echo ""
    if [ "$fail" -gt 0 ]; then
        err "Doctor: $fail check(s) failed (skip=$skip). Fix topology; this command does not auto-migrate."
        return 1
    fi
    ok "Doctor: all checks passed (skip=$skip)."
    return 0
}

cmd_upgrade() {
    ensure_env
    ensure_backend_volume_perms
    info "==> docker compose pull"
    $COMPOSE pull
    info "==> docker compose up -d (recreate with new tags)"
    $COMPOSE up -d
    ok "Upgrade complete. Verify with: $0 status"
}

COMPOSE=$(detect_compose)

case "$COMMAND" in
    up)       cmd_up ;;
    down)     cmd_down ;;
    restart)  cmd_restart ;;
    pull)     cmd_pull ;;
    logs)     cmd_logs ;;
    status)   cmd_status ;;
    doctor)   cmd_doctor ;;
    upgrade)  cmd_upgrade ;;
    help|-h|--help) show_usage ;;
    *) err "Unknown command: $COMMAND"; show_usage; exit 1 ;;
esac
