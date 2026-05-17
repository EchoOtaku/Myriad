#!/usr/bin/env bash
# Migrate an existing Myriad deployment to the updater-aware layout.
#
# Old layout:
#   - postgres_data named volume
#   - backend/frontend images pinned to :latest
#   - host port mapped on backend (3000) and frontend (4321)
#
# New layout (docs/updater-spec.md §19):
#   - ./pgdata bind mount (host-side directory)
#   - ./state, ./backups directories
#   - MYRIAD_TAG / PROXY_TAG / UPDATER_TAG / UPDATE_TOKEN / COMPOSE_PROJECT_NAME in .env
#   - proxy publishes the only host port (80)
#
# The script is idempotent: re-running on a partially migrated tree skips already-done steps.

set -euo pipefail

if [ "$(id -u)" -eq 0 ] && [ -z "${ALLOW_ROOT:-}" ]; then
  echo "refusing to run as root; rerun as the user that owns the compose directory (or set ALLOW_ROOT=1)" >&2
  exit 1
fi

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$COMPOSE_DIR"
echo "[migrate] working in $COMPOSE_DIR"

ENV_FILE="$COMPOSE_DIR/.env"
PGDATA_DIR="$COMPOSE_DIR/pgdata"
STATE_DIR="$COMPOSE_DIR/state"
BACKUP_DIR="$COMPOSE_DIR/backups"

OLD_VOLUME="${POSTGRES_OLD_VOLUME:-myriad_postgres_data}"

# Pin these to the latest known good versions; users can edit .env after migration.
DEFAULT_MYRIAD_TAG="${MYRIAD_TAG:-v0.1.0}"
DEFAULT_PROXY_TAG="${PROXY_TAG:-v0.1.0}"
DEFAULT_UPDATER_TAG="${UPDATER_TAG:-v0.1.0}"
DEFAULT_CHANNEL="${CHANNEL:-stable}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[migrate] missing required command: $1" >&2
    exit 2
  }
}

require docker
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "[migrate] neither docker compose nor docker-compose available" >&2
  exit 2
fi

step() {
  echo
  echo "==> $*"
}

confirm() {
  if [ -n "${YES:-}" ]; then
    return 0
  fi
  read -r -p "$1 [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ]
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 36 | tr -d '\n=' | tr '+/' '-_'
  else
    head -c 48 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_'
  fi
}

# ----- step 1: ensure .env exists with the new keys -----
step "Ensuring .env has updater-related keys"
touch "$ENV_FILE"
ensure_key() {
  local key="$1"
  local default="$2"
  if ! grep -qE "^${key}=" "$ENV_FILE"; then
    echo "${key}=${default}" >> "$ENV_FILE"
    echo "[migrate]  + appended ${key}"
  fi
}
ensure_key MYRIAD_TAG "$DEFAULT_MYRIAD_TAG"
ensure_key PROXY_TAG "$DEFAULT_PROXY_TAG"
ensure_key UPDATER_TAG "$DEFAULT_UPDATER_TAG"
ensure_key COMPOSE_PROJECT_NAME myriad
ensure_key CHANNEL "$DEFAULT_CHANNEL"
ensure_key MYRIAD_GITHUB_REPO somekawahitomi/myriad
ensure_key CHECK_INTERVAL_SECS 3600
ensure_key PROXY_ALLOW_DIRECT_UPDATER false
if ! grep -qE "^UPDATE_TOKEN=" "$ENV_FILE"; then
  token="$(generate_secret)"
  echo "UPDATE_TOKEN=${token}" >> "$ENV_FILE"
  echo "[migrate]  + generated UPDATE_TOKEN (saved in .env; keep this secret)"
fi

# ----- step 2: prepare directories -----
step "Creating state and backup directories"
mkdir -p "$STATE_DIR" "$STATE_DIR/snapshots" "$STATE_DIR/cache" "$BACKUP_DIR"

# ----- step 3: migrate named volume → bind mount -----
step "Migrating pgdata"
if [ -d "$PGDATA_DIR" ] && [ -n "$(ls -A "$PGDATA_DIR" 2>/dev/null)" ]; then
  echo "[migrate]  pgdata bind mount already populated; skipping"
else
  if ! docker volume inspect "$OLD_VOLUME" >/dev/null 2>&1; then
    echo "[migrate]  no existing volume '$OLD_VOLUME' found and no ./pgdata directory; nothing to migrate."
    echo "[migrate]  This is OK for fresh installs; the postgres container will initialize ./pgdata on first start."
    mkdir -p "$PGDATA_DIR"
  else
    if ! confirm "About to copy data from volume '$OLD_VOLUME' to ./pgdata. Continue?"; then
      echo "aborting" >&2
      exit 1
    fi
    echo "[migrate]  stopping any running containers from this project"
    "${COMPOSE[@]}" -p myriad down --remove-orphans || true
    mkdir -p "$PGDATA_DIR"
    docker run --rm \
      -v "${OLD_VOLUME}:/from" \
      -v "${PGDATA_DIR}:/to" \
      busybox sh -c 'cp -a /from/. /to/ && chown -R 999:999 /to'
    echo "[migrate]  copy complete"
  fi
fi

# ----- step 4: sanity-check .env duplicates -----
step "Checking .env for duplicate keys"
if awk -F= '/^[A-Z_][A-Z0-9_]*=/ {print $1}' "$ENV_FILE" | sort | uniq -d | grep -q .; then
  echo "[migrate]  duplicate keys detected in .env:" >&2
  awk -F= '/^[A-Z_][A-Z0-9_]*=/ {print $1}' "$ENV_FILE" | sort | uniq -d >&2
  echo "[migrate]  please dedupe before launching the updater" >&2
  exit 3
fi

# ----- step 5: print next steps -----
step "Done"
cat <<'EOF'

Migration complete. Next steps:

  1. Review your .env (especially the new keys). Adjust MYRIAD_TAG / PROXY_TAG /
     UPDATER_TAG to the versions you intend to run first.
  2. Pull all images:
       docker compose pull
  3. Bring up the stack:
       docker compose up -d
  4. The proxy now publishes the only host port (default 80). Adjust HTTP_PORT in
     .env if you need a different value, and remove any external port mappings you
     previously had on backend/frontend.
  5. Access the updater UI at:  http(s)://<host>/admin/updater
     UPDATE_TOKEN is in your .env.

If anything goes wrong, your previous postgres_data volume is still intact; you can
restore it by editing docker-compose.yml and switching back to the named volume.
EOF
