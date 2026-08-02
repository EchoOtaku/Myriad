use axum::{http::StatusCode, Json};
use serde_json::{json, Value};

pub mod admin_users;
pub mod agent; // 🤖 AI Agent 自然语言任务编排 API
pub mod ai_recommend; // ✅ AI图标推荐 API
pub mod analysis;
pub mod analytics; // 📊 站点访客 / 页面访问统计
pub mod auth;
pub mod auth_local;
pub mod bangumi;
pub mod bilibili;
pub mod brew; // ✅ Brew 阅读 RSS/Atom/JSON Feed 订阅 API
pub mod brewlia; // ✅ Brewlia AI增强阅读 API
pub mod cache; // ✅ 缓存管理 API
pub mod config;
pub mod diagnostics;
pub mod discord;
pub mod federation; // 联邦 HTTP 适配层（自 main 迁出） // ✅ Discord 数据平台 API
pub mod game_presence; // ✅ 游戏平台公开状态（Enka / Xbox / PSN，无用户 Cookie）
pub mod mal; // ✅ MyAnimeList 数据平台 API
pub mod metrics; // ✅ 系统监控指标 API (P2优化)
pub mod notification_preferences;
pub mod oauth; // 🔐 通用 OAuth handler (PR #2 — 取代 auth.rs 里的硬编码 GitHub 流)
pub mod platforms;
pub mod profile;
pub mod prompt;
pub mod proxy;
pub mod reports; // ✅ 双层报告系统API
pub mod seo; // 🔍 公开 sitemap.xml 等 SEO 端点
pub mod setup;
pub mod setup_bootstrap;
pub mod site_domain; // 🌐 Site public domain (BASE_URL / FRONTEND_URL / CORS) — not federation Move
pub mod speech; // 🎙️ 腾讯云语音服务 API (TTS/ASR)
pub mod steam;
pub mod system;
pub mod tapp_playground; // 🧪 Pro AI 驱动的临时 Tapp 开发环境
pub mod tapp_runtime; // ✅ Tapp 运行时 API（平台数据、AI、上下文、事件…）
pub mod tapp_scheduler; // ✅ Tapp 定时任务调度 API
pub mod tapp_store; // ✅ Tapp 应用商店/管理 API（安装、卸载、配置…）
pub mod tasks; // ✅ 后台任务管理 API
pub mod updater_admin; // 🚀 Updater admin proxy
pub mod x; // ✅ X (Twitter) 平台 API
pub mod youtube; // ✅ YouTube Data API v3（公开频道，API key only）

// Process / build identity: workspace crate `myriad-process-info` (agent + /health).
// Binary package version is injected at startup so fallback is myriad-backend's, not the helper crate's.
pub use myriad_process_info::{build_commit_sha, build_version, process_uptime_seconds};

/// Call once from binary main after logging is ready.
pub fn init_process_identity() {
    myriad_process_info::set_package_version_fallback(concat!("v", env!("CARGO_PKG_VERSION")));
    myriad_process_info::mark_startup();
}

/// `/health` endpoint consumed by the Myriad updater health probe.
///
/// Returns the schema described in docs/updater-spec.md §11.1:
///
/// ```json
/// {
///   "status": "ok",
///   "version": "v1.2.3",
///   "schema_version": 1,
///   "db_connected": true,
///   "migrations_applied": true,
///   "uptime_seconds": 123
/// }
/// ```
///
/// Older fields (`service`, `mode`, `database_connected`) are preserved for backwards
/// compatibility with existing dashboards.
pub async fn health() -> (StatusCode, Json<Value>) {
    use std::sync::atomic::Ordering;

    let config_mode = crate::CONFIG_MODE.load(Ordering::Relaxed);
    // Process DB handle (may exist while still on setup-only route table until restart).
    let db_connected = crate::services::tapp_registry::database().await.is_ok();
    // Route table is fixed at process start: config-mode router vs full router.
    // Do not equate CONFIG_MODE=false with "full APIs" without a cold start.
    let routes_full = !config_mode && db_connected;
    let migrations_applied = routes_full;

    // Build-time version injected via `MYRIAD_VERSION` env var (set by Dockerfile build-arg).
    // Falls back to crate version so local `cargo run` still works.
    let version = build_version();
    let commit_sha = build_commit_sha();

    let uptime = process_uptime_seconds();

    (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "schema_version": 1,
            "version": version,
            "commit_sha": commit_sha,
            "db_connected": db_connected,
            "migrations_applied": migrations_applied,
            "routes_full": routes_full,
            // Reaching the server implies the startup storage write preflight passed.
            "storage_writable": true,
            "uptime_seconds": uptime,

            // backwards-compatible fields
            "service": "myriad-backend",
            "mode": if config_mode || !routes_full {
                "configuration"
            } else {
                "full"
            },
            "database_connected": db_connected,
        })),
    )
}
