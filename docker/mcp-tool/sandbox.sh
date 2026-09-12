#!/bin/sh
set -eu
# The outer container's seccomp profile permits unprivileged namespace setup.
# guest.bpf removes that permission again before any untrusted code executes.
# No /proc, /sys, host data, configuration directory, or credentials are exposed.
# The watchdog lives outside the guest PID namespace, so the guest cannot signal
# it or keep itself alive by continuously writing output. This also bounds a
# lost cancellation/connection to the client's existing 30-second I/O budget
# plus five seconds for setup/cleanup.
set --
if [ "${MCP_PERSIST_STATE:-false}" = true ]; then
  set -- "$@" --bind /var/lib/mcp-state /state
fi
if [ "${MCP_NETWORK:-offline}" = proxy ]; then
  set -- "$@" --ro-bind /tmp/mcp-egress /run/mcp-egress \
    --ro-bind /etc/ssl/certs /etc/ssl/certs --ro-bind /etc/ssl/cert.pem /etc/ssl/cert.pem
fi
exec timeout -s KILL 35 bwrap \
  --unshare-all --unshare-user --die-with-parent --new-session --cap-drop ALL \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /bin /bin \
  --ro-bind /opt/mcp /opt/mcp \
  --dev /dev --size 33554432 --tmpfs /tmp --size 33554432 --tmpfs /work \
  --chdir /work --clearenv --setenv PATH /usr/local/bin:/usr/bin:/bin \
  --setenv HOME /work --setenv LANG C.UTF-8 \
  "$@" --seccomp 3 -- /usr/local/bin/myriad-mcp-guest 3</etc/myriad/guest.bpf
