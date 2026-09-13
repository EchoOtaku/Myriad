# Fixed MCP tool containers

This base runs an operator-reviewed stdio MCP executable inside bubblewrap. The
existing Docker MCP Gateway uses its pinned `--static` mode to connect over the
private MCP network. Neither service receives the Docker socket, Myriad data,
database/JWT/updater credentials, or TAPP credentials. The gateway's authentication
token is supplied only to the gateway container.

## Build and deploy

From the repository root:

```sh
docker build -f docker/mcp-tool/Dockerfile -t myriad-mcp-tool-base:local .
```

Build a derived image containing the reviewed server and all its dependencies.
Install Python/Node dependencies into `/usr` or `/opt/mcp`. Supply an executable
`/opt/mcp/entrypoint`; for example, an executable script launching the installed
server with fixed arguments. Preserve the base image's USER and ENTRYPOINT.
Do not install packages from model-provided commands at runtime. Do not include
credentials in image layers, server files or environment variables.

```dockerfile
FROM myriad-mcp-tool-base:local
COPY --chmod=0755 entrypoint /opt/mcp/entrypoint
# COPY the reviewed server code/dependencies into /opt/mcp as appropriate.
```

Set these operator variables when using
`docs/deployment/examples/docker-compose.mcp-gateway.example.yml`:

| Variable | Value |
| --- | --- |
| `MCP_TOOL_IMAGE` | Built and reviewed derived image; pin its deployment digest |
| `MCP_CATALOG_FILE` | Absolute path to this directory's `catalog.yaml` |
| `MCP_SECCOMP_PROFILE` | Absolute path to this directory's `namespace-seccomp.json` |
| `MCP_GATEWAY_AUTH_TOKEN` | Dedicated random token, at least 32 non-space ASCII characters |

Run Compose configuration validation, then bring up the two services. Tool health
must pass before the gateway discovers tools. The listener is published only at
`127.0.0.1:8811`; use the existing HTTPS/private ingress arrangement to expose
`/mcp` to persona. Configure Myriad's single gateway definition as described in
[the migration guide](../../docs/deployment/MCP_GATEWAY.md). For an image/catalog
change, disable that definition, stop the affected tool container, update/recreate
it, then restart the gateway to rediscover tools before re-enabling the definition.

The catalog image field exists because upstream requires it even in static mode;
the gateway does not pull or execute that image. `MCP_TOOL_IMAGE` selects the actual
container. Extending the catalog requires a corresponding fixed `mcp-<name>`
service on the private MCP network, with the same restrictions and separate
resource limits. Do not switch back to the gateway's dynamic Docker execution.

## Enforced boundary

- Each tool container has a read-only root, UID/GID 65534, no capabilities,
  `no-new-privileges`, 0.5 CPU, 256 MiB memory including swap and 64 PIDs. No host volumes are
  mounted. Its 16 MiB parent `/tmp` is only for namespace setup.
- Each connection starts a fresh guest with private user, PID, mount, network,
  IPC and UTS namespaces. Only `/usr`, `/lib`, `/bin` and `/opt/mcp` are mounted
  read-only. `/proc`, `/sys`, host configuration and credentials are absent.
  Guest `/tmp` and `/work` are separate 32 MiB tmpfs mounts. The environment is
  cleared and rebuilt with only PATH, HOME and LANG. The guest has no network.
- A guest filter denies further namespace creation/entry, including clone-based
  namespace creation and alternative syscall ABIs. Thread/process creation within
  the existing sandbox remains subject to the container PID limit.
- A connection close lets the trusted socat parent exit after one second;
  bubblewrap's parent-death handling and PID namespace remove the guest tree.
  A watchdog outside that namespace imposes a fixed 35-second guest lifetime,
  including initialization, so lost cancellation or continuing output cannot
  preserve an untrusted process indefinitely. Expect up to five additional seconds
  for protocol teardown. Myriad already limits each HTTP exchange to 30 seconds.
- The tool container persists between calls; the **untrusted guest process tree**
  is destroyed. Configuration revocation immediately removes Myriad's route to it;
  normal cancellation usually reaps it sooner than the maximum lifetime. Gateway
  failure closes its internal connections; it cannot leave sibling containers
  that it created, because it has no container-creation interface.

These defaults are offline and stateless. Reviewed tools can opt into
[controlled HTTP/HTTPS and bounded persistent state](../../docs/deployment/MCP_CAPABILITIES.md).
Arbitrary host files, `/proc` access and calls beyond the client deadline remain
unsupported. Hosts must support unprivileged user namespaces; a denied namespace
setup fails the tool rather than falling back to unsandboxed execution.

## Seccomp provenance

`namespace-seccomp.json` is the Moby default profile at
[`61eaf32614c7c71b60bd8927d3e6a4ffc8ff1f31`](https://github.com/moby/profiles/blob/61eaf32614c7c71b60bd8927d3e6a4ffc8ff1f31/seccomp/default.json),
with one appended rule permitting `clone`, `unshare`, `mount`, `umount2`,
`pivot_root`, `setns` and `mount_setattr` during bubblewrap setup. The original
Apache-2.0 license is in `LICENSE.moby-profiles`.

`guest_filter.py` encodes an additional classic-BPF filter installed by bubblewrap
before the executable runs. This removes the namespace exception from the guest;
Docker's inherited allowlist still applies. It accepts only aarch64 and x86_64
image builds and rejects foreign/compat ABIs at execution. All outer capabilities
remain dropped; neither privileged mode nor an unconfined seccomp profile is used.

## Verification

Run `python3 docker/mcp-tool/tests/integration.py` from the repository to build and
exercise the actual pinned deployment, including resource exhaustion and process
destruction. Run `python3 -m unittest discover -s docker/mcp-tool -p 'test_*.py'`
for the architecture-specific seccomp instruction tests. See the migration guide
for the tested host and explicit compatibility limits.

For optional capabilities, provision a disposable bounded state volume and run
`python3 docker/mcp-tool/tests/capabilities.py --state-volume VOLUME`. This writes
test data into that volume; never point it at an existing tool's data.
