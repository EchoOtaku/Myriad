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
  upgrade   Pull images pinned by .env tags + recreate (manual upgrade path)
  help      Show this help

Notes:
  - This script only handles bootstrap. Normal updates run through the admin UI.
  - To switch versions, edit MYRIAD_TAG / UPDATER_TAG / PROXY_TAG in .env then
    run \`$0 upgrade\`.

Examples:
  $0                 # Bootstrap + start
  $0 down            # Stop
  $0 status          # See running versions
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
    ensure_key MYRIAD_TAG v0.2.0
    ensure_key PROXY_TAG v0.2.0
    ensure_key UPDATER_TAG v0.2.0
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

cmd_up() {
    ensure_env
    ensure_current_layout
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

cmd_upgrade() {
    ensure_env
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
    upgrade)  cmd_upgrade ;;
    help|-h|--help) show_usage ;;
    *) err "Unknown command: $COMMAND"; show_usage; exit 1 ;;
esac
