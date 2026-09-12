# Runtime roles and deployment migration

The bundled and external-PostgreSQL Compose files run outbound federation delivery
in `federation-worker`. The web service uses `MYRIAD_PROCESS_ROLE=web`. Both services
use the same backend image and version, but separate processes and resource budgets.
This currently isolates **outbound delivery only**. Persona execution, federation
HTTP routes and MCP stdio execution still live in the web process.

| Entry | Starts | Intended use |
| --- | --- | --- |
| `MYRIAD_PROCESS_ROLE=web` | Existing web bootstrap, without delivery loop | New deployments |
| `/app/myriad-federation-worker` or `MYRIAD_PROCESS_ROLE=federation-worker` | Existing-schema check, configuration refresh, delivery queue and health endpoint | Trusted first-party worker |
| `MYRIAD_PROCESS_ROLE=all` | Combined runtime | Development only; rejected in production |
| Role unset | Legacy combined runtime, with startup warning | Compatibility while existing host Compose/TCB is migrated |

The dedicated worker executable path takes precedence over role environment values.
It is an alias in new images and absent from old images. Older backend images must
never be launched as workers just by changing an environment variable: they do not
understand the role and would start the entire application.

## Worker boundary

The official worker has a read-only root filesystem, UID/GID 1000, all capabilities
dropped, `no-new-privileges`, a 32 MiB `/tmp`, and only the `backend_data` volume mounted
read-only at `/app/data`. It has no backend cache, updater secret, Docker socket or
management-network attachment. Container limits are 0.5 CPU, 512 MiB memory and 64 PIDs.
The database pool has at most four connections, with connection/acquisition and SQL
statement/lock deadlines. These are first-party worker credentials; this container
is **not** suitable for running third-party MCP programs.

Web owns migrations and installation-key creation. The worker refuses schema drift,
a missing/invalid installation key and JWT-derived fallback. Deployments overriding
`MYRIAD_DATA_KEY` must supply the same existing key to both trusted processes. The
worker does not generate a separate key. It refreshes durable site origin and DB
configuration every 15 seconds; refresh failure stops the process, allowing its
supervisor to restart it rather than continue indefinitely with stale settings.

`GET /health` reports the worker role, DB readiness, version/commit and federation
gate. Geographic disablement is healthy idle. The delivery task and HTTP/config
refresh tasks are supervised together. SIGTERM cancels an in-flight delivery and
bounds health-server draining to five seconds. Existing token-checked leases remain
recoverable after interruption; remote HTTP delivery is still at-least-once.

## Update and rollback

Upgrade the updater/Guard TCB to a version supporting `federation-worker` before
using automatic updates with the new topology. An older Guard does not allow the
new service or its dedicated command. Merely pulling a new backend image does not
migrate a host-owned Compose file; role-unset compatibility preserves delivery on
those installations until the topology is updated.

The updated updater manages the worker alongside web for stop/recreate and rescue
rollback. Before database restore, it proves that the worker has stopped, including
an orphaned worker no longer mentioned by Compose. Inspection failures block the
restore. Image capability label `io.myriad.runtime.federation-worker=1` determines
whether to start it after a tag swap. Rolling back to a pre-role image leaves the
worker stopped and restores that image's combined backend. Health checks compare
actual container image identity and Docker health, without attaching updater to
the worker network.

Guard permits only the fixed worker executable, health command, UID, runtime paths,
environment keys, bounded resources, read-only data mount and business network.
This exception does not permit a general command override or arbitrary containers.

## Notifications across processes

Notification INSERT/UPSERT and PostgreSQL `NOTIFY` commit in one SQL statement.
The wakeup carries process/row/user identity, never a notification body. Web reads
the committed row and applies the existing owner filter before SSE delivery. A
stable ID cannot be reassigned to a different owner by UPSERT. If a row was deleted
before the wakeup is consumed, it is not resurrected. Persistent producers reload
notification preferences from the database, avoiding an indefinite process-local
opt-in after the user changes settings.

`NOTIFY` is a wakeup, not a durable event queue. Reconnection emits a resync; active
SSE clients also receive a history resync every 30 seconds. Missed wakeups therefore
recover the persisted list while DB connectivity is available. This does not replay
every intermediate toast or ephemeral persona speech. Notification persistence
retains the previous best-effort failure behavior; this bridge does not make a
failed database write durable.

## Validation and remaining work

A disposable PostgreSQL integration test exercises committed wakeups across separate
connections, row updates, owner filtering, stable-ID ownership and deletion races:

```sh
MYRIAD_NOTIFICATION_BRIDGE_TEST_DB='<disposable PostgreSQL URL>' \
  cargo test -p myriad-backend committed_changes_cross_connections_without_reassigning_owners \
  -- --ignored --nocapture
```

Do not point it at a production database. It creates and drops a uniquely named
schema. Guard and topology unit tests run with `cargo test --manifest-path
updater/Cargo.toml --lib`. These tests do not establish container OOM behavior,
end-to-end rollback recovery or homepage latency under federation load. Those need
an actual container-engine fault-injection run.

MCP OS isolation and persona process/state separation remain unfinished. Process
groups and cancellation protect MCP lifecycle but do not prevent filesystem/network
access by third-party children. Persona ticks cannot be moved alone: live state,
API ownership, cancellation and SSE reconnect behavior must move together.
