<div align="center">

<img src="frontend/public/logo.webp" alt="Myriad" width="120" />

# Myriad

### あなたという物語を、ひとつに

*A myriad of lights, in one place.*

[English](README.md) · [中文](README.zh-CN.md) · **日本語**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/myriad-you/Myriad)](https://github.com/myriad-you/Myriad/releases)
[![Built with Rust](https://img.shields.io/badge/built%20with-Rust-orange.svg)](backend/Cargo.toml)
[![Astro](https://img.shields.io/badge/Astro-7-blueviolet.svg)](frontend/package.json)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](frontend/package.json)

[クイックスタート](docs/QUICKSTART.md) · [ドキュメント](docs/INDEX.md) · [フィードバック](https://github.com/myriad-you/Myriad/issues)

</div>

---

## これは何か

**Myriad はセルフホストのホームページ兼創作工房です。** プラットフォームを集め、ライブラリを見せ、サイト全体でひとつのペルソナ、2.5D ビジュアル、所有する Tapp を動かします。

シングルテナント。公開または非公開。データは PostgreSQL。UI：日本語・中国語・英語。

画面：**ホーム**、**ライブラリ**、**Brew**、**レポート**、**Tapp**、**Agent**（パネル）。`/config` は管理者のみ。

---

## 目次

- [一覧](#一覧)
- [ホームページ](#ホームページ)
- [プラットフォーム](#プラットフォーム)
- [ライブラリとレポート](#ライブラリとレポート)
- [ペルソナと 2.5D ビジュアル](#ペルソナと-25d-ビジュアル)
- [Tapp](#tapp)
- [Agent](#agent)
- [Brew](#brew)
- [連合](#連合)
- [アカウントと公開範囲](#アカウントと公開範囲)
- [運用](#運用)
- [要件](#要件)
- [デプロイ](#デプロイ)
- [ローカル開発](#ローカル開発)
- [アーキテクチャ](#アーキテクチャ)
- [リポジトリ](#リポジトリ)
- [技術構成](#技術構成)
- [ドキュメント](#ドキュメント)
- [貢献](#貢献)
- [License](#license)

---

## 一覧

| パス | 役割 |
| --- | --- |
| **ホーム** `/` | ウィジェット、レイアウト、ペルソナ、音楽、Tapp ショートカット |
| **ライブラリ** `/library` | 接続済みプラットフォームのゲーム、アニメ、映像、書籍、音楽 |
| **Brew** `/brew` | RSS / Notion / RSSHub。既定は全員が閲覧可。ログインユーザーは既読と保存 |
| **レポート** `/reports` | 各プラットフォームの肖像。案内つきペルソナ作成の入力 |
| **Tapp** `/tapp` | インストール済み。ストア：`/tapp/store`。Playground（管理者、デスクトップ）：`/tapp/playground` |
| **Agent** | **Chat** / **Work**。ペルソナオン時、Chat はそのペルソナとして話す |
| **設定** `/config` | 管理者：プラットフォーム、AI、ユーザー、OAuth、公開範囲、アップデーター、診断 |

ライブラリ、Brew、レポート、Tapp、Agent の公開範囲：全員 / ログイン済み / 管理者。

---

## ホームページ

ウィジェットは **標準グリッド**（中央寄せ、デスクトップ 16×4、狭幅では詰め直し）または **自由レイアウト**（同セル、キャンバス 16×8）。座標はレイアウトごとに保存。自由レイアウトには装飾ステッカーを置ける。ステッカーはウィジェットではなく、ウィジェット枠を占有しない。

組み込み：歓迎；Agent ペルソナ（ライブ 2.5D、同時再生は一箇所）；概要、最近の活動、訪問統計；天気；一言；音楽プレーヤー；相互リンク（Brew）；ソーシャル；Tapp ショートカット；miHoYo ゲーム Presence；プラットフォーム別 Report Card。

インストール済み Tapp はホームページ用ウィジェットを登録できる。

---

## プラットフォーム

| プラットフォーム | 同期内容 |
| --- | --- |
| GitHub | リポジトリ、Star、コントリビューション |
| Bilibili | お気に入り、アニメ、視聴履歴 |
| Steam | ライブラリ、ウィッシュリスト、プレイ統計 |
| 網易雲 | 好きな曲と傾向 |
| YouTube | 公開チャンネルと最近の投稿 |
| Bangumi | コレクション、評価、視聴状態 |
| Discord | プロフィール、サーバー、連携アカウント |
| X | プロフィールと投稿 |
| MyAnimeList | アニメ / マンガのリストと点数 |
| Xbox | 実績、Gamerscore、最近のゲーム |
| PlayStation | トロフィー、レベル、最近のゲーム |

PostgreSQL に保存。Report Card、ライブラリ、レポートは同一データを読む。

---

## ライブラリとレポート

**ライブラリ**は接続済みプラットフォームのゲーム、アニメ、映像、書籍、音楽を種類で絞り込む。レイアウト：リストまたは無限キャンバス。低スペックはリストに戻る。カテゴリごとのソースは設定可能。

**レポート**は各サービスの肖像。案内つきペルソナ作成が読む。もう一方の経路は文案の貼り付けと立ち絵のアップロード。

---

## ペルソナと 2.5D ビジュアル

サイト全体でひとつの話し手と上半身 2.5D ビジュアル（**Agent ペルソナ**）。オン：Agent はそのペルソナとして話す。オフ：Chat と Work は残る。

オーナー：レポートから生成（タグ → ペルソナ → 視覚設定 → メイン立ち絵）、または文案を貼って立ち絵を上げる。視覚設定は人物と衣装を分離。メイン立ち絵は 3:4、上半身。レイヤー PSD で呼吸、まばたき、口パク。

頭と胴は発話と歌唱に追随。着替えはライブプレーヤーを破棄しない。メイン立ち絵から **ステッカーアバター**（頭のみ）を派生でき、アバター枠と Agent 通知に使う。メイン立ち絵を替えると無効。

ライブの顔は同時に一箇所。ブラウザ内レイヤー 2.5D（Anime2.5DRig）。その再生で Myriad サーバーは GPU 推論しない。

---

## Tapp

**Page**、ホームページ **Widget**、または両方。サンドボックス。インストール時に権限を承認。ホスト秘密とアプリ認証情報はサンドボックスに入らず、エラー文にも出ない。

- **ストア** — [Myriad-You/tapp-store](https://github.com/Myriad-You/tapp-store)、`/tapp/store`
- **Playground** — デスクトップ管理者、`/tapp/playground`。自然言語で Page、Widget のみ、または両方。本番サンドボックスでプレビュー。インストールまたは `.tapp` 書き出し。モバイル非表示
- **CLI** — [`@myriad-you/tapp-cli`](tools/tapp-cli/README.md)（`myriad-tapp init / check / pack`）

Page：Canvas / WebGL、パッケージ内アセット、音声、任意のホスト注入 Three.js。Widget は重い 3D 向けではない。[Tapp 開発](docs/development/TAPP_DEVELOPMENT.md)。

---

## Agent

| モード | 挙動 |
| --- | --- |
| **Chat** | ペルソナオン時はそのペルソナとしてのみ話す。検索、予約、生成、計画なし。着替えと、現在のプレーヤーの再生 / 停止 / スキップは可。 |
| **Work** | 計画、確認、実行。記憶、スキル、定期実行、MCP。範囲は付与された権限。 |

気づいた事項を Work に渡す提案ができる。提案の受理は自律許可ではない。任意の TTS、聞き取り。音声 / リアルタイム会話を設定すれば長押しで連続会話。

MCP：管理者の AI 設定。保存後ホットリロード。

---

## Brew

RSS、Notion、RSSHub。既定は誰でも閲覧可。ログインユーザーは既読と保存。管理者はソースを管理。相互リンクはホームページに出せる。

自身の記事：`/brew/item/...`。クローラは HTML シェル、ブラウザはアプリ。

---

## 連合

ActivityPub + **MFP**。発見は `BASE_URL` を使う。

フォロー：Actor URL（`https://your.domain/users/<name>`）または `@name@your.domain`。チャンネルとリングに対応。WebFinger、NodeInfo、inbox、連合メディアは **proxy → backend**。SPA には入らない。

注記：[連合](docs/development/FEDERATION.md)。連合ドメインの移転 ≠ 通常のドメイン変更。

---

## アカウントと公開範囲

- **ローカルアカウント：** オーナー作成後。登録のオン/オフ。OAuth 連携後、そのユーザーのパスワードログインを無効化できる。
- **OAuth：** 組み込み GitHub と任意の OIDC（Authentik、Keycloak、Google、Microsoft、GitLab、Discord、…）。身元は明示バインド。二つの issuer の同一メールはマージしない。
- **モジュール公開範囲：** ライブラリ、Brew、レポート、Tapp、Agent — 全員 / ログイン済み / 管理者。
- **検索と AI：** 非公開（noindex、空 sitemap、`/llms.txt` なし）、検索エンジンのみ、AI 引用、完全公開。
- **サイト識別：** 名前、紹介、アイコン、任意 PWA、壁紙とテーマ、第一者訪問統計、任意の Google Analytics / Umami。

---

## 運用

本番：**proxy + updater**。ホスト公開は **proxy** のみ。backend、frontend、Postgres、updater、docker-guard は内部ネット。

版切り替えとロールバック：`/config` → 情報 → 更新管理。ブラウザは `UPDATE_TOKEN` を受け取らない。`:latest` を上書きしない。

同梱 Postgres：updater は `./pgdata` をスナップショット。ロールバックはデータディレクトリとイメージ tag を戻す。外部 Postgres：`MYRIAD_DB_MODE=external`。ロールバックはイメージ tag のみ。[外部 PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md)。

約 1 GiB ホスト向けメモリ節約。`/config` の診断は実検査（データベース、ストレージ、版、出口）。報告に認証情報は含まない。

---

## 要件

**本番（Docker）**

- Docker + Compose
- ホストポート（`HTTP_PORT`、既定 80）
- linux/amd64 または linux/arm64

**ソースから**

- Rust 1.94+
- Node.js 24 LTS
- PostgreSQL 18（Compose 既定。下限は release `min_pg_version`）

---

## デプロイ

### Docker

```bash
git clone https://github.com/myriad-you/Myriad.git
cd Myriad

cp .env.production.example .env
# 必須: POSTGRES_PASSWORD / JWT_SECRET / CORS_ORIGINS
# BASE_URL / FRONTEND_URL = 公開オリジン（連合の発見は BASE_URL）
# UPDATE_TOKEN / UPDATER_GATEWAY_SECRET 空欄 → deploy.sh が生成

bash scripts/extra/deploy.sh up
```

`http://localhost`（または `HTTP_PORT`）を開き、ウィザードでデータベース、オーナー、サイト名を完了する。

公式 Compose は `DATABASE_URL` を設定済みのため、起動には `MYRIAD_SETUP_SECRET` が必要（`deploy.sh up` が生成）。ウィザードでデータベースを手入力する場合、この暗号は使わない。[Setup インストール暗号](docs/deployment/SETUP_BOOTSTRAP.md)。

```text
host HTTP_PORT → proxy → frontend:1102
                      → backend:1103 → postgres:5432
                      → updater（内部; updater-gateway 経由）
```

```bash
bash scripts/extra/deploy.sh status
bash scripts/extra/deploy.sh logs
bash scripts/extra/deploy.sh restart
bash scripts/extra/deploy.sh down
```

更新：`/config` → 情報 → 更新管理。手動 tag：`.env` の `MYRIAD_TAG` / `PROXY_TAG` のあと `bash scripts/extra/deploy.sh upgrade`。

同梱 Postgres のバックアップ：

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U myriad -d myriad > "backups/backup_$(date +%Y%m%d_%H%M%S).sql"
```

[クイックスタート](docs/QUICKSTART.md) · [Docker](docs/deployment/DOCKER_DEPLOYMENT.md) · [ポート](docs/deployment/PORTS.md) · [Docker なし](docs/deployment/NATIVE_DEPLOYMENT.md)

---

## ローカル開発

```bash
./scripts/dev.sh                   # TUI：メニュー、プロセス、データベース、ログ
./scripts/dev.sh start             # 本機 PostgreSQL。ログはこの端末
./scripts/dev.sh start --docker    # Docker postgres + 新しい端末
./scripts/dev.sh doctor            # ツールチェーン、ポート、データベース
./scripts/dev.sh status            # スナップショット
.\scripts\dev.ps1 start            # Windows
```

バックエンド `:1103`、フロントエンド `:1102`。本機データベースがなければ `./scripts/dev.sh db-setup`。

フロントの dev server は `/api/*`、`/health`、連合の公開パスをバックエンドへプロキシする。

開発 UI の更新管理：`./scripts/dev.sh start all-updater`。イメージ差し替え、メンテナンスモード、`pgdata` スナップショットは本番スタック（`scripts/extra/deploy.sh`）。

---

## アーキテクチャ

**開発**

```text
browser → Astro dev (:1102)
            └─ /api/*, /health, federation public paths → backend (:1103) → postgres
```

**本番**

```text
host HTTP_PORT
  → proxy
       ├─► frontend (:1102)          [myriad-net]
       ├─► backend (:1103) → postgres
       │       └─► updater-gateway → updater   [myriad-admin-net]
       │                                 └─► docker-guard → Docker sock
       └─ (rescue) updater when PROXY_ALLOW_DIRECT_UPDATER=true
```

クローラ / アプリ内シェア UA はホーム、ライブラリ、Brew、レポート、Tapp の SEO HTML シェルを受け取り、ブラウザは SPA を受け取る。[アーキテクチャ](docs/development/ARCHITECTURE.md)。

---

## リポジトリ

```
Myriad/
├── backend/          Rust API、SeaORM、migrations
├── frontend/         Astro + React UI、Tapp ランタイム、i18n（日/中/英）
├── proxy/            本番リバースプロキシ（独立 Cargo ツリー）
├── updater/          自己更新デーモン（独立 Cargo ツリー）
├── crates/           ワークスペースライブラリ
├── shared/           横断静的設定
├── docker/           backend / frontend Dockerfile
├── docs/             開発、デプロイ、機能（中国語）
├── scripts/          dev.sh / dev.ps1；extra/ デプロイ
├── release/          release.json 契約
├── tools/            tapp-cli、契約エクスポート
└── docker-compose*.yml
```

`proxy` と `updater` は独立 Cargo ツリー。

---

## 技術構成

| | |
| --- | --- |
| **フロントエンド** | Astro 7 · React 19 · Tailwind 4 · TypeScript · 日 / 中 / 英 |
| **バックエンド** | Rust · Axum 0.8 · SeaORM · Tokio |
| **エッジ** | proxy · updater |
| **データ** | PostgreSQL 18 |
| **拡張** | Agent · Tapp サンドボックス · MCP · ActivityPub / MFP |
| **デプロイ** | Docker Compose · linux/amd64 + arm64 |

---

## ドキュメント

現在は中国語。[入口](docs/INDEX.md)。

| | |
| --- | --- |
| [クイックスタート](docs/QUICKSTART.md) | デプロイとローカル開発 |
| [アーキテクチャ](docs/development/ARCHITECTURE.md) | コンポーネントとトポロジ |
| [ビルド](docs/development/BUILD.md) | ソースからのビルド |
| [API](docs/API.md) | HTTP API |
| [Tapp 開発](docs/development/TAPP_DEVELOPMENT.md) | Page / Widget / Playground / サンドボックス |
| [ライブラリ](docs/features/LIBRARY.md) | Library |
| [OAuth / ログイン](docs/development/OAUTH.md) | ローカルアカウントと OIDC |
| [連合](docs/development/FEDERATION.md) | ActivityPub / MFP |
| [Docker デプロイ](docs/deployment/DOCKER_DEPLOYMENT.md) | 本番オーケストレーション |
| [ポート](docs/deployment/PORTS.md) | ポートと公開面 |
| [Updater](docs/deployment/UPDATER_QUICKSTART.md) | 更新、ロールバック、救援 |
| [外部 PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md) | 外部 PG |
| [Docker なしデプロイ](docs/deployment/NATIVE_DEPLOYMENT.md) | PostgreSQL + バイナリ |
| [Setup インストール暗号](docs/deployment/SETUP_BOOTSTRAP.md) | オーケストレーション時の暗号 |

---

## 貢献

Issue と PR を歓迎。UI 文言：`ja-JP` / `zh-CN` / `en-US`。

## License

ホスト（`backend` / `frontend` およびワークスペース crate）と `proxy` / `updater` は [AGPL-3.0](LICENSE) です。文書化された Bridge だけを通してホストと話す Tapp は独立した著作物であり、そのライセンスは作者が決めます（`LICENSE` の AGPL 第 7 条追加許可を参照）。

Tapp の契約とツール（`crates/tapp-contract`、`tools/tapp-cli`、`tools/tapp-contract-export`）は [Apache-2.0](LICENSES/Apache-2.0.txt) です。

2.5D 再生：[Anime2.5DRig](https://github.com/852wa/Anime2.5DRig)（MIT）。

<br/>

<div align="center">
<sub><i>あなたという物語を、ひとつに</i> · <i>A myriad of lights, in one place.</i></sub>
<br/>
<sub>Maintained by <a href="https://github.com/myriad-you">@myriad-you</a></sub>
</div>
