#!/bin/sh
set -eu
# Only loopback exists in this guest network namespace. The mounted Unix socket
# leads to the tool's allowlist proxy; ignoring HTTP_PROXY cannot open direct TCP.
if [ -S /run/mcp-egress/socket ]; then
  socat TCP4-LISTEN:8080,bind=127.0.0.1,reuseaddr,fork,max-children=8 UNIX-CONNECT:/run/mcp-egress/socket &
  export http_proxy=http://127.0.0.1:8080 https_proxy=http://127.0.0.1:8080
  export HTTP_PROXY="$http_proxy" HTTPS_PROXY="$https_proxy"
fi
exec /opt/mcp/entrypoint
