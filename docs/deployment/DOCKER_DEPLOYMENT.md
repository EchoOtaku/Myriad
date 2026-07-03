# Myriad Docker Deployment

This is the current production Docker topology. Direct backend/frontend host
ports, named-volume pgdata migration, and `:latest` image workflows have been
removed.

## Topology

```text
host HTTP_PORT
  |
  v
proxy ──┬── frontend:4321
        ├── backend:3000 ── postgres:5432
        └── updater:9090 (internal only)
```

- Only `proxy` publishes a host port.
- `backend`, `frontend`, `postgres`, and `updater` stay on the Docker bridge
  network.
- The updater is not an A/B dual-live system. It uses one running business slot,
  maintenance mode, `pgdata` snapshots, and immutable image tags.
- Browser update requests go through backend admin routes:
  `/api/admin/updater/*`. The browser never receives `UPDATE_TOKEN`.

## Files

| File | Role |
| --- | --- |
| `docker-compose.yml` | Production stack: postgres, backend, frontend, proxy, updater |
| `.env.production.example` | Template for host `.env` |
| `scripts/docker/deploy.sh` | Linux/macOS bootstrap and stack management |
| `scripts/docker/deploy.ps1` | Windows bootstrap and stack management |
| `docs/deployment/PORTS.md` | Development and production port map |
| `docs/UPDATER_QUICKSTART.md` | Operator guide for update, rollback, rescue |
| `docs/updater-spec.md` | Updater protocol and failure-mode design |

## First Start

```bash
cp .env.production.example .env

# Edit at minimum:
# POSTGRES_PASSWORD, JWT_SECRET, CORS_ORIGINS
# deploy.sh fills UPDATE_TOKEN if it is empty.

bash scripts/docker/deploy.sh up
```

On Windows:

```powershell
.\scripts\docker\deploy.ps1 up
```

Open `http://localhost` or the port configured by `HTTP_PORT`.

## Required Environment

| Variable | Purpose |
| --- | --- |
| `MYRIAD_TAG` | Backend/frontend image tag, maintained by updater |
| `PROXY_TAG` | Proxy image tag |
| `UPDATER_TAG` | Updater image tag |
| `COMPOSE_PROJECT_NAME` | Compose project name, default `myriad` |
| `MYRIAD_DOCKER_NETWORK` | Optional Docker network override, default `myriad-net` |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `JWT_SECRET` | JWT signing secret |
| `CORS_ORIGINS` | Public frontend origins |
| `UPDATE_TOKEN` | Server-side updater token |
| `HTTP_PORT` | Published proxy port, default `80` |

Do not set `BACKEND_PORT` or `FRONTEND_PORT` for production. Those are internal
container ports.

For the full port map, see [PORTS.md](./PORTS.md).

## Operations

```bash
bash scripts/docker/deploy.sh status
bash scripts/docker/deploy.sh logs
bash scripts/docker/deploy.sh restart
bash scripts/docker/deploy.sh down
```

Manual tag upgrade path:

```bash
# Edit MYRIAD_TAG / PROXY_TAG / UPDATER_TAG in .env first.
bash scripts/docker/deploy.sh upgrade
```

Day-to-day updates should be started from the admin UI:

```text
Settings -> About -> Update Management
```

The updater then handles maintenance mode, container stop/start, `pgdata`
snapshotting, tag switching, health probes, rollback, and rescue state.

## Data Layout

| Path | Git status | Purpose |
| --- | --- | --- |
| `./pgdata` | ignored | PostgreSQL bind mount used for updater snapshots |
| `./state` | ignored | Proxy maintenance state and updater lock/history |
| `./backups` | ignored | Updater snapshots and diagnostics |
| `backend_cache` volume | Docker volume | Backend cache |
| `backend_data` volume | Docker volume | Backend app data |

`pgdata` must be a bind mount, not a named Docker volume, because updater
rollback needs file-level snapshots.

## Development

Use `docker-compose.dev.yml` only for local PostgreSQL:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
(cd backend && cargo run --bin myriad-backend)
(cd frontend && pnpm install && pnpm dev)
```

Development directly uses `localhost:4321` and `localhost:3000`; production does
not.
