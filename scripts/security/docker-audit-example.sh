#!/usr/bin/env bash
# =============================================================================
# Example host-side Docker audit helpers for Myriad operators.
#
# These are **documentation / optional tooling**, not required by compose.
# They help spot unexpected privileged containers or docker.sock bind mounts
# on a self-hosted node.
#
# Usage:
#   bash scripts/security/docker-audit-example.sh events    # stream (Ctrl-C)
#   bash scripts/security/docker-audit-example.sh scan      # one-shot inspect
# =============================================================================

set -euo pipefail

cmd="${1:-scan}"

case "$cmd" in
  events)
    echo "==> Streaming docker events (container create/start) — Ctrl-C to stop"
    echo "    Look for Privileged=true or Binds containing docker.sock"
    # Filter to container lifecycle; inspect details still require follow-up.
    docker events \
      --filter 'type=container' \
      --filter 'event=create' \
      --filter 'event=start' \
      --format '{{.Time}} {{.Action}} {{.Actor.Attributes.name}} image={{.Actor.Attributes.image}}'
    ;;

  scan)
    echo "==> Containers with Privileged=true"
    docker ps -aq | while read -r id; do
      [ -z "$id" ] && continue
      priv="$(docker inspect -f '{{.HostConfig.Privileged}}' "$id" 2>/dev/null || echo false)"
      if [ "$priv" = "true" ]; then
        docker inspect -f '{{.Name}} image={{.Config.Image}} privileged=true' "$id"
      fi
    done

    echo ""
    echo "==> Containers binding docker.sock"
    docker ps -aq | while read -r id; do
      [ -z "$id" ] && continue
      binds="$(docker inspect -f '{{range .HostConfig.Binds}}{{println .}}{{end}}{{range .Mounts}}{{if eq .Type "bind"}}{{println .Source "->" .Destination}}{{end}}{{end}}' "$id" 2>/dev/null || true)"
      if echo "$binds" | grep -q 'docker.sock'; then
        name="$(docker inspect -f '{{.Name}}' "$id")"
        image="$(docker inspect -f '{{.Config.Image}}' "$id")"
        echo "$name image=$image"
        echo "$binds" | grep 'docker.sock' | sed 's/^/  /'
      fi
    done

    echo ""
    echo "==> Expected for current Myriad topology"
    echo "  - myriad-docker-guard: may bind /var/run/docker.sock (only socket holder)"
    echo "  - myriad-updater: should NOT bind docker.sock (uses DOCKER_HOST=tcp://docker-guard:2375)"
    echo "  - no Myriad service should run Privileged=true"
    ;;

  help|-h|--help)
    cat <<'EOF'
Usage: docker-audit-example.sh [scan|events|help]

  scan    One-shot: list privileged containers and docker.sock binds
  events  Stream container create/start events (manual follow-up)
  help    This text

Not installed as a compose service. Safe to run on the Docker host as an admin.
EOF
    ;;

  *)
    echo "Unknown command: $cmd (try: scan | events | help)" >&2
    exit 1
    ;;
esac
