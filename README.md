<div align="center">

<img src="frontend/public/logo.webp" alt="Myriad" width="120" />

# Myriad

### A myriad of lights, in one place.

**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/myriad-you/Myriad)](https://github.com/myriad-you/Myriad/releases)
[![Built with Rust](https://img.shields.io/badge/built%20with-Rust-orange.svg)](backend/Cargo.toml)
[![Astro](https://img.shields.io/badge/Astro-7-blueviolet.svg)](frontend/package.json)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](frontend/package.json)

[Quick start](docs/QUICKSTART.md) · [Docs](docs/INDEX.md) · [Issues](https://github.com/myriad-you/Myriad/issues)

</div>

---

## What it is

**Myriad is a self-hosted homepage and creative studio.** Aggregate your platforms, show a library, and run a site-wide persona, a 2.5D face, and Tapp apps you own.

Single-tenant. Public or private. Data in PostgreSQL. UI: English, Chinese, Japanese.

Surfaces: **Home**, **Library**, **Brew**, **Reports**, **Tapp**, **Agent** (panel). `/config` is admin-only.

---

## Contents

- [At a glance](#at-a-glance)
- [Homepage](#homepage)
- [Platforms](#platforms)
- [Library and reports](#library-and-reports)
- [Persona and 2.5D face](#persona-and-25d-face)
- [Tapp](#tapp)
- [Agent](#agent)
- [Brew](#brew)
- [Federation](#federation)
- [Accounts and visibility](#accounts-and-visibility)
- [Operations](#operations)
- [Requirements](#requirements)
- [Deploy](#deploy)
- [Local development](#local-development)
- [Architecture](#architecture)
- [Repository](#repository)
- [Stack](#stack)
- [Docs](#docs)
- [Contributing](#contributing)
- [License](#license)

---

## At a glance

| Path | Role |
| --- | --- |
| **Home** `/` | Widgets, layouts, persona, music, Tapp shortcuts |
| **Library** `/library` | Games, anime, shows, books, music from connected platforms |
| **Brew** `/brew` | RSS / Notion / RSSHub. Default: everyone can read; signed-in users mark and save |
| **Reports** `/reports` | Per-platform portraits; input to guided persona setup |
| **Tapp** `/tapp` | Installed apps. Store: `/tapp/store`. Playground (admin, desktop): `/tapp/playground` |
| **Agent** | **Chat** / **Work**. Persona on: Chat speaks as that persona |
| **Config** `/config` | Admin: platforms, AI, users, OAuth, visibility, updater, diagnostics |

Library, Brew, Reports, Tapp, and Agent visibility: everyone / signed-in / admins.

---

## Homepage

Widgets sit on a **standard grid** (centered, 16×4 on desktop, compact on narrow screens) or a **free layout** (same cell size, 16×8 canvas). Coordinates are stored per layout. Free layout also supports decorative stickers; they are not widgets and do not occupy widget cells.

Built-in widgets: welcome; Agent persona (live 2.5D face; one playback at a time); quick stats, recent activity, visitor stats; weather; daily quote; music player; friend links (Brew); social network; Tapp shortcuts; miHoYo game presence; per-platform report cards.

Installed Tapps may register homepage widgets.

---

## Platforms

| Platform | Synced data |
| --- | --- |
| GitHub | Repos, stars, contributions |
| Bilibili | Favorites, anime, viewing history |
| Steam | Library, wishlist, play stats |
| NetEase Cloud Music | Liked songs and taste |
| YouTube | Public channel stats and recent uploads |
| Bangumi | Collections, ratings, watching status |
| Discord | Profile, servers, linked accounts |
| X | Profile and posts |
| MyAnimeList | Anime / manga lists and scores |
| Xbox | Achievements, Gamerscore, recent games |
| PlayStation | Trophies, trophy level, recent games |

Stored in PostgreSQL. Report cards, Library, and Reports read the same data.

---

## Library and reports

**Library** lists games, anime, shows, books, and music from connected platforms, filtered by type. Layout: list or infinite canvas; low-end devices fall back to the list. Per-category sources are configurable.

**Reports** are per-platform portraits. Guided persona setup reads them. A write-up plus an uploaded portrait is the other path.

---

## Persona and 2.5D face

One site-wide speaking personality and one upper-body 2.5D face (**Agent persona**). On: Agent speaks as that persona. Off: Agent still provides Chat and Work.

Owner setup: generate from reports (tags → persona → visual profile → master portrait), or paste a write-up and upload a portrait. Visual profile stores person and outfit separately. Master portrait is 3:4, upper body. A layered PSD enables live breath, blink, and lip-sync.

Head and torso follow speech and song. Outfit changes keep the live player. A **sticker avatar** (head only) can be derived for profile slots and Agent notifications; replacing the master portrait invalidates it.

One live face at a time. Browser 2.5D (Anime2.5DRig). The Myriad server does not GPU-infer that playback.

---

## Tapp

**Page**, homepage **Widget**, or both. Sandboxed. Permissions approved at install. Host secrets and app credentials never enter the sandbox, including error payloads.

- **Store** — [Myriad-You/tapp-store](https://github.com/Myriad-You/tapp-store), `/tapp/store`
- **Playground** — desktop admin, `/tapp/playground`. Natural-language Page, Widget-only, or both; preview in the production sandbox; install or export `.tapp`. Hidden on mobile
- **CLI** — [`@myriad-you/tapp-cli`](tools/tapp-cli/README.md) (`myriad-tapp init / check / pack`)

Page: Canvas / WebGL, pack-local assets, audio, optional host-injected Three.js. Widgets are not for heavy 3D. [Tapp development](docs/development/TAPP_DEVELOPMENT.md).

---

## Agent

| Mode | Behavior |
| --- | --- |
| **Chat** | Persona on: speaks only as that persona. No search, booking, generation, or planning. Outfit changes and current-player play / pause / skip are allowed. |
| **Work** | Plan, confirm, execute. Memory, skills, scheduled jobs, MCP. Scope is granted permissions. |

May propose handing a noticed item to Work; accepting is not autonomy. Optional TTS, listening, and long-press live conversation when speech / realtime talk is configured.

MCP servers: admin AI settings; hot-reload on save.

---

## Brew

RSS, Notion, RSSHub. Default: anyone can read. Signed-in users mark read and save. Admins manage sources. Friend links can appear on the homepage.

Own articles: `/brew/item/...`. Crawlers receive an HTML shell; browsers receive the app.

---

## Federation

ActivityPub + **MFP**. Discovery uses `BASE_URL`.

Follow via Actor URL (`https://your.domain/users/<name>`) or `@name@your.domain`. Channels and rings are supported. WebFinger, NodeInfo, inboxes, and federation media: **proxy → backend**, not the SPA.

Notes: [Federation](docs/development/FEDERATION.md). Federated domain move ≠ ordinary domain change.

---

## Accounts and visibility

- **Local accounts** after owner creation. Registration on/off. Per-user password login can be disabled after OAuth is linked.
- **OAuth:** built-in GitHub plus arbitrary OIDC (Authentik, Keycloak, Google, Microsoft, GitLab, Discord, …). Identities bind explicitly; the same email on two issuers is not merged.
- **Module visibility:** Library, Brew, Reports, Tapp, Agent — everyone / signed-in / admins.
- **Search & AI:** private (noindex, empty sitemap, no `/llms.txt`), search engines only, AI citations, or fully open.
- **Site identity:** name, blurb, icon, optional PWA, wallpaper and theme, first-party visitor stats, optional Google Analytics / Umami.

---

## Operations

Production: **proxy + updater**. Only **proxy** publishes a host port. Backend, frontend, Postgres, updater, and docker-guard stay on internal networks.

Version switch and rollback: `/config` → About → Update management. The browser never receives `UPDATE_TOKEN`. Do not overwrite `:latest`.

Bundled Postgres: updater snapshots `./pgdata`; rollback restores data directory and image tags. External Postgres: `MYRIAD_DB_MODE=external`; rollback restores image tags only. [External PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md).

Memory-saver profile for ~1 GiB hosts. `/config` diagnostics run live checks (database, storage, version, egress) and emit a credential-free report.

---

## Requirements

**Production (Docker)**

- Docker + Compose
- Host port (`HTTP_PORT`, default 80)
- linux/amd64 or linux/arm64

**From source**

- Rust 1.94+
- Node.js 24 LTS
- PostgreSQL 18 (Compose default; floor: release `min_pg_version`)

---

## Deploy

### Docker

```bash
git clone https://github.com/myriad-you/Myriad.git
cd Myriad

cp .env.production.example .env
# Required: POSTGRES_PASSWORD / JWT_SECRET / CORS_ORIGINS
# BASE_URL / FRONTEND_URL = public origin (federation discovery uses BASE_URL)
# Empty UPDATE_TOKEN / UPDATER_GATEWAY_SECRET → generated by deploy.sh

bash scripts/extra/deploy.sh up
```

Open `http://localhost` (or `HTTP_PORT`) and complete the wizard: database, owner, site name.

Official Compose sets `DATABASE_URL`, so startup requires `MYRIAD_SETUP_SECRET` (`deploy.sh up` generates it). Wizard-entered databases do not use that secret. [Setup secret](docs/deployment/SETUP_BOOTSTRAP.md).

```text
host HTTP_PORT → proxy → frontend:1102
                      → backend:1103 → postgres:5432
                      → updater (internal; via updater-gateway)
```

```bash
bash scripts/extra/deploy.sh status
bash scripts/extra/deploy.sh logs
bash scripts/extra/deploy.sh restart
bash scripts/extra/deploy.sh down
```

Updates: `/config` → About → Update management. Manual tag bump: `MYRIAD_TAG` / `PROXY_TAG` in `.env`, then `bash scripts/extra/deploy.sh upgrade`.

Bundled Postgres backup:

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U myriad -d myriad > "backups/backup_$(date +%Y%m%d_%H%M%S).sql"
```

[Quick start](docs/QUICKSTART.md) · [Docker](docs/deployment/DOCKER_DEPLOYMENT.md) · [Ports](docs/deployment/PORTS.md) · [Native](docs/deployment/NATIVE_DEPLOYMENT.md)

---

## Local development

```bash
./scripts/dev.sh                   # TUI: menu, processes, database, logs
./scripts/dev.sh start             # local PostgreSQL; logs in this terminal
./scripts/dev.sh start --docker    # Docker postgres + new terminal
./scripts/dev.sh doctor            # toolchain, ports, database
./scripts/dev.sh status            # snapshot
.\scripts\dev.ps1 start            # Windows
```

Backend `:1103`, frontend `:1102`. Without a local database: `./scripts/dev.sh db-setup`.

The frontend dev server proxies `/api/*`, `/health`, and public federation paths to the backend.

Update management in the dev UI: `./scripts/dev.sh start all-updater`. Image replace, maintenance mode, and `pgdata` snapshots: production stack (`scripts/extra/deploy.sh`).

---

## Architecture

**Development**

```text
browser → Astro dev (:1102)
            └─ /api/*, /health, federation public paths → backend (:1103) → postgres
```

**Production**

```text
host HTTP_PORT
  → proxy
       ├─► frontend (:1102)          [myriad-net]
       ├─► backend (:1103) → postgres
       │       └─► updater-gateway → updater   [myriad-admin-net]
       │                                 └─► docker-guard → Docker sock
       └─ (rescue) updater when PROXY_ALLOW_DIRECT_UPDATER=true
```

Crawler / in-app-share user-agents receive an SEO HTML shell for Home, Library, Brew, Reports, and Tapp; browsers receive the SPA. [Architecture](docs/development/ARCHITECTURE.md).

---

## Repository

```
Myriad/
├── backend/          Rust API, SeaORM, migrations
├── frontend/         Astro + React UI, Tapp runtime, i18n (en / zh / ja)
├── proxy/            production reverse proxy (own Cargo tree)
├── updater/          self-update daemon (own Cargo tree)
├── crates/           workspace libraries
├── shared/           cross-component static config
├── docker/           backend / frontend Dockerfiles
├── docs/             development, deploy, features (Chinese)
├── scripts/          dev.sh / dev.ps1; extra/ deploy
├── release/          release.json contract
├── tools/            tapp-cli, contract export
└── docker-compose*.yml
```

`proxy` and `updater` are independent Cargo trees.

---

## Stack

| | |
| --- | --- |
| **Frontend** | Astro 7 · React 19 · Tailwind 4 · TypeScript · en / zh / ja |
| **Backend** | Rust · Axum 0.8 · SeaORM · Tokio |
| **Edge** | proxy · updater |
| **Data** | PostgreSQL 18 |
| **Extensions** | Agent · Tapp sandbox · MCP · ActivityPub / MFP |
| **Deploy** | Docker Compose · linux/amd64 + arm64 |

---

## Docs

Currently Chinese. [Index](docs/INDEX.md).

| | |
| --- | --- |
| [Quick start](docs/QUICKSTART.md) | Deploy and local development |
| [Architecture](docs/development/ARCHITECTURE.md) | Components and topology |
| [Build](docs/development/BUILD.md) | From-source build |
| [API](docs/API.md) | HTTP API |
| [Tapp development](docs/development/TAPP_DEVELOPMENT.md) | Page / Widget / Playground / sandbox |
| [Library](docs/features/LIBRARY.md) | Library |
| [OAuth / login](docs/development/OAUTH.md) | Local accounts and OIDC |
| [Federation](docs/development/FEDERATION.md) | ActivityPub / MFP |
| [Docker deploy](docs/deployment/DOCKER_DEPLOYMENT.md) | Production compose |
| [Ports](docs/deployment/PORTS.md) | Ports and exposure |
| [Updater](docs/deployment/UPDATER_QUICKSTART.md) | Update, rollback, rescue |
| [External PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md) | External PG |
| [Native deploy](docs/deployment/NATIVE_DEPLOYMENT.md) | PostgreSQL + binaries |
| [Setup secret](docs/deployment/SETUP_BOOTSTRAP.md) | Orchestrated-setup secret |

---

## Contributing

Issues and PRs welcome. UI copy: `en-US` / `zh-CN` / `ja-JP`.

## License

The host (`backend`, `frontend`, and workspace crates) and `proxy` / `updater` are [AGPL-3.0](LICENSE). A Tapp that talks to the host only through the documented Bridge is an independent work; its license is the author's (see the AGPL section 7 additional permission in `LICENSE`).

The Tapp contract and tooling (`crates/tapp-contract`, `tools/tapp-cli`, `tools/tapp-contract-export`) are [Apache-2.0](LICENSES/Apache-2.0.txt).

2.5D playback: [Anime2.5DRig](https://github.com/852wa/Anime2.5DRig) (MIT).

<br/>

<div align="center">
<sub><i>A myriad of lights, in one place.</i></sub>
<br/>
<sub>Maintained by <a href="https://github.com/myriad-you">@myriad-you</a></sub>
</div>
