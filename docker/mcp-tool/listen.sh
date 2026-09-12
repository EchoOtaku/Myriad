#!/bin/sh
set -eu
test -x /opt/mcp/entrypoint || { echo 'Missing reviewed /opt/mcp/entrypoint' >&2; exit 1; }
# Each accepted connection owns its bwrap parent. On EOF, socat exits after one
# second even if the guest refuses EOF/SIGTERM; bwrap's parent-death handling and
# private PID namespace then kill the entire guest process tree.
# Keepalive also bounds stale connections after an unclean peer/network failure.
exec socat -t1 \
  TCP4-LISTEN:4444,reuseaddr,fork,max-children=8,keepalive,keepidle=5,keepintvl=1,keepcnt=3 \
  EXEC:/usr/local/bin/myriad-mcp-sandbox
