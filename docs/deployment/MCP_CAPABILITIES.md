# MCP networking and durable state

The base sandbox remains offline and stateless by default. An operator can enable
these capabilities independently for a reviewed tool using the
[capabilities overlay](examples/docker-compose.mcp-capabilities.example.yml).
These are deployment controls, not TAPP declared/approved/granted permissions.

## Network access

Build `docker/mcp-egress/Dockerfile` and set `MCP_EGRESS_IMAGE` to its pinned image.
Set `MCP_ALLOWED_DOMAINS_FILE` to an absolute path containing the exact approved
hostnames, one per line. For example, `example.com` permits that hostname; a
leading dot deliberately includes subdomains. Keep the file specific to one tool.
The proxy is private and publishes no host port.

The tool's private network namespace is retained. A loopback HTTP proxy bridge
connects through a Unix socket to the external Squid service. The guest receives
HTTP_PROXY/HTTPS_PROXY and their lowercase variants; a proxy-aware client can use
public HTTP/HTTPS without gaining direct DNS or TCP access. Clients that ignore
proxy settings fail rather than gaining direct networking. Configure the reviewed
server's HTTP client accordingly; Node clients in particular may need an explicit
proxy dispatcher.

Squid allows only approved destinations on ports 80 and 443 (CONNECT only 443),
rejects private/loopback/link-local/metadata/shared/reserved IPv4 destinations and
all IPv6, and applies the same checks to redirected requests. Numeric addresses
cannot reverse-resolve into an allowlisted name. No disk cache or request access
log is enabled; proxy memory, descriptors, PIDs, CPU and scratch space are bounded.
The guest's 35-second lifetime still bounds tunnels and descendants.

The allowlist controls network destinations, not every HTTP operation within an
approved service or TLS tunnel. Review each service before allowing it. Do not
supply host, JWT, updater, or TAPP credentials to a tool. Tools requiring those
credentials must use a trusted outbound service that resolves them outside the
sandbox; adding a hostname does not authorize exposing a credential.

## Durable state with a hard storage ceiling

Set `MCP_PERSIST_STATE=true` and mount a dedicated filesystem at
`/var/lib/mcp-state` in the tool container. The guest receives it only at `/state`;
configure the reviewed tool's data/SQLite path there. HOME and scratch space
remain ephemeral. State survives guest destruction and container recreation.
Different tools must use different volumes; stopped processes do not imply that
operator-approved stored application data should be erased.

The launcher refuses a filesystem larger than 128 MiB, a symlink/non-directory,
a mount without `nodev,nosuid,noexec`, or a directory unwritable by UID 65534.
An ordinary unbounded Docker volume therefore fails closed. This is a filesystem
capacity limit, not a periodic usage check that can race a writer.

On a Linux Docker host, provision a dedicated filesystem using the host's normal
storage tooling. One small installation can use an ext4 image, for example:

```sh
(
set -eu
sudo install -d -m 0700 /var/lib/myriad-mcp
sudo install -d -m 0755 /srv/myriad-mcp-approved
# Choose a NEW path; never run mkfs on an existing tool's data.
sudo test ! -e /var/lib/myriad-mcp/approved.ext4
sudo truncate -s 64M /var/lib/myriad-mcp/approved.ext4
sudo mkfs.ext4 -N 4096 /var/lib/myriad-mcp/approved.ext4
sudo mount -o loop,nodev,nosuid,noexec /var/lib/myriad-mcp/approved.ext4 /srv/myriad-mcp-approved
sudo chown 65534:65534 /srv/myriad-mcp-approved
sudo chmod 0700 /srv/myriad-mcp-approved
docker volume create --driver local --opt type=none --opt o=bind \
  --opt device=/srv/myriad-mcp-approved myriad-mcp-approved-state
)
```

Persist that mount in the host's mount configuration before enabling automatic
container startup. Set `MCP_STATE_VOLUME=myriad-mcp-approved-state`. Back up the
filesystem while the tool is stopped. Docker Desktop host bind mounts generally
do not report a small dedicated filesystem; provision an equivalent bounded
filesystem in its Linux VM or deploy the tool on a Linux host. Do not bypass the
capacity check by substituting an unbounded host directory.

## Enable, change and revoke

Use the base Compose plus the overlay, with the operator variables documented in
both files. Remove the state or network blocks from a private copy of the overlay
when that capability is unnecessary. Do not expose the proxy or share its private
network with Myriad's database/administrative services.

Before changing code, allowed hosts, credentials or state mounts, disable the MCP
definition, stop the tool, apply the changes, recreate the services and rediscover
tools before re-enabling it. Existing sessions must not retain old authority. The
fixed watchdog remains in force; persistent files do not keep a process alive.
To erase application data, stop the tool and explicitly remove its own volume/
filesystem according to retention policy; never wipe another tool's volume.

The proxy policy uses Squid's [destination ACLs](https://www.squid-cache.org/Doc/config/acl/)
and ordered [http_access rules](https://www.squid-cache.org/Doc/config/http_access/).

## Verification

With a disposable bounded volume, run
`python3 docker/mcp-tool/tests/capabilities.py --state-volume VOLUME`.
Acceptance on Docker Engine 29.6.2 / arm64 on 2026-09-12 confirmed an allowed HTTPS
request, rejection of non-allowlisted hosts, an allowed hostname resolving to a
private address, localhost, metadata addresses,
nonstandard ports and redirects to metadata; direct TCP remained unavailable.
A 64 MiB ext4 test filesystem returned ENOSPC after about 53 MiB of file writes
(filesystem overhead/reserved blocks account for the difference). The canary
survived tool/gateway container recreation, and the gateway token was absent
from the guest environment. The launcher also rejected an unbounded filesystem.
The test retains the supplied volume.
