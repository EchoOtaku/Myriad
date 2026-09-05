<div align="center">

<img src="frontend/public/logo.webp" alt="Myriad" width="120" />

# Myriad

### 让每一个你，被看见

*A myriad of lights, in one place.*

[English](README.md) · **中文** · [日本語](README.ja.md)

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/myriad-you/Myriad)](https://github.com/myriad-you/Myriad/releases)
[![Built with Rust](https://img.shields.io/badge/built%20with-Rust-orange.svg)](backend/Cargo.toml)
[![Astro](https://img.shields.io/badge/Astro-7-blueviolet.svg)](frontend/package.json)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](frontend/package.json)

[快速开始](docs/QUICKSTART.md) · [文档](docs/INDEX.md) · [反馈](https://github.com/myriad-you/Myriad/issues)

</div>

---

## 它是什么

我们在 GitHub 写代码、在 Bilibili 看视频、在 Steam 游玩、在网易云听歌——每一处都留下了一点自己，但它们彼此不相往来。

**Myriad 是自托管的个人主页与创作工坊。** 数字生活是它收进来的东西，不是一句空品类：把各平台汇到一处，给人看你的首页，给自己留资料库，再在同一站点上运行一份人设、2.5D 形象，以及你拥有的 Tapp 应用。

这是你自己跑的 **单租户** 箱子。可以公开做门户，也可以只给自己用。数据落入你的 PostgreSQL。界面有中 / 英 / 日。

装好之后，导航里就是这些房间：**首页**、**资料库**、**Brew**、**平台报告**、**Tapp**，再加上随时可开的 **Agent**。`/config` 仅管理员。

---

## 目录

- [一眼看完](#一眼看完)
- [首页](#首页)
- [平台](#平台)
- [资料库与报告](#资料库与报告)
- [人设与 2.5D 形象](#人设与-25d-形象)
- [Tapp](#tapp)
- [Agent](#agent)
- [Brew](#brew)
- [联邦](#联邦)
- [站点、用户、可见性](#站点用户可见性)
- [运维](#运维)
- [运行要求](#运行要求)
- [跑起来](#跑起来)
- [本地开发](#本地开发)
- [架构](#架构)
- [仓库](#仓库)
- [技术构成](#技术构成)
- [文档](#文档)
- [贡献](#贡献)
- [License](#license)

---

## 一眼看完

| 打开 | 是什么 |
| --- | --- |
| **首页** `/` | 站点对外的脸。小组件、布局、人设、音乐、Tapp 快捷方式。 |
| **资料库** `/library` | 游戏、番剧、影视、书籍、音乐，从已连接平台同步。 |
| **Brew** `/brew` | RSS / Notion / RSSHub 阅读器。访客可读；登录用户可标记、收藏。 |
| **平台报告** `/reports` | 各平台画像。也是生成人设的原料。 |
| **Tapp** `/tapp` | 已装应用。商店在 `/tapp/store`。Playground（管理员、桌面）在 `/tapp/playground`。 |
| **Agent** | 站点助手。「聊天」用人设说话；「做事」计划、跑工具、记忆、对接 MCP。 |
| **配置** `/config` | 管理员：平台、AI、用户、OAuth、可见性、更新器、诊断。 |

资料库、Brew、报告、Tapp、Agent 各自能设谁看得见：所有人、登录用户、或仅管理员。

---

## 首页

别人真正打开的是首页。接上平台，再把小组件摆上 **标准布局**（居中，桌面 16×4，窄屏紧凑重排）或 **自由布局**（格子一样大，画布 16×8）。两套布局各自记坐标。自由布局还可以贴装饰贴纸——那不是小组件，不占小组件格数。

内置小组件：

- 欢迎语
- Agent 人设（现场 2.5D 形象；一次只在一处播放）
- 内容概览、最近活动、访客统计
- 天气、一言
- 音乐播放器
- 友情链接（来自 Brew）
- 社交网络、Tapp 快捷方式
- 米哈游游戏 Presence
- 各已连接平台的 Report Card

已安装的 Tapp 也可以往首页注册自己的小组件。

别人看见的是你的主页。平台数据留在你自己的库里，不交给另一家托管。

---

## 平台

可按需连接：

| 平台 | Myriad 拉取什么 |
| --- | --- |
| GitHub | 仓库、Star、贡献 |
| Bilibili | 收藏、追番、观看历史 |
| Steam | 游戏库、愿望单、游玩统计 |
| 网易云 | 喜欢的歌与品味 |
| YouTube | 公开频道数据与最近上传 |
| Bangumi | 收藏、评分、追看状态 |
| Discord | 画像、服务器、绑定账号 |
| X | 资料与帖子 |
| MyAnimeList | 动画 / 漫画列表与评分 |
| Xbox | 成就、Gamerscore、最近游戏 |
| PlayStation | 奖杯、奖杯等级、最近游戏 |

数据写入你的 PostgreSQL。首页 Report Card、资料库、平台报告都读同一份。

---

## 资料库与报告

**资料库**把游戏、番剧、影视、书籍、音乐收成瀑布流，按类型筛选，从已连接平台同步。布局是普通列表或无限画布（低端设备会退回列表）。每类展示哪些平台来源可以自选。

**平台报告**是各平台的画像。生成人设需要若干份——站上那一份性格来自你在各处留下的痕迹，不是空白提示词。

---

## 人设与 2.5D 形象

全站一份说话人格，配上半身 2.5D 形象。界面叫 **Agent 人设**，不是第二个产品。关掉之后，站点助手仍叫 Agent，只聊天、做事。

站长侧流程：

1. 从平台报告抽出词条
2. 写好人设（名字、气质、说话方式）
3. 确认视觉设定（人模块与衣服模块分开）
4. 生成主立绘（3:4，上半身）
5. 导入分层 PSD；现场形象会呼吸、眨眼、对口型

说话和唱歌时头身跟着动。换装不必卸掉播放器。主立绘还可以派生一张 **贴纸头像**（只有头），用在头像位和 Agent 通知。换主立绘后这张贴纸要重做。

形象一次只在一处播放——首页小组件或 Agent 面板，不能两处同时。播放是浏览器里的分层 2.5D（Anime2.5DRig）。Myriad 主后端不为形象加载第三方模型，也不跑 GPU 推理。

---

## Tapp

Tapp 是挂在 Myriad 上的小应用：一整页的 **Page**、嵌进首页的 **Widget**，或两者都有。跑在沙箱里。安装时由你批准权限。宿主密钥和应用凭据不会进入沙箱，错误信息里也不会。

三种来源：

- **商店** — [Myriad-You/tapp-store](https://github.com/Myriad-You/tapp-store)，从 `/tapp/store` 安装
- **Playground** — 仅桌面管理员，`/tapp/playground`。用自然语言描述 Page、仅 Widget、或两者；在正式沙箱里预览；再安装或导出 `.tapp`。移动端不展示
- **CLI** — [`@myriad-you/tapp-cli`](tools/tapp-cli/README.md)（`myriad-tapp init / check / pack`）

Page 可以使用 Canvas / WebGL、包内资源、音频，以及（声明后）由宿主注入的 Three.js。Widget 不跑重 3D。详见 [Tapp 开发](docs/development/TAPP_DEVELOPMENT.md)。

---

## Agent

站点助手。内部项目名不对外；界面就叫 **Agent**。

| 档 | 做什么 |
| --- | --- |
| **聊天** | 只用人设说话。没有搜索、预订、生成、计划工具。换装和当前播放器的播 / 停 / 切歌可以当场做。 |
| **做事** | 计划、确认、执行。记忆、技能、定时任务、MCP。能做到哪一步由授予权限逐条决定，不按身份分档。 |

它可以注意到一件事，**提案**交给「做事」；接受提案不等于允许它自己行动。可选语音：朗读回复、听你说；配置好后可长按进入连续对话。

MCP 服务器在管理员 AI 设置里配置，保存后热重载。

---

## Brew

RSS、Notion、RSSHub 的阅读器。访客可读；登录用户可标记已读、收藏；管理员管源。Brew 里的友情链接可以挂到首页。

自有文章在 `/brew/item/...`，可被分享（爬虫拿 HTML 壳，浏览器进应用）。

---

## 联邦

ActivityPub + **MFP**。把 `BASE_URL` 设成公网源站——发现地址用它。

别人可以用 Actor URL（`https://你的域名/users/<名>`）或 `@名@你的域名` 关注、建频道、加入环网。WebFinger、NodeInfo、inbox、联邦媒体都走 **proxy → backend**，不进 SPA。

行为说明见 [联邦](docs/development/FEDERATION.md)。联邦域名迁移和普通换域名不是同一套手续，见文档门户。

---

## 站点、用户、可见性

- **本地账号**：所有者建好之后。可开可关注册。OAuth 够用后可以关掉密码登录。
- **OAuth：** 内置 GitHub，再加任意多个 OIDC（Authentik、Keycloak、Google、Microsoft、GitLab、Discord……）。身份是显式绑定的；两个 issuer 上同一邮箱不会静默合并。
- **页面可见性：** 资料库、Brew、报告、Tapp、Agent — 所有人 / 登录用户 / 仅管理员。
- **搜索与 AI 可见性：** 私有（noindex、空 sitemap、无 `/llms.txt`）、只给搜索引擎、允许 AI 引用、或完全开放。
- **站点身份：** 名称、简介、图标、可选 PWA、壁纸与主题、第一方访客统计，以及可选的 Google Analytics / Umami。

---

## 运维

生产环境是 **proxy + updater**。只有 **proxy** 对外暴露宿主端口。backend、frontend、Postgres、updater、docker-guard 都在内网。

版本切换和回滚走管理员「更新管理」（`/config` → 关于）。浏览器碰不到 `UPDATE_TOKEN`。不要手改 `:latest`。

自带 Postgres：updater 会快照 `./pgdata`，回滚能恢复数据目录 + 镜像 tag。外部 Postgres：设 `MYRIAD_DB_MODE=external`，回滚只恢复镜像 tag。见 [外部 PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md)。

小内存主机（约 1 GB）有内存节约档。`/config` 里的诊断会跑真实检查（数据库、存储、版本、出口）并生成不含凭据的报告。

---

## 运行要求

**生产（Docker，推荐）**

- Docker + Compose
- 一个宿主端口（`HTTP_PORT`，默认 80）
- linux/amd64 或 linux/arm64（官方镜像）

**从源码**

- Rust 1.94+
- Node.js 24 LTS
- PostgreSQL 18（Compose 默认；兼容下限见 release 的 `min_pg_version`）

---

## 跑起来

### Docker

```bash
git clone https://github.com/myriad-you/Myriad.git
cd Myriad

cp .env.production.example .env
# 至少设置：POSTGRES_PASSWORD / JWT_SECRET / CORS_ORIGINS
# BASE_URL / FRONTEND_URL 填你的公网域名（联邦发现依赖 BASE_URL）
# UPDATE_TOKEN / UPDATER_GATEWAY_SECRET 留空时由 deploy 脚本生成

bash scripts/extra/deploy.sh up
```

打开 `http://localhost`（或 `.env` 中的 `HTTP_PORT`），按向导完成：数据库、所有者账户、站点名。

未设置 `MYRIAD_SETUP_SECRET` 时，官方 compose 会拒绝启动（向导自己填库除外）。`deploy.sh up` 会生成。详见 [Setup 安装暗号](docs/deployment/SETUP_BOOTSTRAP.md)。

```text
host HTTP_PORT → proxy → frontend:1102
                      → backend:1103 → postgres:5432
                      → updater（仅内网；经 updater-gateway）
```

常用：

```bash
bash scripts/extra/deploy.sh status
bash scripts/extra/deploy.sh logs
bash scripts/extra/deploy.sh restart
bash scripts/extra/deploy.sh down
```

日常更新：`/config` → 关于 → 更新管理。手动改镜像：在 `.env` 里改 `MYRIAD_TAG` / `PROXY_TAG`，再 `bash scripts/extra/deploy.sh upgrade`。

备份（自带 Postgres）：

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U myriad -d myriad > "backups/backup_$(date +%Y%m%d_%H%M%S).sql"
```

更完整的部署、端口、无 Docker、排错：[快速开始](docs/QUICKSTART.md)、[Docker](docs/deployment/DOCKER_DEPLOYMENT.md)、[端口](docs/deployment/PORTS.md)、[无 Docker](docs/deployment/NATIVE_DEPLOYMENT.md)。

---

## 本地开发

```bash
./scripts/dev.sh                   # 实时 TUI：启动菜单 + 进程 / 数据库 / 日志
./scripts/dev.sh start             # 本机 PostgreSQL，日志打在当前终端
./scripts/dev.sh start --docker    # Docker postgres + 新开终端
./scripts/dev.sh doctor            # 工具链、端口、数据库
./scripts/dev.sh status            # 一次性快照
.\scripts\dev.ps1 start            # Windows
```

后端 `:1103`，前端 `:1102`。没有本机库时先 `./scripts/dev.sh db-setup`。

前端 dev server 会把 `/api/*`、`/health` 以及联邦公开路径代理到后端。

要在开发 UI 里测「更新管理」：`./scripts/dev.sh start all-updater`。真实换镜像、维护模式、`pgdata` 快照仍应走生产栈（`scripts/extra/deploy.sh`）。

---

## 架构

**开发**

```text
browser → Astro dev (:1102)
            └─ /api/*, /health, federation public paths → backend (:1103) → postgres
```

**生产**

```text
host HTTP_PORT
  → proxy
       ├─► frontend (:1102)          [myriad-net]
       ├─► backend (:1103) → postgres
       │       └─► updater-gateway → updater   [myriad-admin-net]
       │                                 └─► docker-guard → Docker sock
       └─ (rescue) updater when PROXY_ALLOW_DIRECT_UPDATER=true
```

爬虫 / 应用内分享 UA 会拿到首页、资料库、Brew、报告、Tapp 的 SEO HTML 壳；普通浏览器进 SPA。详见 [架构](docs/development/ARCHITECTURE.md)。

---

## 仓库

```
Myriad/
├── backend/          Rust API、SeaORM、migrations
├── frontend/         Astro + React UI、Tapp 运行时、i18n（中/英/日）
├── proxy/            生产入口反向代理（独立 Cargo 树，AGPL-3.0）
├── updater/          自更新守护进程（独立 Cargo 树，AGPL-3.0）
├── crates/           工作区共享库
├── shared/           跨组件静态配置
├── docker/           backend / frontend Dockerfile
├── docs/             开发、部署与功能文档（目前以中文为主）
├── scripts/          dev.sh / dev.ps1；extra/ 部署与手工回归
├── release/          release.json 契约与覆盖
├── tools/            tapp-cli 与契约导出
└── docker-compose*.yml
```

`proxy` 与 `updater` 是独立 Cargo 树，部署生命周期可以分开。

---

## 技术构成

| | |
| --- | --- |
| **前端** | Astro 7 · React 19 · Tailwind 4 · TypeScript · 中 / 英 / 日 |
| **后端** | Rust · Axum 0.8 · SeaORM · Tokio |
| **边缘** | proxy（反向代理 / 维护页）· updater（自更新 / 快照） |
| **数据** | PostgreSQL 18（Compose 默认镜像） |
| **扩展** | Agent · Tapp 沙箱 · MCP · ActivityPub / MFP |
| **部署** | Docker Compose · linux/amd64 + arm64 镜像 |

---

## 文档

目前以中文为主，从 [文档门户](docs/INDEX.md) 进。

| | |
| --- | --- |
| [快速开始](docs/QUICKSTART.md) | 部署与本地开发 |
| [架构](docs/development/ARCHITECTURE.md) | 组件与拓扑 |
| [构建](docs/development/BUILD.md) | 工具链与从源码构建 |
| [API](docs/API.md) | HTTP API |
| [Tapp 开发](docs/development/TAPP_DEVELOPMENT.md) | Page / Widget / Playground / 沙箱 |
| [资料库](docs/features/LIBRARY.md) | Library |
| [OAuth / 登录](docs/development/OAUTH.md) | 本地账号与 OIDC |
| [联邦](docs/development/FEDERATION.md) | ActivityPub / MFP |
| [Docker 部署](docs/deployment/DOCKER_DEPLOYMENT.md) | 生产编排 |
| [端口](docs/deployment/PORTS.md) | 端口与暴露面 |
| [Updater](docs/deployment/UPDATER_QUICKSTART.md) | 更新、回滚、救援 |
| [外部 PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md) | 自带库以外的 PG |
| [无 Docker 部署](docs/deployment/NATIVE_DEPLOYMENT.md) | 本机 PostgreSQL + 二进制 |
| [Setup 安装暗号](docs/deployment/SETUP_BOOTSTRAP.md) | 编排安装时的安装暗号 |

---

## 贡献

Issue 与 PR 都欢迎。UI 文案请同步改 `zh-CN` / `en-US` / `ja-JP`。

## License

根仓库与主应用为 [GPL-3.0](LICENSE)。`proxy` / `updater` 另行声明为 AGPL-3.0。

2.5D 播放使用 [Anime2.5DRig](https://github.com/852wa/Anime2.5DRig)（MIT）。

<br/>

<div align="center">
<sub><i>让每一个你，被看见</i> · <i>A myriad of lights, in one place.</i></sub>
<br/>
<sub>Maintained by <a href="https://github.com/myriad-you">@myriad-you</a></sub>
</div>
