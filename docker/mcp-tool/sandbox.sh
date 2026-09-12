#!/bin/sh
set -eu
# The outer container's seccomp profile permits unprivileged namespace setup.
# guest.bpf removes that permission again before any untrusted code executes.
# No /proc, /sys, host data, configuration directory, or credentials are exposed.
# The watchdog lives outside the guest PID namespace, so the guest cannot signal
# it or keep itself alive by continuously writing output. This also bounds a
# lost cancellation/connection to the client's existing 30-second I/O budget
# plus five seconds for setup/cleanup.
exec timeout -s KILL 35 bwrap \
  --unshare-all --unshare-user --die-with-parent --new-session --cap-drop ALL \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /bin /bin \
  --ro-bind /opt/mcp /opt/mcp \
  --dev /dev --size 33554432 --tmpfs /tmp --size 33554432 --tmpfs /work \
  --chdir /work --clearenv --setenv PATH /usr/local/bin:/usr/bin:/bin \
  --setenv HOME /work --setenv LANG C.UTF-8 \
  --seccomp 3 -- /opt/mcp/entrypoint 3</etc/myriad/guest.bpf
