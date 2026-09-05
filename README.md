<div align="center">

<img src="frontend/public/logo.webp" alt="Myriad" width="120" />

# Myriad

### A myriad of lights, in one place.

**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md)

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/myriad-you/Myriad)](https://github.com/myriad-you/Myriad/releases)
[![Built with Rust](https://img.shields.io/badge/built%20with-Rust-orange.svg)](backend/Cargo.toml)
[![Astro](https://img.shields.io/badge/Astro-7-blueviolet.svg)](frontend/package.json)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](frontend/package.json)

[Quick start](docs/QUICKSTART.md) · [Docs](docs/INDEX.md) · [Issues](https://github.com/myriad-you/Myriad/issues)

</div>

---

## What it is

You write on GitHub, watch on Bilibili, play on Steam, listen on NetEase Cloud Music. A little of you in each place, and none of them talking to the others.

**Myriad is a self-hosted homepage and creative studio.** Digital life is the material it gathers, not a slogan: bring your platforms together, show a homepage, keep a library, and run one site-wide persona, a 2.5D face, and Tapp apps you own.

It is a **single-tenant** box you run. Publish it as a public portal, or keep it private. Data lands in your PostgreSQL. The UI is English, Chinese, and Japanese.

After setup the rooms are **Home**, **Library**, **Brew**, **Reports**, **Tapp**, plus **Agent** whenever you open the panel. `/config` is admin-only.

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
- [Site, people, visibility](#site-people-visibility)
- [Operations](#operations)
- [Requirements](#requirements)
- [Run it](#run-it)
- [Local development](#local-development)
- [Architecture](#architecture)
- [Repository](#repository)
- [Stack](#stack)
- [Docs](#docs)
- [Contributing](#contributing)
- [License](#license)

---

## At a glance

| You open | What it is |
| --- | --- |
| **Home** `/` | Public face of the site. Widgets, layouts, persona, music, Tapp shortcuts. |
| **Library** `/library` | Games, anime, shows, books, music synced from connected platforms. |
| **Brew** `/brew` | RSS / Notion / RSSHub reader. Guests can read; signed-in users can mark and save. |
| **Reports** `/reports` | Per-platform portraits. Also the raw material for generating a persona. |
| **Tapp** `/tapp` | Installed apps. Store at `/tapp/store`. Playground (admin, desktop) at `/tapp/playground`. |
| **Agent** | Site assistant. **Chat** speaks as the persona; **Help** plans, runs tools, remembers, talks to MCP. |
| **Config** `/config` | Admin: platforms, AI, users, OAuth, visibility, updater, diagnostics. |

Who sees Library, Brew, Reports, Tapp, and Agent is a per-module setting: everyone, signed-in, or admins.

---

## Homepage

The homepage is what other people actually open. Connect platforms, then arrange widgets on a **standard grid** (centered, 16×4 on desktop, compact on narrow screens) or a **free layout** (same cell size, 16×8 canvas). Each layout keeps its own coordinates. Free layout can also hold decorative stickers — those are not widgets and do not count toward widget slots.

Built-in widgets:

- Welcome
- Agent persona (the live 2.5D face; it plays in only one place at a time)
- Quick stats, recent activity, visitor stats
- Weather, daily quote
- Music player
- Friend links (from Brew)
- Social network, Tapp shortcuts
- miHoYo game presence
- Report cards for each connected platform

Installed Tapps can register their own homepage widgets.

Visitors see your homepage. Platform data stays in your database — not on someone else’s host.

---

## Platforms

Connect any mix of:

| Platform | What Myriad pulls |
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

Data is stored in your PostgreSQL. Homepage report cards, Library, and platform reports all read from that same store.

---

## Library and reports

**Library** is a waterfall of games, anime, shows, books, and music, filtered by type, synced from the platforms you connect. Layout is a regular list or an infinite canvas (low-end devices fall back to the list). You choose which platform sources appear in each category.

**Reports** are per-platform portraits. Persona generation needs a handful of them — the site-wide character is built from traces you already left elsewhere, not from a blank prompt.

---

## Persona and 2.5D face

One speaking personality and one upper-body 2.5D face for the whole site. This is **Agent persona**, not a second product. Turn it off and the site assistant is still Agent — chat and help only.

The site owner:

1. Pulls tags from platform reports
2. Writes the persona (name, temperament, how it speaks)
3. Confirms a visual profile (person + outfit, separately)
4. Generates a master portrait (3:4, upper body)
5. Imports a layered PSD; the live face breathes, blinks, and lip-syncs

Head and torso follow speech and song. Changing outfits does not tear down the player. The portrait can also yield a **sticker avatar** (head only) for profile slots and Agent notifications. Change the master portrait and that sticker has to be remade.

The live face plays in only one place at a time — homepage widget or the Agent panel, not both. Playback is layered 2.5D in the browser (Anime2.5DRig). Myriad’s backend does not load third-party models or run GPU inference for the face.

---

## Tapp

Tapp apps hang off Myriad: a full **Page**, a **Widget** on the homepage, or both. They run in a sandbox. You approve permissions at install. Host secrets and app credentials never enter the sandbox — not even in error payloads.

Ways to get one:

- **Store** — [Myriad-You/tapp-store](https://github.com/Myriad-You/tapp-store), installed from `/tapp/store`
- **Playground** — desktop admin only, at `/tapp/playground`. Describe a Page, Widget-only, or both in plain language; preview in the real sandbox; install or export a `.tapp`. Not shown on mobile.
- **CLI** — [`@myriad-you/tapp-cli`](tools/tapp-cli/README.md) (`myriad-tapp init / check / pack`)

A Page can use Canvas / WebGL, pack-local assets, audio, and (when declared) a host-injected Three.js. Widgets are not for heavy 3D. Details: [Tapp development](docs/development/TAPP_DEVELOPMENT.md).

---

## Agent

The site assistant. Internal names stay internal; the UI says **Agent**.

| Mode | What it does |
| --- | --- |
| **Chat** | Speaks only as the persona. No search, booking, generation, or planning tools. Can change outfits and control the current music player (play / pause / skip) on the spot. |
| **Help** | Plan, confirm, execute. Memory, skills, scheduled jobs, MCP. How far it can go is decided permission by permission, not by role. |

It can notice something and **offer** to take it into Help; accepting that offer is not the same as letting it act on its own. Optional speech: read replies aloud; listen; long-press for a live conversation if you configure it.

MCP servers are configured in admin AI settings and hot-reloaded.

---

## Brew

A reader for RSS, Notion, and RSSHub. Guests can read; signed-in users can mark items read and save them; admins manage sources. Friend links from Brew can sit on the homepage.

Own articles live under `/brew/item/...` and can be shared (crawlers get an HTML shell; browsers get the app).

---

## Federation

ActivityPub + **MFP**. Set `BASE_URL` to the public origin — discovery uses it.

Others can follow via an Actor URL (`https://your.domain/users/<name>`) or `@name@your.domain`, open a channel, or join a ring. WebFinger, NodeInfo, inboxes, and federation media go through **proxy → backend**, not the SPA.

Operational notes: [Federation](docs/development/FEDERATION.md). Moving a federated domain is a different procedure from a plain domain change — see the docs index.

---

## Site, people, visibility

- **Local accounts** after the owner is created. Registration can be enabled or shut. Password login can be disabled once OAuth is enough.
- **OAuth:** built-in GitHub, plus as many OIDC providers as you need (Authentik, Keycloak, Google, Microsoft, GitLab, Discord, …). Identities are bound explicitly; the same email on two issuers does not silently merge.
- **Module visibility:** Library, Brew, Reports, Tapp, Agent — everyone / signed-in / admins.
- **Search & AI visibility:** private (noindex, empty sitemap, no `/llms.txt`), search engines only, allow AI citations, or fully open.
- **Site identity:** name, blurb, icon, optional PWA, wallpaper and theme, first-party visitor stats, optional Google Analytics / Umami.

---

## Operations

Production is **proxy + updater**. Only **proxy** publishes a host port. Backend, frontend, Postgres, updater, and docker-guard stay on internal networks.

Version switches and rollbacks go through admin **Update management** (`/config` → About). The browser never sees `UPDATE_TOKEN`. Do not overwrite `:latest` by hand.

Bundled Postgres: updater snapshots `./pgdata` so a rollback can restore data directory + image tags. External Postgres: set `MYRIAD_DB_MODE=external`; rollback restores image tags only. See [External PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md).

A memory-saver profile exists for small hosts (~1 GB). Diagnostics in `/config` run real checks (database, storage, version, egress) and produce a report without credentials.

---

## Requirements

**Production (Docker, recommended)**

- Docker + Compose
- A host port (`HTTP_PORT`, default 80)
- linux/amd64 or linux/arm64 (official images)

**From source**

- Rust 1.94+
- Node.js 24 LTS
- PostgreSQL 18 (Compose default; see release `min_pg_version` for the floor)

---

## Run it

### Docker

```bash
git clone https://github.com/myriad-you/Myriad.git
cd Myriad

cp .env.production.example .env
# Required: POSTGRES_PASSWORD / JWT_SECRET / CORS_ORIGINS
# BASE_URL / FRONTEND_URL should be your public domain (federation discovery uses BASE_URL)
# Leave UPDATE_TOKEN / UPDATER_GATEWAY_SECRET empty to let the deploy script generate them

bash scripts/extra/deploy.sh up
```

Open `http://localhost` (or `HTTP_PORT` from `.env`) and finish the wizard: database, owner account, site name.

Compose refuses to start without `MYRIAD_SETUP_SECRET` unless you point the wizard at your own database. `deploy.sh up` generates the secret. Details: [Setup secret](docs/deployment/SETUP_BOOTSTRAP.md).

```text
host HTTP_PORT → proxy → frontend:1102
                      → backend:1103 → postgres:5432
                      → updater (internal only; via updater-gateway)
```

Useful:

```bash
bash scripts/extra/deploy.sh status
bash scripts/extra/deploy.sh logs
bash scripts/extra/deploy.sh restart
bash scripts/extra/deploy.sh down
```

Day-to-day upgrades: `/config` → About → Update management. Manual image bump: set `MYRIAD_TAG` / `PROXY_TAG` in `.env`, then `bash scripts/extra/deploy.sh upgrade`.

Backup (bundled Postgres):

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U myriad -d myriad > "backups/backup_$(date +%Y%m%d_%H%M%S).sql"
```

Fuller deploy, ports, native (no Docker), and troubleshooting: [Quick start](docs/QUICKSTART.md), [Docker](docs/deployment/DOCKER_DEPLOYMENT.md), [Ports](docs/deployment/PORTS.md), [Native](docs/deployment/NATIVE_DEPLOYMENT.md).

---

## Local development

```bash
./scripts/dev.sh                   # live TUI: start menu + processes / database / logs
./scripts/dev.sh start             # local PostgreSQL, logs in this terminal
./scripts/dev.sh start --docker    # Docker postgres + a new terminal
./scripts/dev.sh doctor            # toolchain, ports, database
./scripts/dev.sh status            # one-shot snapshot
.\scripts\dev.ps1 start            # Windows
```

Backend `:1103`, frontend `:1102`. No local database yet? `./scripts/dev.sh db-setup` first.

The frontend dev server proxies `/api/*`, `/health`, and public federation paths to the backend.

To exercise **Update management** in the dev UI: `./scripts/dev.sh start all-updater`. Real image replace, maintenance mode, and `pgdata` snapshots still belong on the production stack (`scripts/extra/deploy.sh`).

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

Crawler / in-app share user-agents get an SEO HTML shell for Home, Library, Brew, Reports, and Tapp; ordinary browsers get the SPA. Details: [Architecture](docs/development/ARCHITECTURE.md).

---

## Repository

```
Myriad/
├── backend/          Rust API, SeaORM, migrations
├── frontend/         Astro + React UI, Tapp runtime, i18n (en / zh / ja)
├── proxy/            production-edge reverse proxy (own Cargo tree, AGPL-3.0)
├── updater/          self-update daemon (own Cargo tree, AGPL-3.0)
├── crates/           workspace shared libs
├── shared/           cross-component static config
├── docker/           backend / frontend Dockerfiles
├── docs/             development, deploy, and feature docs (currently Chinese)
├── scripts/          dev.sh / dev.ps1; extra/ deploy and manual regression
├── release/          release.json contract and overlays
├── tools/            tapp-cli and contract export
└── docker-compose*.yml
```

`proxy` and `updater` are independent Cargo trees so they can deploy on their own lifecycle.

---

## Stack

| | |
| --- | --- |
| **Frontend** | Astro 7 · React 19 · Tailwind 4 · TypeScript · en / zh / ja |
| **Backend** | Rust · Axum 0.8 · SeaORM · Tokio |
| **Edge** | proxy (reverse proxy / maintenance page) · updater (self-update / snapshots) |
| **Data** | PostgreSQL 18 (default Compose image) |
| **Extensions** | Agent · Tapp sandbox · MCP · ActivityPub / MFP |
| **Deploy** | Docker Compose · linux/amd64 + arm64 images |

---

## Docs

Currently in Chinese. Start at the [docs index](docs/INDEX.md).

| | |
| --- | --- |
| [Quick start](docs/QUICKSTART.md) | Deploy and local development |
| [Architecture](docs/development/ARCHITECTURE.md) | Components and topology |
| [Build](docs/development/BUILD.md) | Toolchain and from-source build |
| [API](docs/API.md) | HTTP API |
| [Tapp development](docs/development/TAPP_DEVELOPMENT.md) | Page / Widget / Playground / sandbox |
| [Library](docs/features/LIBRARY.md) | Library |
| [OAuth / login](docs/development/OAUTH.md) | Local accounts and OIDC |
| [Federation](docs/development/FEDERATION.md) | ActivityPub / MFP |
| [Docker deploy](docs/deployment/DOCKER_DEPLOYMENT.md) | Production compose |
| [Ports](docs/deployment/PORTS.md) | Ports and exposure |
| [Updater](docs/deployment/UPDATER_QUICKSTART.md) | Update, rollback, rescue |
| [External PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md) | Bring-your-own PG |
| [Native deploy](docs/deployment/NATIVE_DEPLOYMENT.md) | Local PostgreSQL + binaries |
| [Setup secret](docs/deployment/SETUP_BOOTSTRAP.md) | Install secret for orchestrated setup |

---

## Contributing

Issues and PRs are welcome. UI copy should land in all three locales (`en-US` / `zh-CN` / `ja-JP`).

## License

The root repository and main app are [GPL-3.0](LICENSE). `proxy` and `updater` are separately licensed AGPL-3.0.

2.5D playback uses [Anime2.5DRig](https://github.com/852wa/Anime2.5DRig) (MIT).

<br/>

<div align="center">
<sub><i>A myriad of lights, in one place.</i></sub>
<br/>
<sub>Maintained by <a href="https://github.com/myriad-you">@myriad-you</a></sub>
</div>
