<div align="center">

<img src="frontend/public/logo.webp" alt="Myriad" width="120" />

# Myriad

### あなたという物語を、ひとつに

*A myriad of lights, in one place.*

[English](README.md) · [中文](README.zh-CN.md) · **日本語**

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/myriad-you/Myriad)](https://github.com/myriad-you/Myriad/releases)
[![Built with Rust](https://img.shields.io/badge/built%20with-Rust-orange.svg)](backend/Cargo.toml)
[![Astro](https://img.shields.io/badge/Astro-7-blueviolet.svg)](frontend/package.json)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](frontend/package.json)

[クイックスタート](docs/QUICKSTART.md) · [ドキュメント](docs/INDEX.md) · [フィードバック](https://github.com/myriad-you/Myriad/issues)

</div>

---

## これは何か

GitHub でコードを書き、Bilibili で動画を見、Steam で遊び、網易雲で聴く。それぞれの場所に少しずつ自分が残るけれど、行き来はない。

**Myriad はセルフホストのホームページ兼創作工房です。** デジタルな暮らしは、ここで開いて並べて見せるための材料です。プラットフォームを集め、ライブラリを残し、サイト全体でひとつのペルソナと 2.5D ビジュアル、そして自分の Tapp を動かします。

自分で動かす **シングルテナント** です。公開の個人ポータルにも、自分だけの倉庫にもできます。データはあなた自身の PostgreSQL に入ります。UI は日本語・中国語・英語です。

セットアップ後の部屋は **ホーム**、**ライブラリ**、**Brew**、**レポート**、**Tapp**、それにいつでも開ける **Agent** です。`/config` は管理者だけです。

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
- [サイト、人、公開範囲](#サイト人公開範囲)
- [運用](#運用)
- [要件](#要件)
- [動かす](#動かす)
- [ローカル開発](#ローカル開発)
- [アーキテクチャ](#アーキテクチャ)
- [リポジトリ](#リポジトリ)
- [技術構成](#技術構成)
- [ドキュメント](#ドキュメント)
- [貢献](#貢献)
- [License](#license)

---

## 一覧

| 開くもの | 中身 |
| --- | --- |
| **ホーム** `/` | 対外の顔。ウィジェット、レイアウト、ペルソナ、音楽、Tapp ショートカット。 |
| **ライブラリ** `/library` | ゲーム、アニメ、映像、書籍、音楽。つないだプラットフォームから同期。 |
| **Brew** `/brew` | RSS / Notion / RSSHub リーダー。ゲストは閲覧、ログインユーザーは既読と保存。 |
| **レポート** `/reports` | 各プラットフォームの肖像。ペルソナ生成の材料にもなる。 |
| **Tapp** `/tapp` | 入れたアプリ。ストアは `/tapp/store`。Playground（管理者、デスクトップ）は `/tapp/playground`。 |
| **Agent** | サイトの助手。**会話**はペルソナとして話す。**仕事**は計画、ツール、記憶、MCP。 |
| **設定** `/config` | 管理者：プラットフォーム、AI、ユーザー、OAuth、公開範囲、アップデーター、診断。 |

ライブラリ、Brew、レポート、Tapp、Agent はモジュールごとに、全員 / ログイン済み / 管理者、と見せ方を変えられます。

---

## ホームページ

人が実際に開くのはホームページです。プラットフォームをつなぎ、ウィジェットを **標準グリッド**（中央寄せ、デスクトップ 16×4、狭い画面では詰め直し）か **自由レイアウト**（同じマス、キャンバス 16×8）に並べます。レイアウトは別々に座標を持ちます。自由レイアウトには装飾ステッカーも置けます。ステッカーはウィジェットではなく、枠数にも入りません。

組み込みウィジェット：

- 歓迎
- Agent ペルソナ（ライブ 2.5D。同時に一箇所でしか再生しない）
- 概要、最近の活動、訪問統計
- 天気、一言
- 音楽プレーヤー
- 相互リンク（Brew から）
- ソーシャル、Tapp ショートカット
- miHoYo ゲーム Presence
- 接続済みプラットフォームごとの Report Card

入れた Tapp も、ホームページ用ウィジェットを登録できます。

人が見るのはあなたのホームページです。プラットフォームのデータは自分のデータベースに留まり、よそのホストには渡しません。

---

## プラットフォーム

必要なものだけつなぎます。

| プラットフォーム | Myriad が取るもの |
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

データは PostgreSQL に入ります。ホームページの Report Card、ライブラリ、レポートは同じデータベースから読みます。

---

## ライブラリとレポート

**ライブラリ**はゲーム、アニメ、映像、書籍、音楽を滝レイアウトにまとめ、種類で絞り、つないだプラットフォームから同期します。通常リストか無限キャンバス（低スペックではリストに戻る）。カテゴリごとに出すソースを選べます。

**レポート**は各サービスの肖像です。ペルソナ生成には何通か要ります——サイト上の性格は、他所に残した跡から作られ、空のプロンプトからは作られません。

---

## ペルソナと 2.5D ビジュアル

サイト全体でひとつの話し手と、上半身の 2.5D ビジュアル。UI 名は **Agent ペルソナ** で、別製品ではありません。オフにしても助手は Agent のまま、会話と仕事だけになります。

サイトオーナーの手順：

1. レポートからタグを拾う
2. ペルソナを書く（名前、気質、話し方）
3. 視覚設定を確定する（人物と衣装は別）
4. メイン立ち絵を出す（3:4、上半身）
5. レイヤー PSD を入れる。ライブの顔は呼吸し、まばたきし、口が合う

話す・歌うと頭と胴がついて動きます。着替えでプレーヤーを捨てる必要はありません。メイン立ち絵から **ステッカーアバター**（頭だけ）も作れ、アバター枠と Agent 通知に使えます。メイン立ち絵を変えたら作り直しです。

ライブの顔は同時に一箇所——ホームページのウィジェットか Agent パネルか、どちらかです。再生はブラウザ内のレイヤー 2.5D（Anime2.5DRig）です。Myriad の本バックエンドは顔のために第三者モデルを載せず、GPU 推論も走りません。

---

## Tapp

Tapp は Myriad に載せる小さなアプリです。ページ全体の **Page**、ホームに埋める **Widget**、または両方。サンドボックスで動き、インストール時に権限をあなたが承認します。ホストの秘密もアプリの認証情報もサンドボックスに入りません。エラー文にも出ません。

入れ方は三つ：

- **ストア** — [Myriad-You/tapp-store](https://github.com/Myriad-You/tapp-store)、`/tapp/store` から
- **Playground** — デスクトップの管理者のみ、`/tapp/playground`。Page、Widget のみ、または両方を自然言語で書いて、本番サンドボックスでプレビューし、インストールするか `.tapp` を書き出す。モバイルには出ない
- **CLI** — [`@myriad-you/tapp-cli`](tools/tapp-cli/README.md)（`myriad-tapp init / check / pack`）

Page は Canvas / WebGL、パッケージ内アセット、音声、（宣言すれば）ホスト注入の Three.js が使えます。Widget で重い 3D は想定していません。詳細は [Tapp 開発](docs/development/TAPP_DEVELOPMENT.md)。

---

## Agent

サイトの助手です。内部名は出しません。UI は **Agent** です。

| モード | すること |
| --- | --- |
| **会話** | ペルソナとして話すだけ。検索、予約、生成、計画のツールは持たない。着替えと、今の音楽プレーヤーの再生 / 停止 / スキップはその場でできる。 |
| **仕事** | 計画、確認、実行。記憶、スキル、定期実行、MCP。どこまでできるかは権限の一つひとつで決まり、役割では分かれない。 |

何かに気づくと **仕事** に渡す提案を出せます。提案を受けることと、勝手に動いてよいこととは別です。任意の音声：返答の読み上げ、聞き取り。設定すれば長押しで連続会話。

MCP サーバーは管理者の AI 設定で配り、保存後にホットリロードします。

---

## Brew

RSS、Notion、RSSHub のリーダーです。ゲストは読める。ログインユーザーは既読と保存。管理者はソースを管理します。Brew の相互リンクはホームページに置けます。

自分の記事は `/brew/item/...` にあり、共有できます（クローラは HTML シェル、ブラウザはアプリ）。

---

## 連合

ActivityPub + **MFP**。`BASE_URL` を公開オリジンにしてください。発見はそれを使います。

他インスタンスは Actor URL（`https://your.domain/users/<name>`）や `@name@your.domain` でフォローし、チャンネルを開き、リングに入れます。WebFinger、NodeInfo、inbox、連合メディアは **proxy → backend** で、SPA には入りません。

動き方は [連合](docs/development/FEDERATION.md)。連合ドメインの引っ越しと、ただのドメイン変更は別手順です。ドキュメント入口を見てください。

---

## サイト、人、公開範囲

- **ローカルアカウント：** オーナー作成後。登録のオンオフ可。OAuth で足りればパスワードログインを止められる。
- **OAuth：** 組み込み GitHub に加え、OIDC を何個でも（Authentik、Keycloak、Google、Microsoft、GitLab、Discord、…）。身元は明示バインド。二つの issuer で同じメールでも黙ってマージしません。
- **ページの見せ方：** ライブラリ、Brew、レポート、Tapp、Agent — 全員 / ログイン済み / 管理者。
- **検索と AI の見せ方：** 非公開（noindex、空の sitemap、`/llms.txt` なし）、検索エンジンのみ、AI 引用を許可、完全公開。
- **サイトの顔：** 名前、紹介、アイコン、任意の PWA、壁紙とテーマ、第一者の訪問統計、任意の Google Analytics / Umami。

---

## 運用

本番は **proxy + updater** です。ホストに公開されるのは **proxy** だけ。backend、frontend、Postgres、updater、docker-guard は内部ネットです。

版の切り替えとロールバックは管理者の「更新管理」（`/config` → 情報）。ブラウザは `UPDATE_TOKEN` を見ません。`:latest` を手で上書きしないでください。

同梱 Postgres：updater は `./pgdata` をスナップショットし、ロールバックでデータディレクトリとイメージ tag を戻せます。外部 Postgres：`MYRIAD_DB_MODE=external`。ロールバックはイメージ tag だけ。 [外部 PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md)。

小さいホスト（およそ 1 GB）向けのメモリ節約プロファイルがあります。`/config` の診断はデータベース、ストレージ、版、出口を実際に調べ、認証情報を含まない報告を出します。

---

## 要件

**本番（Docker、推奨）**

- Docker + Compose
- ホストのポート（`HTTP_PORT`、既定 80）
- linux/amd64 または linux/arm64（公式イメージ）

**ソースから**

- Rust 1.94+
- Node.js 24 LTS
- PostgreSQL 18（Compose 既定。互換下限は release の `min_pg_version`）

---

## 動かす

### Docker

```bash
git clone https://github.com/myriad-you/Myriad.git
cd Myriad

cp .env.production.example .env
# 必須: POSTGRES_PASSWORD / JWT_SECRET / CORS_ORIGINS
# BASE_URL / FRONTEND_URL には公開ドメインを（連合の発見は BASE_URL に依存）
# UPDATE_TOKEN / UPDATER_GATEWAY_SECRET は空のままで、deploy スクリプトが生成します

bash scripts/extra/deploy.sh up
```

`http://localhost`（または `.env` の `HTTP_PORT`）を開き、ウィザードでデータベース、オーナー、サイト名を済ませます。

公式 compose は `MYRIAD_SETUP_SECRET` がないと起動しません（ウィザード側でデータベースを入れる場合を除く）。`deploy.sh up` が生成します。 [Setup インストール暗号](docs/deployment/SETUP_BOOTSTRAP.md)。

```text
host HTTP_PORT → proxy → frontend:1102
                      → backend:1103 → postgres:5432
                      → updater（内部のみ; updater-gateway 経由）
```

よく使うもの：

```bash
bash scripts/extra/deploy.sh status
bash scripts/extra/deploy.sh logs
bash scripts/extra/deploy.sh restart
bash scripts/extra/deploy.sh down
```

日常の更新：`/config` → 情報 → 更新管理。手でイメージを上げる：`.env` の `MYRIAD_TAG` / `PROXY_TAG` を変え、`bash scripts/extra/deploy.sh upgrade`。

バックアップ（同梱 Postgres）：

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U myriad -d myriad > "backups/backup_$(date +%Y%m%d_%H%M%S).sql"
```

より詳しいデプロイ、ポート、Docker なし、トラブルシュート：[クイックスタート](docs/QUICKSTART.md)、[Docker](docs/deployment/DOCKER_DEPLOYMENT.md)、[ポート](docs/deployment/PORTS.md)、[Docker なし](docs/deployment/NATIVE_DEPLOYMENT.md)。

---

## ローカル開発

```bash
./scripts/dev.sh                   # ライブ TUI：起動メニュー + プロセス / データベース / ログ
./scripts/dev.sh start             # 本機 PostgreSQL、ログはこの端末
./scripts/dev.sh start --docker    # Docker postgres + 新しい端末
./scripts/dev.sh doctor            # ツールチェーン、ポート、データベース
./scripts/dev.sh status            # 一回きりのスナップショット
.\scripts\dev.ps1 start            # Windows
```

バックエンド `:1103`、フロントエンド `:1102`。本機にデータベースがなければ先に `./scripts/dev.sh db-setup`。

フロントの dev server は `/api/*`、`/health`、連合の公開パスをバックエンドへプロキシします。

開発 UI で「更新管理」を試すなら `./scripts/dev.sh start all-updater`。本物のイメージ差し替え、メンテナンスモード、`pgdata` スナップショットは本番スタック（`scripts/extra/deploy.sh`）で。

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

クローラ / アプリ内シェア UA はホーム、ライブラリ、Brew、レポート、Tapp の SEO HTML シェルを受け取り、普通のブラウザは SPA に入ります。 [アーキテクチャ](docs/development/ARCHITECTURE.md)。

---

## リポジトリ

```
Myriad/
├── backend/          Rust API、SeaORM、migrations
├── frontend/         Astro + React UI、Tapp ランタイム、i18n（日/中/英）
├── proxy/            本番入口のリバースプロキシ（独立 Cargo ツリー、AGPL-3.0）
├── updater/          自己更新デーモン（独立 Cargo ツリー、AGPL-3.0）
├── crates/           ワークスペース共有ライブラリ
├── shared/           コンポーネント横断の静的設定
├── docker/           backend / frontend Dockerfile
├── docs/             開発、デプロイ、機能ドキュメント（現在は中国語が中心）
├── scripts/          dev.sh / dev.ps1；extra/ デプロイと手動回帰
├── release/          release.json 契約とオーバーレイ
├── tools/            tapp-cli と契約エクスポート
└── docker-compose*.yml
```

`proxy` と `updater` は独立した Cargo ツリーで、デプロイ寿命を分けられます。

---

## 技術構成

| | |
| --- | --- |
| **フロントエンド** | Astro 7 · React 19 · Tailwind 4 · TypeScript · 日 / 中 / 英 |
| **バックエンド** | Rust · Axum 0.8 · SeaORM · Tokio |
| **エッジ** | proxy（リバースプロキシ / メンテナンスページ）· updater（自己更新 / スナップショット） |
| **データ** | PostgreSQL 18（Compose 既定イメージ） |
| **拡張** | Agent · Tapp サンドボックス · MCP · ActivityPub / MFP |
| **デプロイ** | Docker Compose · linux/amd64 + arm64 イメージ |

---

## ドキュメント

現在は中国語が中心です。[ドキュメント入口](docs/INDEX.md) から。

| | |
| --- | --- |
| [クイックスタート](docs/QUICKSTART.md) | デプロイとローカル開発 |
| [アーキテクチャ](docs/development/ARCHITECTURE.md) | コンポーネントとトポロジ |
| [ビルド](docs/development/BUILD.md) | ツールチェーンとソースからのビルド |
| [API](docs/API.md) | HTTP API |
| [Tapp 開発](docs/development/TAPP_DEVELOPMENT.md) | Page / Widget / Playground / サンドボックス |
| [ライブラリ](docs/features/LIBRARY.md) | Library |
| [OAuth / ログイン](docs/development/OAUTH.md) | ローカルアカウントと OIDC |
| [連合](docs/development/FEDERATION.md) | ActivityPub / MFP |
| [Docker デプロイ](docs/deployment/DOCKER_DEPLOYMENT.md) | 本番オーケストレーション |
| [ポート](docs/deployment/PORTS.md) | ポートと公開面 |
| [Updater](docs/deployment/UPDATER_QUICKSTART.md) | 更新、ロールバック、救援 |
| [外部 PostgreSQL](docs/deployment/EXTERNAL_POSTGRES.md) | 持ち込み PG |
| [Docker なしデプロイ](docs/deployment/NATIVE_DEPLOYMENT.md) | 本機 PostgreSQL + バイナリ |
| [Setup インストール暗号](docs/deployment/SETUP_BOOTSTRAP.md) | オーケストレーション時のインストール暗号 |

---

## 貢献

Issue と PR を歓迎します。UI 文言は `ja-JP` / `zh-CN` / `en-US` を揃えてください。

## License

ルートリポジトリと本アプリは [GPL-3.0](LICENSE) です。`proxy` / `updater` は別に AGPL-3.0 です。

2.5D 再生は [Anime2.5DRig](https://github.com/852wa/Anime2.5DRig)（MIT）を使います。

<br/>

<div align="center">
<sub><i>あなたという物語を、ひとつに</i> · <i>A myriad of lights, in one place.</i></sub>
<br/>
<sub>Maintained by <a href="https://github.com/myriad-you">@myriad-you</a></sub>
</div>
