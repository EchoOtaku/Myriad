# MCP gateway deployment

Production uses one operator-configured Streamable HTTP endpoint. Local stdio is
blocked in production; an unavailable gateway never enables a local fallback.
Use **one enabled `gateway` definition** for the aggregate tool collection.
Definition IDs are labels, not remote server selectors; the API does not enforce
this one-entry convention. Keep `trust_annotations` false by default.

## Fixed offline tool containers

The [Compose example](examples/docker-compose.mcp-gateway.example.yml) pins Docker
MCP Gateway v0.43.3 and uses its existing `--static` transport. A fixed, reviewed
tool container supplies stdio over its private TCP listener. **Neither service
receives a Docker socket.** The gateway does not create sibling containers.

The [tool image instructions](../../docker/mcp-tool/README.md) explain the base
image, required operator variables and limits. Build a derived image with the
reviewed executable at `/opt/mcp/entrypoint`, validate Compose, and start the two
services. Tool health must pass before gateway discovery. Each connection runs
inside bubblewrap with private filesystem/process/network namespaces; CPU,
memory, swap, PID and tmpfs limits bound the enclosing container and guest.
This deployment supports **offline, stateless tools**. Hosts must support
unprivileged user namespaces; denied setup fails closed. Compatibility with
other Linux/AppArmor host policies must be checked on the target host.

1. Build the reviewed tool image and set `MCP_TOOL_IMAGE`, `MCP_CATALOG_FILE`,
   `MCP_SECCOMP_PROFILE`, and a dedicated `MCP_GATEWAY_AUTH_TOKEN` as documented
   beside the base image. Supply no Myriad data, host/JWT/updater secrets or TAPP
   credentials to either image or the tool environment.
2. Run `docker compose config --quiet`, then `docker compose up -d`. Check `/health`
   and that an unauthenticated `/mcp` request returns 401. The published listener
   binds only `127.0.0.1:8811`. Expose `/mcp` through HTTPS/private ingress reachable
   by persona, preserving Authorization, MCP session/protocol headers and streaming.
3. Set `MYRIAD_MCP_GATEWAY_URL` to that `/mcp` endpoint and
   `MYRIAD_MCP_GATEWAY_TOKEN` to its dedicated token **only in persona's deployment**,
   then recreate persona. The token must have at least 32 printable non-space ASCII
   characters. It is never returned by configuration APIs.
4. Disable old stdio entries individually through the existing configuration API/UI,
   then enable one aggregate definition:

   ```json
   {"id":"isolated-tools","transport":"gateway","enabled":true,"trust_annotations":false}
   ```

   Confirm discovery matches the reviewed catalog. Disable the definition if
   discovery fails; correct the external deployment before re-enabling it.
5. For code/credential/catalog changes, disable the definition, stop the affected
   tool container, update/recreate it, and restart gateway discovery before enabling
   it again. Attention changes alone do not authorize destroying unrelated work.

The gateway disables dynamic management tools, ambient config/secret providers,
call logging and live catalog reload. Its token stays in the gateway, outside the
untrusted guest. The guest sees only read-only executable dependencies, minimal
`/dev`, two bounded tmpfs directories, and PATH/HOME/LANG. It cannot reach the
network or `/proc`, create/enter additional namespaces, or signal its watchdog.
No privileged mode, additional capabilities or unconfined seccomp profile is used.

## Destruction and tested limits

Connection teardown destroys the untrusted guest process tree, including detached
`setsid` descendants. The fixed trusted listener/container persists. A watchdog
outside the guest PID namespace caps its lifetime at 35 seconds, including startup;
allow up to five additional seconds for protocol teardown. Continuing stdout does
not reset this deadline. Myriad removes a revoked actor's routing immediately and
sends cancellation/session DELETE with a bounded best-effort cleanup budget.

HTTP cancellation alone cannot attest arbitrary remote execution. These destruction
claims apply to this fixed deployment, not to an independently operated endpoint.
Do not remove its watchdog or switch to dynamic Docker execution: testing the
upstream dynamic mode reproduced surviving sibling containers after DELETE and
SIGKILL of the gateway, which is why that candidate was rejected.

Run the actual container acceptance test (requires Docker, Python 3.9+, and an
unused localhost port 8811):

```sh
python3 docker/mcp-tool/tests/integration.py
python3 -m unittest discover -s docker/mcp-tool -p 'test_*.py'
```

The test builds a bounded adversarial fixture, creates uniquely named containers
with fake credentials, records redacted logs/results in a temporary directory, and
removes its containers, networks, volumes and image tags afterward. It checks:

- unauthenticated 401, real initialize/discovery/tool calls, UID 65534 and no token;
- read-only filesystem, absent host configuration/proc, denied network and namespace
  syscalls, 64 PIDs, 256 MiB memory including swap, no host mounts or capabilities;
- fork limit, 32 MiB disk exhaustion, cgroup OOM and subsequent recovery;
- resistant descendants, cancellation, DELETE without cancellation, and gateway kill.

Docker Desktop Engine 29.6.2 on arm64 passed these cases on 2026-09-12. The guest
seccomp filter also has instruction-level tests for x86_64; actual x86_64 container
execution is not covered by this run. Shared-host and shared-database availability
is documented separately in [runtime isolation](RUNTIME_ISOLATION.md).

## Upstream implementation references

The pinned implementation supplies the existing static transport and authentication:
[gateway flags](https://github.com/docker/mcp-gateway/blob/v0.43.3/cmd/docker-mcp/commands/gateway.go),
[client pool](https://github.com/docker/mcp-gateway/blob/v0.43.3/pkg/gateway/clientpool.go),
[authentication](https://github.com/docker/mcp-gateway/blob/v0.43.3/pkg/gateway/auth.go).
The base image records the exact Moby seccomp profile provenance and license.
