# MCP gateway deployment candidate

Myriad's production MCP client uses one operator-configured Streamable HTTP
endpoint. Use **one enabled `gateway` definition** for that endpoint's aggregate
tool collection. Definition IDs are local labels, not remote server selectors;
adding another ID reconnects to the same tool collection. The current API does
not enforce this convention. Keep `trust_annotations` false unless the operator
has independently established that the server's risk descriptions are trustworthy.

## Smallest deployment to evaluate

The [standalone Compose example](examples/docker-compose.mcp-gateway.example.yml)
pins Docker MCP Gateway v0.43.3 by its published multi-platform image digest.
It is deliberately outside the Myriad Compose/updater topology. Run it on a
**dedicated host or VM and Docker daemon containing no Myriad workload, data,
credentials or administrator services**. Its Docker socket is a privileged
control interface; mounting the Myriad daemon's socket would defeat the boundary.
Constrain the VM's CPU, memory and disk at the hypervisor and deny its access to
Myriad's private networks. These are deployment requirements, not controls that
the sample Compose file can establish.

1. Install Docker Engine on that dedicated machine. Copy the example to an empty
   deployment directory as `compose.yml`.
2. Prepare a reviewed local catalog and set `MCP_CATALOG_FILE` to its absolute
   path. Set `MCP_SERVERS` to the exact comma-separated catalog names to expose.
   Start with offline servers: pin each image by verified digest, set
   `disableNetwork: true`, and supply no volumes, secrets, environment, network
   names, DNS overrides or links. The catalog shape is:

   ```yaml
   registry:
     approved:
       title: Approved offline tools
       type: server
       image: YOUR_REVIEWED_IMAGE@sha256:YOUR_VERIFIED_DIGEST
       disableNetwork: true
       user: "65534:65534"
   ```

   Replace the image placeholder with a real compatible stdio MCP server; the
   sample does not select or install third-party tools on the operator's behalf.
   The image must work as that unprivileged UID without host files. If it cannot,
   fix or replace the image before enabling it. Networked tools require a separate
   egress review and enforcement; do not simply drop `disableNetwork`.
3. Generate a dedicated random token of at least 32 non-space ASCII characters
   and provide it as `MCP_GATEWAY_AUTH_TOKEN` through a protected host environment
   or a mode-0600 `.env`. Do not reuse a Myriad JWT, updater secret or TAPP credential.
4. Run `docker compose config --quiet`, then `docker compose up -d`. Check the
   local `/health` and confirm unauthenticated `/mcp` requests return 401. The
   listener is published only on loopback. Expose `/mcp` through an authenticated
   HTTPS reverse proxy/private tunnel reachable by persona, preserving the
   Authorization and MCP session/protocol headers and streaming responses.
5. Set `MYRIAD_MCP_GATEWAY_URL` to that HTTPS `/mcp` endpoint and
   `MYRIAD_MCP_GATEWAY_TOKEN` to the same dedicated token **only in persona's
   deployment**, then recreate persona. Disable the old stdio definitions
   individually and enable the single aggregate definition:

   ```json
   {"id":"isolated-tools","transport":"gateway","enabled":true,"trust_annotations":false}
   ```

   Save through the existing MCP configuration UI/API so that actors are revoked
   normally. Verify that the entry becomes healthy and discovers the expected
   tools. If it fails, disable the entry and correct the gateway deployment.
   Production never falls back to local stdio when the gateway is down.

The explicit server list disables the gateway's dynamic server-management tools.
The example overrides the default Docker Desktop secret provider with `/dev/null`,
does not load ambient server configuration, disables call logging and live catalog
reload, and does not request privileged/DinD mode. Editing the catalog requires a
controlled restart. Do not pass host/TAPP credentials to third-party containers.

## What this does not prove

The gateway's child launch arguments apply CPU, memory and `no-new-privileges`
limits. They do **not** set a child PID limit, read-only root or capability drop.
The Compose service's limits apply to the gateway, not to sibling containers
created through the Docker socket. Consequently this candidate relies on the
separate machine as the outer resource and credential boundary; it is not approved
for hostile tools on the Myriad host.

Likewise, a Myriad cancellation/DELETE closes a remote protocol session; it is
not proof that every remote descendant was destroyed. The upstream SDK closes
stdin and eventually signals/kills its Docker CLI child. A server ignoring EOF
or signals needs real container fault testing. For removal/credential changes,
disable the Myriad definition first, stop the gateway, inspect and forcibly remove
remaining MCP containers on the dedicated daemon before re-enabling the revised
catalog. Stopping the gateway alone is insufficient evidence of destruction.

Native process fault testing has verified that an unavailable gateway produces a
failed MCP entry without local stdio fallback, while persona and web remain ready.
Killing persona with SIGKILL leaves web's readiness and public configuration API
available; persona restarts independently with the gateway still offline. These
checks used a disposable database and an HTTP fixture, not the gateway image or
the production proxy. They establish neither container isolation nor homepage
latency under shared-resource exhaustion.

Before calling this deployment production-ready, verify: child host mounts/env
contain no Myriad secrets; offline tools cannot reach the network; memory, fork
and disk exhaustion stay inside the dedicated VM budget; timeout, disablement,
gateway crash and restart leave no unauthorized descendants; and web/TAPP remain
available while persona/federation/gateway are stopped separately. Shared database
and storage load still require a separate test. **Container execution and these
fault checks have not yet been performed for this example (`uncertain`).**

## Verified upstream references

The example uses the v0.43.3 flags and catalog layout, not mutable `latest`:
[gateway flags](https://github.com/docker/mcp-gateway/blob/v0.43.3/cmd/docker-mcp/commands/gateway.go),
[child container launch](https://github.com/docker/mcp-gateway/blob/v0.43.3/pkg/gateway/clientpool.go),
[catalog path validation](https://github.com/docker/mcp-gateway/blob/v0.43.3/pkg/catalog/catalog.go),
[authentication](https://github.com/docker/mcp-gateway/blob/v0.43.3/pkg/gateway/auth.go),
and [SDK command cleanup](https://github.com/docker/mcp-gateway/blob/v0.43.3/vendor/github.com/modelcontextprotocol/go-sdk/mcp/cmd.go).
These references establish implementation behavior; they do not replace the
deployment-specific tests above.
