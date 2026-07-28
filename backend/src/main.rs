use axum::{
    extract::Request,
    http::StatusCode,
    middleware::{from_fn, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod config;
mod db;
mod extract;
mod federation;
mod middleware;
mod models;
mod oauth_url_builder;
mod services;
mod util;

use config::{AppConfig, DynamicConfig};
use sea_orm::ConnectionTrait;
use services::config_service::ConfigService;
use std::sync::atomic::{AtomicBool, Ordering}; // P1: 用于数据库健康检查

// Global flag to indicate if server is running in configuration mode
pub static CONFIG_MODE: AtomicBool = AtomicBool::new(false);

/// 小请求体联邦端点的上限（64 KiB）。
///
/// 这些端点原本用 `to_bytes(req.into_body(), 64 * 1024)` 自己封顶。改用 `Json<T>`
/// 提取器后上限由 layer 决定，若不显式加这一层就会退回到路由级的 40 MiB ——
/// 一个只需要几百字节 JSON 的端点没有理由允许缓冲 40 MiB。
/// `?limit=` 查询参数。
///
/// 用 `Option<String>` 而不是 `Option<i64>` 是为了保持原有的宽松语义：
/// 手写解析对 `limit=abc` / `limit=` 是静默回落到默认值，而 `Option<i64>`
/// 会让 serde 直接拒绝成 400。行为改变不该夹带在重构里。
#[derive(serde::Deserialize)]
struct LimitQuery {
    limit: Option<String>,
}

impl LimitQuery {
    fn or(&self, default: i64) -> i64 {
        self.limit
            .as_deref()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(default)
    }
}

/// `?limit=&cancelled_only=` 查询参数。
///
/// `cancelled_only` 保持原有的宽松真值解析（`1|true|yes|on`，其余一律 false）。
/// 换成 `Option<bool>` 会让 serde 只认 `true`/`false`，把 `?cancelled_only=1`
/// 变成 400 —— 前端正在用的写法。
#[derive(serde::Deserialize)]
struct PurgeDeadQuery {
    limit: Option<String>,
    cancelled_only: Option<String>,
}

impl PurgeDeadQuery {
    fn limit_or(&self, default: i64) -> i64 {
        self.limit
            .as_deref()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(default)
    }

    fn cancelled_only(&self) -> bool {
        self.cancelled_only
            .as_deref()
            .map(|s| matches!(s.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false)
    }
}

/// 分页与过滤查询参数（消息列表、房间文件列表共用）。
///
/// 全部字段用 `Option<String>`：手写解析对 `limit=abc` 是静默忽略、回落到
/// 「不限制」，而 `Option<i64>` 会让 serde 直接拒成 400。`filter` / `q` 本就是
/// 字符串，`list_room_files` 才用得到。
#[derive(serde::Deserialize)]
struct ListQuery {
    before: Option<String>,
    limit: Option<String>,
    filter: Option<String>,
    q: Option<String>,
}

impl ListQuery {
    fn before(&self) -> Option<&str> {
        self.before.as_deref()
    }

    /// 解析失败即 `None`（与手写的 `.and_then(|s| s.parse().ok())` 一致）。
    fn limit(&self) -> Option<i64> {
        self.limit.as_deref().and_then(|v| v.parse::<i64>().ok())
    }

    fn filter(&self) -> Option<&str> {
        self.filter.as_deref()
    }

    fn q(&self) -> Option<&str> {
        self.q.as_deref()
    }
}

/// 把 `Json<T>` 提取失败翻译成本项目的 JSON 错误体。
///
/// 直接用 `Json<T>` 会让超限 body 拿到 axum 的纯文本 413，丢掉
/// `send_room_message` 原有的那句运维指引（"内联图片上限 ~32 MiB，
/// 更大的走分块传输"）—— 那是用户真正需要看到的下一步动作。
///
/// 体积类拒绝（413）附带 `size_hint`，其余按原状态码返回解析错误详情。
fn json_rejection_response(
    rejection: axum::extract::rejection::JsonRejection,
    size_hint: Option<&str>,
) -> Response {
    let status = rejection.status();
    if status == StatusCode::PAYLOAD_TOO_LARGE {
        let mut body = json!({"error": "Request body too large or unreadable"});
        if let Some(hint) = size_hint {
            body["hint"] = json!(hint);
        }
        return (status, Json(body)).into_response();
    }
    (status, Json(json!({"error": rejection.body_text()}))).into_response()
}

const FEDERATION_SMALL_BODY_LIMIT: usize = federation::limits::SMALL_CONTROL_BODY_LIMIT;

/// Fail-soft: production images run as uid 1000 (`myriad`); root is a hygiene warning only.
fn warn_if_running_as_root() {
    #[cfg(unix)]
    {
        // Avoid a libc crate dep: libc geteuid is ubiquitous on Unix.
        extern "C" {
            fn geteuid() -> u32;
        }
        // SAFETY: geteuid is a pure syscall with no arguments.
        let uid = unsafe { geteuid() };
        if uid == 0 {
            tracing::warn!(
                "backend is running as root (uid 0); production compose should use non-root USER myriad (de-root)"
            );
        }
    }
}

// Global database connection (None in config mode, Some in full mode)
pub static DB_CONNECTION: once_cell::sync::Lazy<Arc<RwLock<Option<sea_orm::DatabaseConnection>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(None)));

// Global core configuration (hot-reloadable)
pub static GLOBAL_CONFIG: once_cell::sync::Lazy<Arc<RwLock<AppConfig>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(AppConfig::default())));

// Global dynamic configuration from database (hot-reloadable)
pub static GLOBAL_DYNAMIC_CONFIG: once_cell::sync::Lazy<Arc<RwLock<DynamicConfig>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(DynamicConfig::default())));

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env before any component reads environment variables.
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "myriad_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!(
        version = api::build_version(),
        commit_sha = ?api::build_commit_sha(),
        "🚀 Starting Myriad Backend"
    );

    // Production compose de-roots backend (USER myriad). Warn once if still root.
    warn_if_running_as_root();

    // Record process start time for /health.uptime_seconds.
    api::mark_startup();

    // Initialise the updater proxy client. None if env not set; routes still register
    // and return a clean 503.
    let updater_client = services::updater_client::UpdaterClient::from_env();
    if let Some(c) = &updater_client {
        tracing::info!(
            base_url = %c.base_url(),
            can_mutate = c.can_mutate(),
            "updater client configured"
        );
        // Best-effort reachability probe. Don't block startup — the updater container may
        // still be coming up, and admin routes return 503 cleanly when unreachable.
        let probe = c.clone();
        tokio::spawn(async move {
            match probe.ping().await {
                Ok(_) => tracing::info!("updater /healthz: reachable"),
                Err(e) => {
                    tracing::warn!(err = %e, "updater /healthz: unreachable on startup (will retry on demand)")
                }
            }
        });
    } else {
        tracing::info!(
            "no updater client configured (set MYRIAD_UPDATER_URL + UPDATER_GATEWAY_SECRET to enable)"
        );
    }
    api::updater_admin::init(updater_client);

    run_server().await?;

    tracing::info!("👋 Backend shutdown complete");
    Ok(())
}

/// Cache-Control for statically served frontend assets. `ServeDir` emits only
/// `Last-Modified`, so without this every asset forces a revalidation round-trip
/// per navigation (dozens of unhashed icons ⇒ dozens of conditional GETs). Tiers:
///   - `/assets/*`  content-hashed by Astro → immutable, cache for a year.
///   - media/fonts  unhashed but rarely change → week-long TTL, revalidate in
///     the background while serving the stale copy.
///   - `/sw.js` + HTML  must always revalidate so a new deploy (and its fresh
///     hashed-asset references) lands immediately.
fn static_asset_cache_control(path: &str) -> &'static str {
    if path.starts_with("/assets/") {
        return "public, max-age=31536000, immutable";
    }
    if path == "/sw.js" {
        return "no-cache";
    }
    let is_longlived_static = path.starts_with("/icons/")
        || path.starts_with("/game-logos/")
        || path.starts_with("/fonts/")
        || path.ends_with(".webp")
        || path.ends_with(".png")
        || path.ends_with(".jpg")
        || path.ends_with(".jpeg")
        || path.ends_with(".gif")
        || path.ends_with(".svg")
        || path.ends_with(".avif")
        || path.ends_with(".ico")
        || path.ends_with(".woff")
        || path.ends_with(".woff2");
    if is_longlived_static {
        return "public, max-age=604800, stale-while-revalidate=86400";
    }
    "no-cache"
}

async fn run_server() -> anyhow::Result<()> {
    // Load configuration
    let config = AppConfig::from_env()?;

    services::data_paths::verify_runtime_storage_writable().map_err(|error| {
        anyhow::anyhow!(
            "backend storage preflight failed; repair /app/data and /app/cache ownership/permissions for uid 1000: {error}"
        )
    })?;
    tracing::info!(
        data_dir = %services::data_paths::paths().root.display(),
        cache_dir = %services::data_paths::paths().cache.display(),
        "backend storage write preflight passed"
    );

    // Initialize global config
    *GLOBAL_CONFIG.write().await = config.clone();
    tracing::info!("✅ Configuration loaded and cached globally");

    // ✅ 安全修复: 验证 JWT 密钥强度
    match std::env::var("JWT_SECRET") {
        Ok(secret) => {
            if secret.len() < 32 {
                tracing::error!(
                    "🚨 JWT_SECRET is too weak ({} chars). Minimum 32 characters required for security.",
                    secret.len()
                );
                if std::env::var("ENVIRONMENT").unwrap_or_default() == "production" {
                    anyhow::bail!(
                        "JWT_SECRET must be at least 32 characters in production environment"
                    );
                } else {
                    tracing::warn!("⚠️  Continuing with weak JWT_SECRET in development mode. DO NOT use in production!");
                }
            } else {
                tracing::info!("✅ JWT_SECRET strength validated ({} chars)", secret.len());
            }
        }
        Err(_) => {
            tracing::warn!("⚠️  JWT_SECRET not configured. Authentication features will not work.");
        }
    }

    // Try to initialize database connection if URL is configured.
    // When DATABASE_URL is set (external DB / compose), retry with backoff before
    // falling into CONFIGURATION MODE — a single pool timeout after stack restart
    // must not permanently strand production deploys. Empty URL keeps first-boot setup.
    if !config.database_url.is_empty() {
        let db_target = db::connection::redact_database_url(&config.database_url);
        match db::connection::establish_connection_with_retry(&config.database_url).await {
            Ok(db) => {
                tracing::info!(db_target = %db_target, "✅ Database connection established");

                // Retired migration files have been folded into the base schema.
                // Remove only their known history rows before SeaORM validates
                // migration-file/history parity; schema_check owns the backfill.
                if let Err(e) = db::schema_check::reconcile_retired_migration_history(&db).await {
                    tracing::warn!("Failed to reconcile retired migration history: {}", e);
                }

                // Run database migrations automatically on startup (idempotent - skips already applied migrations)
                use sea_orm_migration::MigratorTrait;
                tracing::debug!("Checking for pending database migrations...");
                match migration::Migrator::up(&db, None).await {
                    Ok(_) => {
                        tracing::info!("✅ Database migrations up to date");
                    }
                    Err(e) => {
                        // Log the error but don't stop the service
                        // Migrations might fail if tables already exist from manual setup
                        tracing::warn!("⚠️  Database migration check failed: {}", e);
                        tracing::info!("Continuing with existing database schema...");
                    }
                }

                // Auto-complete missing schema fields (safe, idempotent operation)
                if let Err(e) = db::schema_check::ensure_schema(&db).await {
                    tracing::warn!("⚠️  Schema check failed: {}", e);
                    tracing::info!("Continuing with existing schema...");
                }

                match api::tapp_store::recover_tapp_filesystem_state(&db).await {
                    Ok(0) => {}
                    Ok(count) => {
                        tracing::warn!(count, "Recovered interrupted Tapp filesystem transactions")
                    }
                    Err(error) => tracing::error!(
                        %error,
                        "Failed to inspect Tapp filesystem transaction state"
                    ),
                }

                // Load dynamic configuration from database
                let config_service = ConfigService::new(db.clone());

                // Load the merged configuration
                match config_service.load_config().await {
                    Ok(dynamic_config) => {
                        *GLOBAL_DYNAMIC_CONFIG.write().await = dynamic_config;
                        tracing::info!("✅ Dynamic configuration loaded from database");
                    }
                    Err(e) => {
                        tracing::warn!("⚠️  Failed to load dynamic config: {}", e);
                        tracing::info!("Using default configuration");
                    }
                }

                // Validate GitHub OAuth configuration (after database config is loaded)
                // This is informational only - OAuth will work if configured in database
                use oauth_url_builder::OAuthUrlBuilder;
                if let Err(e) = OAuthUrlBuilder::validate_github_oauth_config().await {
                    tracing::debug!("ℹ️  GitHub OAuth status: {}", e);
                }

                // 🔐 Load OAuth provider registry (GitHub + future OIDC providers)
                services::oauth::registry::init().await;
                tracing::info!(
                    "✅ OAuth providers loaded: {}",
                    services::oauth::registry::REGISTRY.list().await.len()
                );

                // 通知中心必须先于任何后台调度器启动；interval 首次 tick 会立即执行，
                // 否则启动阶段的 Tapp/Brew/MCP 事件会静默丢失。
                services::agent::notifications::init_notifications(db.clone()).await;
                api::updater_admin::resume_pending_job_notifications().await;
                tracing::info!("✅ Agent notification system initialized");

                // Initialize Tapp scheduler engine
                api::tapp_scheduler::init_scheduler(db.clone()).await;
                tracing::info!("✅ Tapp scheduler engine initialized");

                // Reconcile Myriad Core platform refresh jobs after the shared
                // scheduler is ready. Failure does not block startup; the admin
                // settings save path will retry and report the error directly.
                match api::config::reconcile_platform_auto_refresh(&db).await {
                    Ok(summary) => tracing::info!(
                        enabled_tasks = summary.enabled_tasks,
                        disabled_tasks = summary.disabled_tasks,
                        interval_hours = summary.interval_hours,
                        "✅ Core platform auto-refresh tasks reconciled"
                    ),
                    Err(error) => tracing::warn!(
                        "Failed to reconcile Core platform auto-refresh tasks: {}",
                        error
                    ),
                }

                // Initialize Brew scheduler engine (RSS/Atom feed updates)
                services::brew_scheduler::init_brew_scheduler(db.clone()).await;
                tracing::info!("✅ Brew scheduler engine initialized");

                // Initialize Agent identity system (SOUL.md / USER.md)
                let agent_data_dir = std::path::PathBuf::from("data/agent");
                services::agent::identity::init_identity(agent_data_dir.clone()).await;
                tracing::info!("✅ Agent identity system initialized");

                // Initialize Agent skill system
                services::agent::skill::init_skills(agent_data_dir.join("skills")).await;
                tracing::info!("✅ Agent skill system initialized");

                // Initialize Agent skill evolution system
                services::agent::skill_evolution::init_skill_evolution(
                    agent_data_dir.join("skills"),
                )
                .await;
                tracing::info!("✅ Agent skill evolution system initialized");

                // Initialize Agent memory system
                services::agent::memory::init_memory(agent_data_dir.join("memory")).await;
                tracing::info!("✅ Agent memory system initialized");

                // Initialize MCP (Model Context Protocol) client
                services::agent::mcp::init_mcp(&agent_data_dir.join("mcp_servers.json")).await;
                tracing::info!("✅ MCP client initialized");

                // Initialize Agent task store (DB persistence + recovery)
                services::agent::init_task_store(db.clone()).await;
                tracing::info!("✅ Agent task store initialized");

                // Re-create run hubs + wait-loops for waiting_for_input tasks so
                // answer/subscribe work after process restart.
                api::agent::restore_waiting_runs_after_boot().await;
                tracing::info!("✅ Agent waiting-task run hubs restored");

                // Expire persisted Tapp Agent interactions and resume their
                // waiting Executor tasks. Every replica runs this; DB CAS
                // ensures a single terminal transition.
                api::tapp_runtime::spawn_agent_interaction_expiry_worker(db.clone());
                tracing::info!("✅ Tapp Agent interaction expiry worker started");

                // Initialize Agent heartbeat system
                services::agent::heartbeat::init_heartbeat(agent_data_dir.join("HEARTBEAT.md"))
                    .await;
                tracing::info!("✅ Agent heartbeat system initialized");

                // Spawn confirmation cleanup background worker
                tokio::spawn(async {
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
                    loop {
                        interval.tick().await;
                        services::agent::cleanup_expired_confirmations().await;
                    }
                });
                tracing::info!("✅ Agent confirmation cleanup worker started");

                // Spawn heartbeat background worker
                {
                    let heartbeat_db = db.clone();
                    tokio::spawn(async move {
                        // Heartbeat 独立 Semaphore（上限 2，防止风暴）
                        let semaphore = Arc::new(tokio::sync::Semaphore::new(2));
                        let mut interval =
                            tokio::time::interval(std::time::Duration::from_secs(60));
                        // 系统休眠恢复后跳过积压的 tick，避免同一分钟内连续触发
                        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                        let mut tick_count: u64 = 0;

                        loop {
                            interval.tick().await;
                            tick_count = tick_count.wrapping_add(1);

                            // 每小时清理过期认领桶（保留 48h）
                            if tick_count.is_multiple_of(60) {
                                services::agent::heartbeat::HeartbeatManager::cleanup_old_claims(
                                    &heartbeat_db,
                                    48,
                                )
                                .await;
                            }

                            let hb = match services::agent::heartbeat::get_heartbeat() {
                                Some(hb) => hb,
                                None => continue,
                            };

                            let due_tasks = hb.check_due_tasks().await;
                            for task in due_tasks {
                                let task_db = heartbeat_db.clone();
                                let hb_ref = hb.clone();
                                let task_semaphore = semaphore.clone();
                                tokio::spawn(async move {
                                    // Due tasks have already been reserved by the scheduler. Queue
                                    // them behind the semaphore instead of dropping them when busy.
                                    let _permit = match task_semaphore.acquire_owned().await {
                                        Ok(permit) => permit,
                                        Err(error) => {
                                            tracing::error!(
                                                task_id = %task.id,
                                                error = %error,
                                                "[Heartbeat] Execution semaphore closed"
                                            );
                                            return;
                                        }
                                    };

                                    let minute_bucket =
                                        services::agent::heartbeat::HeartbeatManager::current_minute_bucket();
                                    // 多副本 CAS：未抢到则跳过（另一实例已执行或已完成）
                                    if !services::agent::heartbeat::HeartbeatManager::try_claim_execution(
                                        &task_db,
                                        &task.id,
                                        minute_bucket,
                                    )
                                    .await
                                    {
                                        return;
                                    }

                                    let _inflight =
                                        services::agent::heartbeat::HeartbeatInflightGuard::enter();

                                    tracing::info!(
                                        task_id = %task.id,
                                        "[Heartbeat] Executing due task: {}",
                                        task.name
                                    );

                                    let request = services::agent::UserRequest {
                                        raw_input: task.action.clone(),
                                        timestamp: chrono::Utc::now(),
                                        user_id: services::agent::SYSTEM_USER_ID,
                                        context: None,
                                    };

                                    let agent = services::agent::Agent::new(task_db.clone()).await;
                                    let task_name = task.name.clone();
                                    let timeout = std::time::Duration::from_secs(
                                        services::agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS,
                                    );

                                    // 捕获 TaskCreated 的 executor task_id，超时后协作取消
                                    let (progress_tx, mut progress_rx) =
                                        tokio::sync::mpsc::channel::<
                                            services::agent::types::AgentProgressEvent,
                                        >(64);
                                    let captured_exec_task = std::sync::Arc::new(
                                        tokio::sync::Mutex::new(None::<String>),
                                    );
                                    let captured_for_fwd = captured_exec_task.clone();
                                    tokio::spawn(async move {
                                        while let Some(event) = progress_rx.recv().await {
                                            if let services::agent::types::AgentProgressEvent::TaskCreated {
                                                task_id,
                                                ..
                                            } = &event
                                            {
                                                *captured_for_fwd.lock().await = Some(task_id.clone());
                                            }
                                        }
                                    });

                                    let outcome = tokio::time::timeout(
                                        timeout,
                                        agent.process_with_progress(request, progress_tx),
                                    )
                                    .await;

                                    let mut claim_status = "done";
                                    match outcome {
                                        Ok(Ok(response)) => {
                                            let succeeded = response.is_successful_outcome();
                                            let response_summary = response
                                                .message
                                                .chars()
                                                .take(200)
                                                .collect::<String>();
                                            let result_summary = if succeeded {
                                                response_summary
                                            } else {
                                                claim_status = "failed";
                                                format!("ERROR: {}", response_summary)
                                            };
                                            hb_ref.record_result(&task.id, &result_summary).await;
                                            let full_body = response
                                                .message
                                                .chars()
                                                .take(4000)
                                                .collect::<String>();
                                            if let Some(nm) = services::agent::notifications::get_notification_manager() {
                                                nm.notify_heartbeat_result(&task_name, &full_body, succeeded).await;
                                            }
                                            if succeeded {
                                                tracing::info!(
                                                    task_id = %task.id,
                                                    "[Heartbeat] Task completed: {}",
                                                    result_summary
                                                );
                                            } else {
                                                tracing::warn!(
                                                    task_id = %task.id,
                                                    "[Heartbeat] Task returned a non-success outcome: {}",
                                                    result_summary
                                                );
                                            }
                                        }
                                        Ok(Err(e)) => {
                                            claim_status = "failed";
                                            let err_msg = format!("ERROR: {}", e);
                                            hb_ref.record_result(&task.id, &err_msg).await;
                                            if let Some(nm) = services::agent::notifications::get_notification_manager() {
                                                nm.notify_heartbeat_result(&task_name, &err_msg, false).await;
                                            }
                                            tracing::warn!(
                                                task_id = %task.id,
                                                error = %e,
                                                "[Heartbeat] Task failed"
                                            );
                                        }
                                        Err(_elapsed) => {
                                            claim_status = "failed";
                                            // 硬取消：协作式 is_cancelled，打断 executor 步骤环
                                            if let Some(exec_tid) =
                                                captured_exec_task.lock().await.clone()
                                            {
                                                services::agent::executor::request_cancel(
                                                    &exec_tid,
                                                    &format!(
                                                        "heartbeat timed out after {}s",
                                                        services::agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS
                                                    ),
                                                )
                                                .await;
                                            }
                                            let err_msg = format!(
                                                "ERROR: heartbeat task timed out after {}s",
                                                services::agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS
                                            );
                                            hb_ref.record_result(&task.id, &err_msg).await;
                                            if let Some(nm) = services::agent::notifications::get_notification_manager() {
                                                nm.notify_heartbeat_result(&task_name, &err_msg, false).await;
                                            }
                                            tracing::warn!(
                                                task_id = %task.id,
                                                timeout_secs = services::agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS,
                                                "[Heartbeat] Task timed out; cancel requested"
                                            );
                                        }
                                    }
                                    services::agent::heartbeat::HeartbeatManager::complete_claim(
                                        &task_db,
                                        &task.id,
                                        minute_bucket,
                                        claim_status,
                                    )
                                    .await;
                                });
                            }
                        }
                    });
                    tracing::info!("✅ Heartbeat background worker started");
                }

                // Spawn skill evolution pruning worker (daily)
                tokio::spawn(async move {
                    // 初始延迟 1 小时，避免启动时负担
                    tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(86400));
                    loop {
                        interval.tick().await;
                        // 清理过期 Skill
                        if let Some(evolution) =
                            services::agent::skill_evolution::get_skill_evolution()
                        {
                            let pruned = evolution.prune_skills().await;
                            if !pruned.is_empty() {
                                tracing::info!(
                                    "[SkillEvolution] Pruned {} low-quality skills: {:?}",
                                    pruned.len(),
                                    pruned
                                );
                            }
                        }
                        // 清理过期记忆日志（保留 30 天）
                        if let Some(mem) = services::agent::memory::get_memory() {
                            mem.cleanup_old_logs(30).await;
                        }
                    }
                });
                tracing::info!("✅ Skill evolution pruning worker started");

                // Initialize Federation delivery worker (MFP Activity delivery queue).
                // Required for createNote/publish fan-out: rows enqueued in
                // fan_out_to_followers are drained here every ~15s.
                federation::delivery::spawn_delivery_worker(db.clone());
                tracing::info!("✅ Federation delivery worker started");

                // 密钥迁移：把存量明文配置与 v0 联邦私钥升级到数据密钥信封。
                //
                // 两者都幂等可重入，中断了下次启动接着做，不需要维护窗口。
                // 联邦私钥必须在这里同步做完 —— 它要随时可用于签名，不能惰性升级。
                services::data_key::log_startup_state();
                match services::data_key::migrate_plaintext_config_values(&db).await {
                    Ok(n) if n > 0 => {
                        tracing::info!("✅ Configuration encryption migration: {n} value(s)")
                    }
                    Ok(_) => {}
                    Err(e) => tracing::error!("Configuration encryption migration failed: {e}"),
                }
                let legacy_jwt_secret = {
                    let cfg = GLOBAL_CONFIG.read().await;
                    cfg.jwt_secret.clone()
                };
                match federation::keys::rewrap_legacy_private_keys(&db, &legacy_jwt_secret).await {
                    Ok(n) if n > 0 => {
                        tracing::info!("✅ Federation key rewrap: {n} key(s)")
                    }
                    Ok(_) => {}
                    Err(e) => tracing::error!("Federation key rewrap failed: {e}"),
                }

                tracing::info!("🌐 Starting in FULL MODE - all features available");
                *DB_CONNECTION.write().await = Some(db);
                CONFIG_MODE.store(false, Ordering::Relaxed);
            }
            Err(e) => {
                let error_kind = db::connection::classify_connect_error(&e);
                tracing::warn!(
                    db_target = %db_target,
                    error_kind = error_kind.as_str(),
                    error = %e,
                    "⚠️  Database connection failed after retries"
                );
                tracing::info!("🔧 Starting in CONFIGURATION MODE");
                tracing::info!("📝 Only setup/status/bootstrap auth endpoints are available");
                tracing::info!(
                    "💡 Configure database via POST /api/setup/database-config; the service will restart to load the full route table"
                );
                CONFIG_MODE.store(true, Ordering::Relaxed);
                enter_config_mode_guard();
            }
        }
    } else {
        tracing::warn!("⚠️  No database URL configured");
        tracing::info!("🔧 Starting in CONFIGURATION MODE");
        tracing::info!("📝 Only setup/status/bootstrap auth endpoints are available");
        tracing::info!(
            "💡 Configure database via POST /api/setup/database-config; the service will restart to load the full route table"
        );
        CONFIG_MODE.store(true, Ordering::Relaxed);
        enter_config_mode_guard();
    }

    // Start the unified server. If this process booted without a DB, setup writes
    // DATABASE_URL and exits so the supervisor can restart with the full route table.
    start_unified_server(config).await
}

/// 进入 CONFIG_MODE 时决定 setup 控制面是否需要引导令牌。
///
/// 数据库不可达会自动打开 CONFIG_MODE，而 CONFIG_MODE 下的 setup 路由能改写
/// `DATABASE_URL` / `JWT_SECRET` / `CORS_ORIGINS`。对于**此前已经配置过**的实例，
/// 这条链把一次数据库故障变成匿名可达的控制面；这里生成一次性令牌把它锁上，
/// 令牌只出现在启动日志和宿主文件里。首次安装不受影响。
fn enter_config_mode_guard() {
    let env_path = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(".env");
    api::setup_bootstrap::init_for_config_mode(&env_path);
}

/// Middleware to check if route is allowed in configuration mode
async fn config_mode_middleware(req: Request, next: Next) -> Response {
    let path = req.uri().path();

    // Whitelist of paths that are allowed in configuration mode
    let allowed_paths = [
        "/health",
        "/api/setup/config",
        "/api/setup/status",
        "/api/setup/init-env",
        "/api/setup/update-env",
        "/api/setup/database-config", // ✅ 允许配置数据库（有内部认证检查）
        "/api/setup/init-database",
        "/api/setup/create-admin",
        "/api/system/status",
        "/api/auth/login",           // Allow login endpoint
        "/api/auth/me",              // Allow user info endpoint (for login state check)
        "/api/auth/logout",          // Allow logout endpoint
        "/api/auth/change-password", // Allow change password endpoint
        "/api/auth/register",        // PR #4: 公开注册（自身有 allow_local_registration 检查）
        "/api/auth/oauth/providers", // PR #2: 公开列出 OAuth providers
    ];

    // If in config mode and path is not whitelisted, return 503
    if CONFIG_MODE.load(Ordering::Relaxed) && !allowed_paths.iter().any(|p| path.starts_with(p)) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Service in configuration mode",
                "message": "服务器正在配置模式，请先完成数据库配置和初始化",
                "configure_endpoint": "/api/setup/database-config",
                "hint": "After configuration, the service restarts to load the full route table"
            })),
        )
            .into_response();
    }

    next.run(req).await
}

/// 路由已挂 `admin_middleware`；`AdminClaims` 把同一个检查写进签名。
async fn update_config(
    extract::AdminClaims(_claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<api::config::ConfigResponse>,
) -> Response {
    let (status, json) = api::config::update_config(axum::extract::State(db), Json(payload)).await;
    (status, json).into_response()
}

/// 路由已挂 `admin_middleware`；`AdminClaims` 把同一个检查写进签名。
async fn change_site_domain(
    extract::AdminClaims(_claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<api::site_domain::ChangeSiteDomainRequest>,
) -> Response {
    let (status, json) =
        api::site_domain::change_site_domain(axum::extract::State(db), Json(payload)).await;
    (status, json).into_response()
}

/// 路由已挂 `admin_middleware`；`AdminClaims` 把同一个检查写进签名，
/// 路由被重挂时也带不走（与 ring 端点保持一致的写法）。
async fn export_settings(
    extract::AdminClaims(claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
) -> Response {
    let Ok(user_id) = claims.sub.parse::<i32>() else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Invalid authenticated user"})),
        )
            .into_response();
    };

    let (status, json) = api::config::export_settings(axum::extract::State(db), user_id).await;
    let mut response = (status, json).into_response();
    // 导出内容含明文密钥，禁止任何缓存层留存
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store, private"),
    );
    response.headers_mut().insert(
        axum::http::header::PRAGMA,
        axum::http::HeaderValue::from_static("no-cache"),
    );
    response
}

/// 路由已挂 `admin_middleware`；`AdminClaims` 把同一个检查写进签名。
/// 这个端点只做校验预演，不碰数据库。
async fn preview_settings_restore(
    extract::AdminClaims(_claims): extract::AdminClaims,
    Json(payload): Json<api::config::SettingsBackup>,
) -> Response {
    let (status, json) = api::config::preview_settings_restore(Json(payload)).await;
    (status, json).into_response()
}

/// 路由已挂 `admin_middleware`；`AdminClaims` 把同一个检查写进签名。
async fn restore_settings(
    extract::AdminClaims(claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<api::config::SettingsBackup>,
) -> Response {
    let Ok(user_id) = claims.sub.parse::<i32>() else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Invalid authenticated user"})),
        )
            .into_response();
    };

    let (status, json) =
        api::config::restore_settings(axum::extract::State(db), user_id, Json(payload)).await;
    (status, json).into_response()
}

// ==================== Federation Wrappers ====================

/// POST /api/admin/federation/domain-move
///
/// POST /api/admin/federation/domain-move
///
/// Emit ActivityPub Move for every local user (domain migration). Admin only.
/// `AdminClaims` 取代函数体里的 `federation_admin_required`。
async fn admin_federation_domain_move(
    extract::AdminClaims(_claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::move_actor::DomainMoveRequest>,
) -> Response {
    match federation::move_actor::domain_move_all_users(&db, &payload).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, body)) => (status, body).into_response(),
    }
}

/// GET /api/federation/identity — 获取当前登录用户的联邦地址
/// 路由已挂 `auth_middleware`，claims 由 `AuthedClaims` 直接取出。
async fn federation_identity(extract::AuthedClaims(claims): extract::AuthedClaims) -> Response {
    let identity = federation::actor::get_local_identity(&claims.username).await;
    (StatusCode::OK, Json(identity)).into_response()
}

/// POST /api/federation/keys/rotate — explicit federation key rotation
///
/// 路由已挂 auth_middleware。
///
/// 这里用 `Bytes` 而不是 `Json<Value>`：原实现是
/// `from_slice(..).unwrap_or(json!({}))`，空 body / 畸形 JSON 会落到「缺少
/// confirm」这条**带操作指引**的 400；换成 `Json` 提取器会先被 axum 拒成一条
/// 通用错误，用户看不到"需要 {\"confirm\": true}"这句提示。
async fn federation_keys_rotate(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    body_bytes: axum::body::Bytes,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    if !federation::actor::rotation_confirm_accepted(&body) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Key rotation requires {\"confirm\": true}",
                "hint": "This permanently replaces your federation signing key. Peers must re-fetch your actor document."
            })),
        )
            .into_response();
    }

    match federation::actor::rotate_user_federation_keys(&db, user_id, &claims.username).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => {
            tracing::error!(
                user_id = user_id,
                username = %claims.username,
                error = %e,
                "Federation key rotation failed"
            );
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response()
        }
    }
}

/// POST /api/federation/follow — 关注远程用户
/// 路由已挂 auth_middleware；claims / body / db 走提取器。
/// body 上限仍由路由的 DefaultBodyLimit 决定（与改造前一致）。
async fn federation_follow(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::follow::FollowRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::follow::follow_remote(user_id, &claims.username, &db, &payload.target).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// POST /api/federation/unfollow — 取消关注远程用户
/// 路由已挂 auth_middleware；claims / body / db 走提取器。
/// body 上限仍由路由的 DefaultBodyLimit 决定（与改造前一致）。
async fn federation_unfollow(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::follow::FollowRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::follow::unfollow_remote(user_id, &claims.username, &db, &payload.target).await
    {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// GET /api/federation/following — 获取我关注的远程用户列表
/// 路由已挂 auth_middleware；claims 由 AuthedClaims 提取。
async fn federation_following_list(
    extract::AuthedClaims(claims): extract::AuthedClaims,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match get_follow_list(db, user_id, "outgoing").await {
                Ok(list) => (StatusCode::OK, Json(list)).into_response(),
                Err(e) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response()
                }
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// GET /api/federation/followers — 获取关注我的远程用户列表
/// 路由已挂 auth_middleware；claims 由 AuthedClaims 提取。
async fn federation_followers_list(
    extract::AuthedClaims(claims): extract::AuthedClaims,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match get_follow_list(db, user_id, "incoming").await {
                Ok(list) => (StatusCode::OK, Json(list)).into_response(),
                Err(e) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response()
                }
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// GET /api/federation/timeline — 获取联邦时间线
/// 路由已挂 auth_middleware；claims 由 AuthedClaims 提取。
async fn federation_timeline(extract::AuthedClaims(claims): extract::AuthedClaims) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match get_federation_timeline(db, user_id).await {
                Ok(timeline) => (StatusCode::OK, Json(timeline)).into_response(),
                Err(e) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response()
                }
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

// ==================== Phase 2: Content Publishing Wrappers ====================

/// POST /api/federation/publish — 发布内容到联邦网络
/// 路由已挂 auth_middleware；claims / body / db 走提取器。
/// body 上限仍由路由的 DefaultBodyLimit 决定（与改造前一致）。
async fn federation_publish(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::content::PublishRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::content::publish_content(user_id, &claims.username, &db, &payload).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；claims / body / db 全部走提取器。
async fn federation_like(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::interactions::ObjectIdRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::interactions::like_object(user_id, &claims.username, &db, &payload.object_id)
        .await
    {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；claims / body / db 全部走提取器。
async fn federation_unlike(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::interactions::ObjectIdRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::interactions::unlike_object(
        user_id,
        &claims.username,
        &db,
        &payload.object_id,
    )
    .await
    {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；claims / body / db 全部走提取器。
async fn federation_bookmark(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::interactions::ObjectIdRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::interactions::bookmark_object(user_id, &db, &payload.object_id).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；claims / body / db 全部走提取器。
async fn federation_unbookmark(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::interactions::ObjectIdRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::interactions::unbookmark_object(user_id, &db, &payload.object_id).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；claims 由 AuthedClaims 提取。
async fn federation_bookmarks_list(
    extract::AuthedClaims(claims): extract::AuthedClaims,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::interactions::list_bookmarks(user_id, db).await {
                Ok(resp) => {
                    (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
                }
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// 路由已挂 auth_middleware；claims / body / db 全部走提取器。
async fn federation_announce(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::interactions::AnnounceRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    let content = payload.content.as_deref().unwrap_or("");
    match federation::interactions::announce_object(
        user_id,
        &claims.username,
        &db,
        &payload.object_id,
        content,
    )
    .await
    {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；claims / body / db 全部走提取器。
async fn federation_unannounce(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::interactions::ObjectIdRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::interactions::unannounce_object(
        user_id,
        &claims.username,
        &db,
        &payload.object_id,
    )
    .await
    {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// GET /api/federation/objects?id= — resolve a public object for quote click-through.
/// Does not require following the author (local DB + optional remote public fetch).
async fn federation_get_object(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Query(q): axum::extract::Query<federation::interactions::GetObjectQuery>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::interactions::get_object(user_id, &db, &q.id).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// POST /api/federation/notes — 创建 freeform Note（文本 + 附件）
/// 路由已挂 auth_middleware；body 上限仍由路由的 DefaultBodyLimit 决定。
async fn federation_create_note(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::content::CreateNoteRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::content::create_note(user_id, &claims.username, &db, &payload).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；`Multipart` 是 axum 自带的提取器，
/// 提取失败（非 multipart/form-data）由它自己返回 400。
async fn federation_media_upload(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    mut multipart: axum::extract::Multipart,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);

    let mut file_bytes: Option<Vec<u8>> = None;
    let mut filename = "upload.bin".to_string();
    let mut mime = "application/octet-stream".to_string();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name != "file" {
            continue;
        }
        if let Some(fname) = field.file_name() {
            filename = fname.to_string();
        }
        if let Some(ct) = field.content_type() {
            mime = ct.to_string();
        }
        match field.bytes().await {
            Ok(b) => file_bytes = Some(b.to_vec()),
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "Failed to read file field"})),
                )
                    .into_response()
            }
        }
        break;
    }

    let Some(bytes) = file_bytes else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Missing multipart field 'file'"})),
        )
            .into_response();
    };

    match federation::content::store_federation_media(user_id, &filename, &mime, &bytes).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；body 上限仍由路由的 DefaultBodyLimit 决定。
async fn federation_unpublish(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let content_type = payload["content_type"].as_str().unwrap_or("").trim();
    let content_id = payload["content_id"].as_str().unwrap_or("").trim();
    let activity_id = payload["activity_id"].as_str().unwrap_or("").trim();
    let has_activity = !activity_id.is_empty();
    let has_content = !content_id.is_empty(); // content_type optional when activity_id or inferable
    if !has_activity && !has_content {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Provide activity_id, or content_type + content_id"
            })),
        )
            .into_response();
    }
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::content::unpublish_content(
        user_id,
        &claims.username,
        &db,
        if content_type.is_empty() {
            None
        } else {
            Some(content_type)
        },
        if content_id.is_empty() {
            None
        } else {
            Some(content_id)
        },
        if activity_id.is_empty() {
            None
        } else {
            Some(activity_id)
        },
    )
    .await
    {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// GET /api/federation/published — 获取已发布内容列表
/// 路由已挂 auth_middleware；claims 由 AuthedClaims 提取。
async fn federation_published_list(
    extract::AuthedClaims(claims): extract::AuthedClaims,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::content::list_published(user_id, db).await {
                Ok(items) => (
                    StatusCode::OK,
                    Json(json!({"items": items, "total": items.len()})),
                )
                    .into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

// ==================== Phase 3: Channel Wrapper Functions ====================

/// 路由已挂 auth_middleware；body 上限仍由路由的 DefaultBodyLimit 决定。
async fn federation_create_channel(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<federation::channel::CreateChannelRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::channel::create_channel(user_id, &claims.username, &db, &payload).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// Channel 列表
/// 路由已挂 auth_middleware；claims 由 AuthedClaims 提取。
async fn federation_list_channels(
    extract::AuthedClaims(claims): extract::AuthedClaims,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::channel::list_channels(user_id, &claims.username, db).await {
                Ok(channels) => (
                    StatusCode::OK,
                    Json(json!({"channels": channels, "total": channels.len()})),
                )
                    .into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// Channel 详情
/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_get_channel(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::channel::get_channel(user_id, &channel_id, &db).await {
        Ok(detail) => (StatusCode::OK, Json(serde_json::to_value(detail).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 关闭 Channel
/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_close_channel(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::channel::close_channel(user_id, &claims.username, &channel_id, &db).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 删除已关闭的 Channel（本地硬删除）
/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_delete_channel(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::channel::delete_channel(user_id, &channel_id, &db).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 接受 Channel
/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_accept_channel(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::channel::accept_channel(user_id, &claims.username, &channel_id, &db).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 发起 Channel E2E 密钥交换
/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_e2e_key_exchange(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::channel::initiate_e2e_key_exchange(
        user_id,
        &claims.username,
        &channel_id,
        &db,
    )
    .await
    {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明 `{channel_id}`；body 上限来自 federation 路由层。
async fn federation_send_message(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
    payload: Result<
        Json<federation::channel::SendMessageRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    let Json(parsed) = match payload {
        Ok(v) => v,
        Err(e) => {
            return json_rejection_response(
                e,
                Some("Inline images max ~32 MiB payload; larger files use chunked transfer"),
            )
        }
    };

    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::channel::send_message(user_id, &claims.username, &channel_id, &db, &parsed)
        .await
    {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明 `{channel_id}`；分页参数走 `Query<ListQuery>`。
async fn federation_get_messages(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
    axum::extract::Query(q): axum::extract::Query<ListQuery>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::channel::get_messages(user_id, &channel_id, &db, q.before(), q.limit()).await
    {
        Ok(messages) => (
            StatusCode::OK,
            Json(json!({"messages": messages, "total": messages.len()})),
        )
            .into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

// ==================== Phase 4: Room 多方通信 Wrapper ====================

/// 路由通过 `DefaultBodyLimit::max(FEDERATION_SMALL_BODY_LIMIT)` 保留原有的
/// 64 KiB 上限 —— 换成 Json 提取器后若不显式加这层，端点会退回到
/// 路由级的 40 MiB，等于放大可缓冲的请求体。
async fn federation_create_room(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(parsed): Json<federation::room::CreateRoomRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::create_room(user_id, &claims.username, &db, &parsed).await {
        Ok(detail) => (StatusCode::OK, Json(json!(detail))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；claims 由 AuthedClaims 提取。
async fn federation_list_rooms(extract::AuthedClaims(claims): extract::AuthedClaims) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::list_rooms(user_id, &claims.username, db).await {
                Ok(rooms) => (
                    StatusCode::OK,
                    Json(json!({"rooms": rooms, "total": rooms.len()})),
                )
                    .into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// 路由已声明该路径参数；claims / path / db 全部走提取器，
/// 不再手工 strip_prefix 重解析 URI。
async fn federation_get_room(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::get_room(user_id, &claims.username, &room_id, &db).await {
        Ok(detail) => (StatusCode::OK, Json(json!(detail))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数并挂了 auth_middleware；
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_update_room(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
    Json(parsed): Json<federation::room::UpdateRoomRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::update_room(user_id, &claims.username, &room_id, &db, &parsed).await {
        Ok(detail) => (StatusCode::OK, Json(json!(detail))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数；claims / path / db 全部走提取器，
/// 不再手工 strip_prefix 重解析 URI。
async fn federation_delete_room(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::delete_room(user_id, &claims.username, &room_id, &db).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_get_room_members(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::get_members(user_id, &claims.username, &room_id, &db).await {
        Ok(members) => (
            StatusCode::OK,
            Json(json!({"members": members, "total": members.len()})),
        )
            .into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数并挂了 auth_middleware；
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_invite_room_member(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
    Json(parsed): Json<federation::room::InviteMemberRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::invite_member(user_id, &claims.username, &room_id, &db, &parsed).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由声明的是 `{room_id}/members/{actor}`。
///
/// `Path<(String, String)>` 会对每段做百分号解码，与原先手工
/// `urlencoding::decode(actor)` 等价 —— actor 是完整 URL，必然带编码。
async fn federation_remove_room_member(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path((room_id, target_actor)): axum::extract::Path<(String, String)>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::remove_member(user_id, &claims.username, &room_id, &target_actor, &db)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_leave_room(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::leave_room(user_id, &claims.username, &room_id, &db).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// POST /api/federation/rooms/{room_id}/accept — accept pending room invite
/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_accept_room_invite(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::accept_room_invite(user_id, &claims.username, &room_id, &db).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// POST /api/federation/rooms/{room_id}/reject — reject pending room invite
/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_reject_room_invite(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::reject_room_invite(user_id, &claims.username, &room_id, &db).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明 `{room_id}`。
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_transfer_room_ownership(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
    Json(parsed): Json<serde_json::Value>,
) -> Response {
    // `new_owner` 是规范键名，`actor` 是老客户端的写法 —— 兜底保留。
    let new_owner = parsed
        .get("new_owner")
        .or_else(|| parsed.get("actor"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::transfer_room_ownership(
        user_id,
        &claims.username,
        &room_id,
        &new_owner,
        &db,
    )
    .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 发起 Room E2E 密钥发布
/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_room_e2e_key_exchange(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::initiate_e2e_key_exchange(user_id, &claims.username, &room_id, &db)
        .await
    {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// PUT /api/federation/rooms/{room_id}/members/{actor}/role — owner sets admin|member
async fn federation_set_room_member_role(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path((room_id, actor)): axum::extract::Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    let role = body
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // Path may be percent-encoded actor URL
    let actor = urlencoding::decode(&actor)
        .map(|s| s.into_owned())
        .unwrap_or(actor);
    match federation::room::set_member_role(
        user_id,
        &claims.username,
        &room_id,
        &actor,
        &role,
        &db,
    )
    .await
    {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// POST /api/federation/rooms/{room_id}/stickers — share sticker into group pack
async fn federation_add_room_sticker(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
    Json(req): Json<federation::room::AddRoomStickerRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::add_room_sticker(user_id, &claims.username, &room_id, req, &db).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// DELETE /api/federation/rooms/{room_id}/stickers/{sticker_id}
async fn federation_remove_room_sticker(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path((room_id, sticker_id)): axum::extract::Path<(String, String)>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::remove_room_sticker(
        user_id,
        &claims.username,
        &room_id,
        &sticker_id,
        &db,
    )
    .await
    {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明 `{room_id}`；body 上限来自 federation 路由层（见 `federation::limits`）。
///
/// 用 `Result<Json<T>, JsonRejection>` 而不是裸 `Json<T>`：超限时要保住原有的
/// 413 + 分块传输指引，而不是 axum 的纯文本拒绝。
async fn federation_send_room_message(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
    payload: Result<
        Json<federation::room::SendRoomMessageRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    let Json(parsed) = match payload {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(
                room_id = %room_id,
                error = %e,
                "[Room] send message body rejected (likely over DefaultBodyLimit)"
            );
            return json_rejection_response(
                e,
                Some("Inline images max ~32 MiB payload; larger files use chunked transfer"),
            );
        }
    };

    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::send_room_message(user_id, &claims.username, &room_id, &db, &parsed)
        .await
    {
        Ok(resp) => (StatusCode::OK, Json(json!(resp))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明 `{room_id}`；分页参数走 `Query<ListQuery>`。
async fn federation_get_room_messages(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
    axum::extract::Query(q): axum::extract::Query<ListQuery>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::get_room_messages(
        user_id,
        &claims.username,
        &room_id,
        &db,
        q.before(),
        q.limit(),
    )
    .await
    {
        Ok(messages) => (
            StatusCode::OK,
            Json(json!({"messages": messages, "total": messages.len()})),
        )
            .into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由声明的是 `{room_id}/messages/{message_id}/pin`。
/// `Path<(String, String)>` 对每段做百分号解码，与原先手工
/// `urlencoding::decode(message_id)` 等价。
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 16 KiB）。
async fn federation_pin_room_message(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path((room_id, message_id)): axum::extract::Path<(String, String)>,
    Json(parsed): Json<federation::room::PinRoomMessageRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::pin_room_message(
        user_id,
        &claims.username,
        &room_id,
        &message_id,
        &db,
        &parsed,
    )
    .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

// ==================== Phase 5: Ring 去中心化环网 ====================

/// `AdminClaims` 取代函数体里的 `federation_admin_required` —— 这些 ring 端点的
/// 路由只有 router 级 `auth_middleware`（普通登录），管理员校验必须留在这里。
/// 写进签名后，路由被挪动或重挂中间件也带不走它。
async fn federation_create_ring(
    extract::AdminClaims(claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    Json(create_req): Json<federation::ring::CreateRingRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::ring::create_ring(user_id, &db, &create_req).await {
        Ok(ring) => (StatusCode::CREATED, Json(json!(ring))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

async fn federation_list_rings(extract::Db(db): extract::Db) -> Response {
    match federation::ring::list_rings(&db).await {
        Ok(rings) => (
            StatusCode::OK,
            Json(json!({"rings": rings, "total": rings.len()})),
        )
            .into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数；不再手工解析 URI。
async fn federation_get_ring(
    extract::Db(db): extract::Db,
    axum::extract::Path(ring_id): axum::extract::Path<String>,
) -> Response {
    match federation::ring::get_ring(&ring_id, &db).await {
        Ok(ring) => (StatusCode::OK, Json(json!(ring))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 见 [`federation_create_ring`]：管理员校验由 `AdminClaims` 承担。
async fn federation_leave_ring(
    extract::AdminClaims(claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(ring_id): axum::extract::Path<String>,
) -> Response {
    match federation::ring::leave_ring(&ring_id, &claims.username, &db).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数；不再手工解析 URI。
async fn federation_get_ring_peers(
    extract::Db(db): extract::Db,
    axum::extract::Path(ring_id): axum::extract::Path<String>,
) -> Response {
    match federation::ring::get_peers(&ring_id, &db).await {
        Ok(peers) => (
            StatusCode::OK,
            Json(json!({"peers": peers, "total": peers.len()})),
        )
            .into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 见 [`federation_create_ring`]：管理员校验由 `AdminClaims` 承担。
async fn federation_add_ring_peer(
    extract::AdminClaims(claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(ring_id): axum::extract::Path<String>,
    Json(add_req): Json<federation::ring::AddPeerRequest>,
) -> Response {
    match federation::ring::add_peer(&ring_id, &claims.username, &db, &add_req).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 见 [`federation_create_ring`]：管理员校验由 `AdminClaims` 承担。
///
/// `Path<(String, String)>` 会对每段做百分号解码，与原先手工
/// `urlencoding::decode(peer)` 等价 —— peer 是完整 Actor URL，必然带编码。
async fn federation_remove_ring_peer(
    extract::AdminClaims(claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path((ring_id, peer_url)): axum::extract::Path<(String, String)>,
) -> Response {
    match federation::ring::remove_peer(&ring_id, &peer_url, &claims.username, &db).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 见 [`federation_create_ring`]：管理员校验由 `AdminClaims` 承担。
async fn federation_trigger_ring_sync(
    extract::AdminClaims(claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(ring_id): axum::extract::Path<String>,
) -> Response {
    match federation::ring::trigger_sync(&ring_id, &claims.username, &db).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

// ==================== Phase 5 补全: Trust 策略管理 ====================

/// GET /api/federation/delivery/stats — user delivery queue counters
/// 路由已挂 auth_middleware；claims 由 AuthedClaims 提取。
async fn federation_delivery_stats(
    extract::AuthedClaims(claims): extract::AuthedClaims,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::delivery::delivery_stats_for_user(db, user_id).await {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err(e) => {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response()
            }
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// POST /api/federation/delivery/{id}/retry — requeue a dead/stuck item
/// 路由已声明该数值路径参数；`Path<i32>` 取代手工 strip + parse。
async fn federation_retry_delivery(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(queue_id): axum::extract::Path<i32>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::delivery::retry_delivery_item(&db, user_id, queue_id).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// POST /api/federation/delivery/{id}/cancel — cancel pending/delivering item
/// 路由已声明该数值路径参数；`Path<i32>` 取代手工 strip + parse。
async fn federation_cancel_delivery(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(queue_id): axum::extract::Path<i32>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::delivery::cancel_delivery_item(&db, user_id, queue_id).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// 路由已挂 auth_middleware；`Query<LimitQuery>` 取代手工切 query 串。
async fn federation_retry_all_dead_delivery(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Query(q): axum::extract::Query<LimitQuery>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::delivery::retry_all_dead_for_user(&db, user_id, q.or(50)).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// 路由已挂 auth_middleware；`Query<LimitQuery>` 取代手工切 query 串。
async fn federation_cancel_all_pending_delivery(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Query(q): axum::extract::Query<LimitQuery>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::delivery::cancel_all_pending_for_user(&db, user_id, q.or(100)).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// DELETE /api/federation/delivery/{id} — purge a dead queue row (user-owned dismiss)
/// 路由已声明该数值路径参数；`Path<i32>` 取代手工 strip + parse。
async fn federation_dismiss_delivery(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(queue_id): axum::extract::Path<i32>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    {
        match federation::delivery::dismiss_delivery_item(&db, user_id, queue_id).await {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err((status, v)) => (status, Json(v)).into_response(),
        }
    }
}

/// 路由已挂 auth_middleware；`Query<PurgeDeadQuery>` 保留原有的宽松真值解析。
async fn federation_purge_dead_delivery(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Query(q): axum::extract::Query<PurgeDeadQuery>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::delivery::purge_dead_for_user(
        &db,
        user_id,
        q.limit_or(100),
        q.cancelled_only(),
    )
    .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// POST /api/federation/rooms/{room_id}/join — self-join open/public rooms
///
/// 路由已声明 `{room_id}`。
///
/// body 是**可选**的（`{"home_server": "…"}`，空 body 合法），所以用
/// `Option<Json<T>>` 而不是 `Json<T>` —— 后者会把「不带 body 加入房间」
/// 这个正常用法拒成 400。
///
/// 与原实现有一处**有意的差异**：畸形 JSON 原先被 `unwrap_or_default()` 静默
/// 吞掉，现在会返回 400。用户写错 `home_server` 时显式报错优于静默忽略。
/// 行为已由 `federation::limits` 里的 `optional_json_distinguishes_absent_from_malformed`
/// 实测锁定。
async fn federation_join_room(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
    body: Option<Json<federation::room::JoinRoomRequest>>,
) -> Response {
    let join_req = body.map(|Json(v)| v).unwrap_or_default();
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::join_room(user_id, &claims.username, &room_id, &db, Some(&join_req))
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// GET /api/federation/public/rooms/{room_id} — unauthenticated public room card
/// 路由已声明该路径参数；不再手工解析 URI。
async fn federation_get_public_room(
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
) -> Response {
    match federation::room::get_public_room(&room_id, &db).await {
        Ok(info) => (StatusCode::OK, Json(json!(info))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已挂 auth_middleware；`Query<LimitQuery>` 取代手工 form_urlencoded 解析。
async fn federation_list_delivery(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Query(q): axum::extract::Query<LimitQuery>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::delivery::list_delivery_for_user(&db, user_id, q.or(30)).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn federation_get_trust_policy(extract::Db(db): extract::Db) -> Response {
    match federation::trust::get_policy(&db).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// 见 [`federation_create_ring`]：管理员校验由 `AdminClaims` 承担。
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_update_trust_policy(
    extract::AdminClaims(_claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let min_trust = payload
        .get("min_trust_level")
        .and_then(|v| v.as_i64())
        .map(|n| n as i16);
    let allowed_domains = payload.get("allowed_domains").and_then(|v| {
        v.as_array().map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
    });
    let auto_discover = payload.get("auto_discover").and_then(|v| v.as_bool());
    // Prefer nested rate_limit { max_requests_per_window, window_seconds, trusted_multiplier }
    // with flat keys as fallback for older clients.
    let rate_obj = payload.get("rate_limit");
    let rate_max = rate_obj
        .and_then(|r| r.get("max_requests_per_window"))
        .or_else(|| payload.get("rate_max_requests"))
        .and_then(|v| v.as_i64());
    let rate_window = rate_obj
        .and_then(|r| r.get("window_seconds"))
        .or_else(|| payload.get("rate_window_seconds"))
        .and_then(|v| v.as_i64());
    let rate_mul = rate_obj
        .and_then(|r| r.get("trusted_multiplier"))
        .or_else(|| payload.get("rate_trusted_multiplier"))
        .and_then(|v| v.as_i64());
    match federation::trust::update_policy(
        &db,
        min_trust,
        allowed_domains,
        auto_discover,
        rate_max,
        rate_window,
        rate_mul,
    )
    .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

async fn federation_list_instances(extract::Db(db): extract::Db) -> Response {
    match federation::trust::list_instances(&db).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// 路由已挂 admin_middleware；`AuthedClaims` 保留原 wrapper 的 401 行为。
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_update_instance_trust(
    extract::AuthedClaims(_claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let domain = match payload.get("domain").and_then(|v| v.as_str()) {
        Some(d) => d.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "domain required"})),
            )
                .into_response()
        }
    };
    let level = payload
        .get("trust_level")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i16;
    match federation::trust::update_instance_trust(&db, &domain, level).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

async fn federation_list_content_filters(extract::Db(db): extract::Db) -> Response {
    match federation::trust::list_content_filters(&db).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// 路由已挂 admin_middleware；`AuthedClaims` 保留原 wrapper 的 401 行为。
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_create_content_filter(
    extract::AuthedClaims(_claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let filter_type = payload
        .get("filter_type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let value = payload
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let enabled = payload
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    match federation::trust::create_content_filter(&db, &name, &filter_type, &value, enabled).await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// 路由已声明该数值路径参数并挂了 admin_middleware；
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_update_content_filter(
    extract::AuthedClaims(_claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(id): axum::extract::Path<i32>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let name = payload.get("name").and_then(|v| v.as_str());
    let filter_type = payload.get("filter_type").and_then(|v| v.as_str());
    let value = payload.get("value").and_then(|v| v.as_str());
    let enabled = payload.get("enabled").and_then(|v| v.as_bool());
    match federation::trust::update_content_filter(&db, id, name, filter_type, value, enabled).await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// 路由已声明该数值路径参数并挂了 admin_middleware。
async fn federation_delete_content_filter(
    extract::AdminClaims(_claims): extract::AdminClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(id): axum::extract::Path<i32>,
) -> Response {
    match federation::trust::delete_content_filter(&db, id).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

/// 路由已挂 admin_middleware；`AuthedClaims` 保留原 wrapper 的 401 行为。
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_toggle_instance_block(
    extract::AuthedClaims(_claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let domain = match payload.get("domain").and_then(|v| v.as_str()) {
        Some(d) => d.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "domain required"})),
            )
                .into_response()
        }
    };
    let block = payload
        .get("block")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    match federation::trust::toggle_instance_block(&db, &domain, block).await {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, v)) => (status, Json(v)).into_response(),
    }
}

// ==================== Phase 5 补全: 文件传输 ====================

/// 路由已声明该路径参数并挂了 auth_middleware；
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_initiate_transfer(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
    Json(transfer_req): Json<federation::file_transfer::InitTransferRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::file_transfer::initiate_transfer(
        user_id,
        &claims.username,
        &channel_id,
        &db,
        &transfer_req,
    )
    .await
    {
        Ok(t) => (StatusCode::CREATED, Json(json!(t))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数；不再手工解析 URI。
async fn federation_list_transfers(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
) -> Response {
    match federation::file_transfer::list_transfers(
        &channel_id,
        claims.sub.parse().unwrap_or(0),
        &db,
    )
    .await
    {
        Ok(transfers) => (
            StatusCode::OK,
            Json(json!({"transfers": transfers, "total": transfers.len()})),
        )
            .into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数并挂了 auth_middleware；
/// body 上限由路由的 `FEDERATION_SMALL_BODY_LIMIT` 层提供（原为内联 64 KiB）。
async fn federation_initiate_room_transfer(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
    Json(transfer_req): Json<federation::file_transfer::InitTransferRequest>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::file_transfer::initiate_room_transfer(
        user_id,
        &claims.username,
        &room_id,
        &db,
        &transfer_req,
    )
    .await
    {
        Ok(t) => (StatusCode::CREATED, Json(json!(t))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数；不再手工解析 URI。
async fn federation_list_room_transfers(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
) -> Response {
    match federation::file_transfer::list_room_transfers(
        &room_id,
        claims.sub.parse().unwrap_or(0),
        &claims.username,
        &db,
    )
    .await
    {
        Ok(transfers) => (
            StatusCode::OK,
            Json(json!({"transfers": transfers, "total": transfers.len()})),
        )
            .into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明 `{room_id}`；before/limit/filter/q 全部走 `Query<ListQuery>`。
async fn federation_list_room_files(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(room_id): axum::extract::Path<String>,
    axum::extract::Query(q): axum::extract::Query<ListQuery>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::room::list_room_files(
        user_id,
        &claims.username,
        &room_id,
        &db,
        q.before(),
        q.limit(),
        q.filter(),
        q.q(),
    )
    .await
    {
        Ok(result) => (StatusCode::OK, Json(json!(result))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数；不再手工解析 URI。
async fn federation_get_transfer(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(transfer_id): axum::extract::Path<String>,
) -> Response {
    match federation::file_transfer::get_transfer(
        &transfer_id,
        claims.sub.parse().unwrap_or(0),
        &claims.username,
        &db,
    )
    .await
    {
        Ok(t) => (StatusCode::OK, Json(json!(t))).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明 `{transfer_id}`。
///
/// 只把 claims/path/db 的样板换成提取器；下面的流式响应与 RFC 5987 文件名
/// 处理原样保留 —— 这条路径返回的是文件流而不是 JSON。
async fn federation_download_transfer(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(transfer_id): axum::extract::Path<String>,
) -> Response {
    use axum::body::Body;
    use axum::http::header::{HeaderValue, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE};
    use tokio::io::AsyncReadExt;
    use tokio_stream::wrappers::ReceiverStream;

    let file = match federation::file_transfer::open_transfer_file(
        &transfer_id,
        claims.sub.parse().unwrap_or(0),
        &claims.username,
        &db,
    )
    .await
    {
        Ok(f) => f,
        Err((status, json)) => return (status, json).into_response(),
    };

    // RFC 5987 filename* for non-ASCII; ASCII fallback for legacy clients.
    let ascii_name: String = file
        .filename
        .chars()
        .map(|c| {
            if c.is_ascii() && c != '"' && c != '\\' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let ascii_name = if ascii_name.trim_matches('_').is_empty() {
        "download".to_string()
    } else {
        ascii_name
    };
    let encoded = urlencoding::encode(&file.filename);
    let disposition = format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        ascii_name, encoded
    );

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Vec<u8>, std::io::Error>>(4);
    let disk_path = file.path.clone();
    tokio::spawn(async move {
        let mut f = match tokio::fs::File::open(&disk_path).await {
            Ok(f) => f,
            Err(e) => {
                let _ = tx.send(Err(e)).await;
                return;
            }
        };
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match f.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(Ok(buf[..n].to_vec())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(e)).await;
                    break;
                }
            }
        }
    });

    let body = Body::from_stream(ReceiverStream::new(rx));
    let mut res = Response::new(body);
    *res.status_mut() = StatusCode::OK;
    let headers = res.headers_mut();
    if let Ok(v) = HeaderValue::from_str(&file.mime_type) {
        headers.insert(CONTENT_TYPE, v);
    } else {
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        );
    }
    if let Ok(v) = HeaderValue::from_str(&disposition) {
        headers.insert(CONTENT_DISPOSITION, v);
    }
    if let Ok(v) = HeaderValue::from_str(&file.file_size.to_string()) {
        headers.insert(CONTENT_LENGTH, v);
    }
    res
}

/// 路由已声明 `{transfer_id}`。
///
/// 块内容是 base64（4/3 膨胀），上限由路由的 `TRANSFER_CHUNK_BODY_LIMIT` 层
/// 提供 —— 见 `federation::limits`，那里有编译期断言保证它容得下一整块。
async fn federation_upload_chunk(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(transfer_id): axum::extract::Path<String>,
    chunk_req: Result<
        Json<federation::file_transfer::UploadChunkRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    let Json(chunk_req) = match chunk_req {
        Ok(v) => v,
        Err(e) => {
            return json_rejection_response(e, Some("Chunk payload exceeds the per-chunk limit"))
        }
    };

    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::file_transfer::upload_chunk(
        user_id,
        &claims.username,
        &transfer_id,
        &db,
        &chunk_req,
    )
    .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

/// 路由已声明该路径参数；claims / path / db 走提取器，不再手工解析 URI。
async fn federation_cancel_transfer(
    extract::AuthedClaims(claims): extract::AuthedClaims,
    extract::Db(db): extract::Db,
    axum::extract::Path(transfer_id): axum::extract::Path<String>,
) -> Response {
    let user_id: i32 = claims.sub.parse().unwrap_or(0);
    match federation::file_transfer::cancel_transfer(user_id, &claims.username, &transfer_id, &db)
        .await
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err((status, json)) => (status, json).into_response(),
    }
}

async fn get_follow_list(
    db: &sea_orm::DatabaseConnection,
    user_id: i32,
    direction: &str,
) -> Result<serde_json::Value, String> {
    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT ra.actor_url, ra.username, ra.domain, ra.display_name,
                      ra.avatar_url, f.status, f.created_at
               FROM federation_follows f
               JOIN federation_remote_actors ra ON ra.id = f.remote_actor_id
               WHERE f.user_id = $1 AND f.direction = $2
               ORDER BY f.created_at DESC"#,
            [user_id.into(), direction.into()],
        ))
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    let list: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "actor_url": r.try_get::<String>("", "actor_url").unwrap_or_default(),
                // Nullable columns must use Option — try_get::<String> fails on NULL
                "username": r.try_get::<Option<String>>("", "username").ok().flatten(),
                "domain": r.try_get::<String>("", "domain").unwrap_or_default(),
                "display_name": r.try_get::<Option<String>>("", "display_name").ok().flatten(),
                "avatar_url": r.try_get::<Option<String>>("", "avatar_url").ok().flatten(),
                "status": r.try_get::<String>("", "status").unwrap_or_default(),
            })
        })
        .collect();

    Ok(json!({"items": list, "total": list.len()}))
}

/// 查询联邦时间线
async fn get_federation_timeline(
    db: &sea_orm::DatabaseConnection,
    user_id: i32,
) -> Result<serde_json::Value, String> {
    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
    let base_url = federation::types::get_base_url().await;
    let base = base_url.trim_end_matches('/');
    let local_domain = federation::types::extract_domain(&base_url).unwrap_or_default();
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT t.activity_id, t.activity_type, t.object_type,
                      t.content_preview, t.content_json, t.is_read, t.received_at,
                      ra.actor_url AS remote_actor_url,
                      ra.username AS remote_username,
                      ra.domain AS remote_domain,
                      ra.display_name AS remote_display_name,
                      ra.avatar_url AS remote_avatar_url,
                      author.username AS author_username,
                      author.display_name AS author_display_name,
                      peer.username AS peer_username,
                      peer.display_name AS peer_display_name,
                      CASE
                          WHEN ra.id IS NOT NULL THEN
                              CASE
                                  WHEN peer.username IS NOT NULL
                                       AND (
                                           (peer.avatar_url IS NOT NULL AND peer.avatar_url <> ''
                                            AND peer.avatar_url NOT LIKE 'https://ui-avatars.com/%'
                                            AND peer.avatar_url NOT LIKE 'http://ui-avatars.com/%')
                                           OR EXISTS (
                                               SELECT 1 FROM user_identities ui
                                               WHERE ui.user_id = peer.id
                                                 AND ui.avatar_url IS NOT NULL AND ui.avatar_url <> ''
                                           )
                                       )
                                  THEN $2 || '/users/' || peer.username || '/avatar'
                                  ELSE NULL
                              END
                          ELSE
                              CASE
                                  WHEN author.username IS NOT NULL
                                       AND (
                                           (author.avatar_url IS NOT NULL AND author.avatar_url <> ''
                                            AND author.avatar_url NOT LIKE 'https://ui-avatars.com/%'
                                            AND author.avatar_url NOT LIKE 'http://ui-avatars.com/%')
                                           OR EXISTS (
                                               SELECT 1 FROM user_identities ui
                                               WHERE ui.user_id = author.id
                                                 AND ui.avatar_url IS NOT NULL AND ui.avatar_url <> ''
                                           )
                                       )
                                  THEN $2 || '/users/' || author.username || '/avatar'
                                  ELSE NULL
                              END
                      END AS local_avatar_proxy
               FROM federation_timeline t
               LEFT JOIN federation_remote_actors ra ON ra.id = t.remote_actor_id
               -- Self-authored rows only — do NOT join viewer profile onto remote posts.
               LEFT JOIN users author ON ra.id IS NULL AND author.id = t.user_id
               -- Same-instance remote_actor stubs → local user profile enrichment.
               LEFT JOIN users peer ON ra.id IS NOT NULL
                   AND ra.username IS NOT NULL
                   AND peer.username = ra.username
                   AND (
                       ra.actor_url LIKE ($2 || '/users/%')
                       OR ra.domain = $3
                   )
               WHERE t.user_id = $1
                 AND (t.activity_type IS NULL OR t.activity_type <> 'Like')
               ORDER BY t.received_at DESC
               LIMIT 50"#,
            [user_id.into(), base.into(), local_domain.clone().into()],
        ))
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    let mut items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            let received_at = r
                .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "received_at")
                .ok()
                .map(|t| t.to_rfc3339());
            let remote_actor_url = r
                .try_get::<Option<String>>("", "remote_actor_url")
                .ok()
                .flatten()
                .filter(|s| !s.is_empty());
            let content_json = r
                .try_get::<Option<serde_json::Value>>("", "content_json")
                .ok()
                .flatten();
            let local_avatar_proxy = r
                .try_get::<Option<String>>("", "local_avatar_proxy")
                .ok()
                .flatten()
                .filter(|s| !s.is_empty());
            // Prefer the post author's remote_actor; never the viewer's profile.
            let actor = if let Some(url) = remote_actor_url {
                let remote_display = r
                    .try_get::<Option<String>>("", "remote_display_name")
                    .ok()
                    .flatten()
                    .filter(|s| !s.is_empty());
                let peer_display = r
                    .try_get::<Option<String>>("", "peer_display_name")
                    .ok()
                    .flatten()
                    .filter(|s| !s.is_empty());
                let remote_username = r
                    .try_get::<Option<String>>("", "remote_username")
                    .ok()
                    .flatten();
                let peer_username = r
                    .try_get::<Option<String>>("", "peer_username")
                    .ok()
                    .flatten();
                let remote_avatar = r
                    .try_get::<Option<String>>("", "remote_avatar_url")
                    .ok()
                    .flatten()
                    .filter(|s| !s.is_empty());
                json!({
                    "actor_url": url,
                    "username": remote_username.clone().or(peer_username.clone()),
                    "domain": r.try_get::<Option<String>>("", "remote_domain").ok().flatten(),
                    "display_name": remote_display
                        .or(peer_display)
                        .or(remote_username)
                        .or(peer_username),
                    "avatar_url": remote_avatar.or(local_avatar_proxy),
                })
            } else {
                let local_username = r
                    .try_get::<Option<String>>("", "author_username")
                    .ok()
                    .flatten()
                    .unwrap_or_default();
                let local_display = r
                    .try_get::<Option<String>>("", "author_display_name")
                    .ok()
                    .flatten()
                    .filter(|s| !s.is_empty());
                let actor_url = if local_username.is_empty() {
                    String::new()
                } else {
                    federation::types::actor_url(&base_url, &local_username)
                };
                let domain = federation::types::extract_domain(&base_url);
                json!({
                    "actor_url": actor_url,
                    "username": local_username,
                    "domain": domain,
                    "display_name": local_display,
                    "avatar_url": local_avatar_proxy,
                    "is_local": true,
                })
            };
            let object_id = content_json
                .as_ref()
                .and_then(federation::interactions::extract_object_id);
            json!({
                "activity_id": r.try_get::<String>("", "activity_id").unwrap_or_default(),
                "activity_type": r.try_get::<Option<String>>("", "activity_type").ok().flatten(),
                "object_type": r.try_get::<Option<String>>("", "object_type").ok().flatten(),
                "content_preview": r.try_get::<Option<String>>("", "content_preview").ok().flatten(),
                "content_json": content_json,
                "object_id": object_id,
                "is_read": r.try_get::<bool>("", "is_read").unwrap_or(false),
                // Frontend (Aro) expects created_at / timestamp for timeAgo()
                "created_at": received_at.clone(),
                "received_at": received_at,
                "actor": actor,
            })
        })
        .collect();

    // Enrich like/bookmark/announce/reply counts and me-flags
    let object_ids: Vec<String> = items
        .iter()
        .filter_map(|it| {
            it.get("object_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .collect();
    if let Ok(stats_map) =
        federation::interactions::interaction_stats_for_objects(db, user_id, &object_ids).await
    {
        for item in &mut items {
            if let Some(oid) = item
                .get("object_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
            {
                if let Some(st) = stats_map.get(&oid) {
                    if let Some(obj) = item.as_object_mut() {
                        obj.insert("liked_by_me".into(), json!(st.liked_by_me));
                        obj.insert("bookmarked_by_me".into(), json!(st.bookmarked_by_me));
                        obj.insert("announced_by_me".into(), json!(st.announced_by_me));
                        obj.insert("like_count".into(), json!(st.like_count));
                        obj.insert("bookmark_count".into(), json!(st.bookmark_count));
                        obj.insert("announce_count".into(), json!(st.announce_count));
                        obj.insert("reply_count".into(), json!(st.reply_count));
                        obj.insert("is_bookmarked".into(), json!(st.bookmarked_by_me));
                    }
                }
            }
        }
    }

    Ok(json!({"items": items, "total": items.len()}))
}

/// Start unified server with all routes (middleware controls access based on mode)
/// Authenticated `/api/federation/*` API surface.
///
/// Tapp host attribution and authentication are applied once at router level
/// instead of per route: `auth_middleware` runs first (outermost), then
/// `federation_host_attribution`, so grant-bearing requests are enforced on
/// every federation route — including ones added later — instead of silently
/// executing with host identity when a per-route layer is forgotten
/// (fail-closed). Admin-only trust management keeps its extra admin gate.
fn federation_api_router() -> Router {
    let main_router = Router::new()
        .route("/api/federation/identity", get(federation_identity))
        .route("/api/federation/keys/rotate", post(federation_keys_rotate))
        .route("/api/federation/follow", post(federation_follow))
        .route("/api/federation/unfollow", post(federation_unfollow))
        .route("/api/federation/following", get(federation_following_list))
        .route("/api/federation/followers", get(federation_followers_list))
        .route("/api/federation/timeline", get(federation_timeline))
        .route("/api/federation/publish", post(federation_publish))
        .route("/api/federation/notes", post(federation_create_note))
        .route("/api/federation/like", post(federation_like))
        .route("/api/federation/unlike", post(federation_unlike))
        .route("/api/federation/bookmark", post(federation_bookmark))
        .route("/api/federation/unbookmark", post(federation_unbookmark))
        .route("/api/federation/bookmarks", get(federation_bookmarks_list))
        .route("/api/federation/announce", post(federation_announce))
        .route("/api/federation/unannounce", post(federation_unannounce))
        .route("/api/federation/objects", get(federation_get_object))
        .route("/api/federation/unpublish", post(federation_unpublish))
        .route("/api/federation/published", get(federation_published_list))
        .route(
            "/api/federation/channels",
            get(federation_list_channels).post(federation_create_channel),
        )
        .route(
            "/api/federation/channels/{channel_id}",
            get(federation_get_channel).delete(federation_delete_channel),
        )
        .route(
            "/api/federation/channels/{channel_id}/close",
            post(federation_close_channel),
        )
        .route(
            "/api/federation/channels/{channel_id}/accept",
            post(federation_accept_channel),
        )
        .route(
            "/api/federation/channels/{channel_id}/e2e/key-exchange",
            post(federation_e2e_key_exchange),
        )
        .route(
            "/api/federation/channels/{channel_id}/messages",
            get(federation_get_messages).post(federation_send_message),
        )
        .route(
            "/api/federation/channels/{channel_id}/ws-ticket",
            post(api::tapp_runtime::mint_channel_ws_ticket),
        )
        .route(
            "/api/federation/channels/{channel_id}/ws",
            get(federation::ws_gateway::channel_websocket),
        )
        .route(
            "/api/federation/rooms",
            get(federation_list_rooms)
                .post(federation_create_room)
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/rooms/{room_id}",
            get(federation_get_room)
                .put(federation_update_room)
                .delete(federation_delete_room)
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/rooms/{room_id}/members",
            get(federation_get_room_members),
        )
        .route(
            "/api/federation/rooms/{room_id}/invite",
            post(federation_invite_room_member).layer(axum::extract::DefaultBodyLimit::max(
                FEDERATION_SMALL_BODY_LIMIT,
            )),
        )
        .route(
            "/api/federation/rooms/{room_id}/accept",
            post(federation_accept_room_invite),
        )
        .route(
            "/api/federation/rooms/{room_id}/reject",
            post(federation_reject_room_invite),
        )
        .route(
            "/api/federation/rooms/{room_id}/join",
            post(federation_join_room).layer(axum::extract::DefaultBodyLimit::max(
                FEDERATION_SMALL_BODY_LIMIT,
            )),
        )
        .route(
            "/api/federation/rooms/{room_id}/members/{actor}",
            delete(federation_remove_room_member),
        )
        .route(
            "/api/federation/rooms/{room_id}/members/{actor}/role",
            put(federation_set_room_member_role).layer(axum::extract::DefaultBodyLimit::max(
                FEDERATION_SMALL_BODY_LIMIT,
            )),
        )
        .route(
            "/api/federation/rooms/{room_id}/leave",
            post(federation_leave_room),
        )
        .route(
            "/api/federation/rooms/{room_id}/transfer-ownership",
            post(federation_transfer_room_ownership).layer(axum::extract::DefaultBodyLimit::max(
                FEDERATION_SMALL_BODY_LIMIT,
            )),
        )
        .route(
            "/api/federation/rooms/{room_id}/messages",
            get(federation_get_room_messages).post(federation_send_room_message),
        )
        .route(
            "/api/federation/rooms/{room_id}/e2e/key-exchange",
            post(federation_room_e2e_key_exchange),
        )
        .route(
            "/api/federation/rooms/{room_id}/stickers",
            post(federation_add_room_sticker).layer(axum::extract::DefaultBodyLimit::max(
                FEDERATION_SMALL_BODY_LIMIT,
            )),
        )
        .route(
            "/api/federation/rooms/{room_id}/stickers/{sticker_id}",
            delete(federation_remove_room_sticker),
        )
        .route(
            "/api/federation/rooms/{room_id}/messages/{message_id}/pin",
            post(federation_pin_room_message).layer(axum::extract::DefaultBodyLimit::max(
                FEDERATION_SMALL_BODY_LIMIT,
            )),
        )
        .route(
            "/api/federation/rooms/{room_id}/ws-ticket",
            post(api::tapp_runtime::mint_room_ws_ticket),
        )
        .route(
            "/api/federation/rooms/{room_id}/ws",
            get(federation::ws_gateway::room_websocket),
        )
        .route(
            "/api/federation/rings",
            get(federation_list_rings)
                .post(federation_create_ring)
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route("/api/federation/rings/{ring_id}", get(federation_get_ring))
        .route(
            "/api/federation/rings/{ring_id}/leave",
            post(federation_leave_ring),
        )
        .route(
            "/api/federation/rings/{ring_id}/peers",
            get(federation_get_ring_peers)
                .post(federation_add_ring_peer)
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/rings/{ring_id}/peers/{peer}",
            delete(federation_remove_ring_peer),
        )
        .route(
            "/api/federation/rings/{ring_id}/sync",
            post(federation_trigger_ring_sync),
        )
        .route(
            "/api/federation/delivery/stats",
            get(federation_delivery_stats),
        )
        .route("/api/federation/delivery", get(federation_list_delivery))
        .route(
            "/api/federation/delivery/retry-dead",
            post(federation_retry_all_dead_delivery),
        )
        .route(
            "/api/federation/delivery/cancel-pending",
            post(federation_cancel_all_pending_delivery),
        )
        .route(
            "/api/federation/delivery/purge-dead",
            post(federation_purge_dead_delivery),
        )
        .route(
            "/api/federation/delivery/{id}/retry",
            post(federation_retry_delivery),
        )
        .route(
            "/api/federation/delivery/{id}/cancel",
            post(federation_cancel_delivery),
        )
        .route(
            "/api/federation/delivery/{id}",
            delete(federation_dismiss_delivery),
        )
        .route(
            "/api/federation/trust/policy",
            get(federation_get_trust_policy)
                .put(federation_update_trust_policy)
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/trust/instances",
            get(federation_list_instances),
        )
        .route(
            "/api/federation/trust/update",
            post(federation_update_instance_trust)
                .route_layer(from_fn(middleware::auth::admin_middleware))
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/trust/block",
            post(federation_toggle_instance_block)
                .route_layer(from_fn(middleware::auth::admin_middleware))
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/trust/filters",
            get(federation_list_content_filters)
                .post(federation_create_content_filter)
                .route_layer(from_fn(middleware::auth::admin_middleware))
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/trust/filters/{id}",
            axum::routing::put(federation_update_content_filter)
                .delete(federation_delete_content_filter)
                .route_layer(from_fn(middleware::auth::admin_middleware))
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/channels/{channel_id}/transfers",
            get(federation_list_transfers)
                .post(federation_initiate_transfer)
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/rooms/{room_id}/transfers",
            get(federation_list_room_transfers)
                .post(federation_initiate_room_transfer)
                .layer(axum::extract::DefaultBodyLimit::max(
                    FEDERATION_SMALL_BODY_LIMIT,
                )),
        )
        .route(
            "/api/federation/rooms/{room_id}/files",
            get(federation_list_room_files),
        )
        .route(
            "/api/federation/transfers/{transfer_id}",
            get(federation_get_transfer),
        )
        .route(
            "/api/federation/transfers/{transfer_id}/content",
            get(federation_download_transfer),
        )
        .route(
            "/api/federation/transfers/{transfer_id}/chunks",
            post(federation_upload_chunk).layer(axum::extract::DefaultBodyLimit::max(
                federation::limits::TRANSFER_CHUNK_BODY_LIMIT,
            )),
        )
        .route(
            "/api/federation/transfers/{transfer_id}/cancel",
            post(federation_cancel_transfer),
        )
        // 已认证本地用户提交的联邦写操作（follow/channel/room/message、
        // base64 文件分块、Tapp 包快照）。上限见 federation::limits —— 那里
        // 同时约束「本端发得出的东西本端必须收得进」。
        .layer(axum::extract::DefaultBodyLimit::max(
            federation::limits::AUTHENTICATED_BODY_LIMIT,
        ))
        .route_layer(from_fn(api::tapp_runtime::federation_host_attribution))
        .route_layer(from_fn(middleware::auth::auth_middleware));

    // Freeform Note 媒体：图片/视频上限见 federation::limits::{NOTE_IMAGE_LIMIT,
    // NOTE_VIDEO_LIMIT}；路由层取二者中较大者再留信封余量。
    let media_router = Router::new()
        .route("/api/federation/media", post(federation_media_upload))
        .layer(axum::extract::DefaultBodyLimit::max(
            federation::limits::NOTE_VIDEO_LIMIT + 16 * 1024 * 1024,
        ))
        .route_layer(from_fn(api::tapp_runtime::federation_host_attribution))
        .route_layer(from_fn(middleware::auth::auth_middleware));

    main_router.merge(media_router)
}

async fn start_unified_server(config: AppConfig) -> anyhow::Result<()> {
    // Build CORS layer with security-first configuration
    use tower_http::cors::AllowOrigin;

    // Parse allowed origins from config
    let allowed_origins: Vec<axum::http::HeaderValue> = config
        .cors_origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();

    // Custom request headers used by the SPA must be listed for cross-origin preflight.
    let cors_allowed_headers = [
        axum::http::header::CONTENT_TYPE,
        axum::http::header::AUTHORIZATION,
        axum::http::header::ACCEPT,
        axum::http::header::HeaderName::from_static("x-csrf-token"),
        axum::http::header::HeaderName::from_static("x-tapp-runtime-grant"),
        axum::http::header::HeaderName::from_static("x-requested-with"),
    ];

    let cors = if allowed_origins.is_empty() {
        // Check if in production mode
        let is_production = std::env::var("ENVIRONMENT")
            .unwrap_or_else(|_| "development".to_string())
            == "production";

        if is_production {
            tracing::error!("🚨 SECURITY ERROR: CORS_ORIGINS must be configured in production!");
            tracing::error!("Set CORS_ORIGINS environment variable to your frontend domain(s)");
            tracing::error!(
                "Example: CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com"
            );
            panic!("CORS_ORIGINS is required in production mode for security");
        }

        tracing::warn!("⚠️ No CORS origins configured, using localhost-only for development");
        // Development mode: restrict to localhost
        let dev_origins = vec![
            "http://localhost:1102"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://localhost:1103"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://127.0.0.1:1102"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://127.0.0.1:1103"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
        ];
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(dev_origins))
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::PUT,
                axum::http::Method::DELETE,
                axum::http::Method::OPTIONS,
            ])
            .allow_headers(cors_allowed_headers)
            .allow_credentials(true)
    } else {
        tracing::info!("✅ CORS configured for origins: {:?}", config.cors_origins);
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(allowed_origins))
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::PUT,
                axum::http::Method::DELETE,
                axum::http::Method::OPTIONS,
            ])
            .allow_headers(cors_allowed_headers)
            .allow_credentials(true)
    };

    // Get database connection (might be None in config mode)
    let db_opt = DB_CONNECTION.read().await.clone();

    // Build the unified API router. Core setup/auth/config routes are always
    // registered through wrappers. Larger DB route groups are added on full-mode
    // startup, so setup-mode database changes restart the process.
    let api_router = Router::new()
        .route("/health", get(api::health))
        // Setup routes (always available)
        .route("/api/setup/config", get(api::setup::get_setup_config))
        .route("/api/setup/status", get(api::setup::check_setup_status))
        .route("/api/setup/init-env", post(api::setup::initialize_env_file))
        .route("/api/setup/update-env", post(api::setup::update_env_file))
        .route(
            "/api/setup/database-config",
            post(api::setup::save_database_config),
        )
        .route("/api/setup/init-database", post(api::setup::init_database))
        .route(
            "/api/setup/create-admin",
            post(api::auth_local::create_admin),
        )
        // System management routes
        // ⚠️ P2: system/status 暴露了一些系统信息，但为了监控保持公开（考虑移除敏感字段）
        .route("/api/system/status", get(api::system::system_status))
        .route(
            "/api/system/reload-config",
            post(api::system::reload_config)
                // ✅ P1 修复：配置重载应该只有 admin 可以触发
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // ✅ P2: 系统监控指标端点（内存、任务、连接等）- 🔒 需要管理员权限
        .route(
            "/api/metrics",
            get(api::metrics::get_metrics).route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // Authentication routes (use wrapper for dynamic DB access)
        .route("/api/auth/login", post(api::auth_local::local_login))
        .route("/api/auth/me", get(api::auth::get_current_user))
        .route(
            "/api/auth/logout",
            post(api::auth::logout), // 不需要认证中间件
        )
        // OAuth routes stay registered even if DB is temporarily unavailable,
        // keeping login/setup surfaces on 503 responses instead of 404s.
        .route("/api/auth/oauth/providers", get(api::oauth::list_providers))
        .route(
            "/api/auth/oauth/{slug}/login",
            get(api::oauth::provider_login),
        )
        .route(
            "/api/auth/oauth/{slug}/callback",
            get(api::oauth::provider_callback),
        )
        .route(
            "/api/auth/oauth/{slug}/link",
            get(api::oauth::provider_link).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/auth/oauth/{slug}/unlink/{identity_id}",
            axum::routing::delete(api::oauth::provider_unlink)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/auth/identities",
            get(api::oauth::list_my_identities)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/auth/identities/{identity_id}/primary",
            post(api::oauth::set_primary_identity)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/auth/change-password",
            post(api::auth_local::change_password)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 设置页用户管理（列表/创建/详情/更新/解绑 identity）— 仅管理员
        .route(
            "/api/admin/users",
            get(api::admin_users::list_users)
                .post(api::auth_local::admin_create_user)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/admin/users/{id}",
            get(api::admin_users::get_user)
                .patch(api::admin_users::update_user)
                .delete(api::admin_users::delete_user)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/admin/users/{id}/identities/{identity_id}",
            axum::routing::delete(api::admin_users::unlink_identity)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // Site public domain (BASE_URL / FRONTEND_URL / CORS) — not federation Move
        .route(
            "/api/admin/site/domain",
            post(change_site_domain).route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // ActivityPub domain Move (emit Move to followers for every local user)
        .route(
            "/api/admin/federation/domain-move",
            post(admin_federation_domain_move)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // PR #4: 公开注册（开关受 allow_local_registration 控制） + 后补密码 + 本地登录开关
        .route("/api/auth/register", post(api::auth_local::register))
        .route(
            "/api/auth/me/set-password",
            post(api::auth_local::set_password)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/auth/me/local-login",
            axum::routing::patch(api::auth_local::toggle_local_login)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // Configuration routes (use wrapper for dynamic DB access)
        .route(
            "/api/config",
            get(api::config::get_config).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/config",
            post(update_config).route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/config/settings-backup",
            get(export_settings)
                .post(restore_settings)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/config/settings-backup/preview",
            post(preview_settings_restore).route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/config/dashboard",
            post(api::config::update_dashboard_config)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/config/control-panel",
            post(api::config::update_control_panel_config)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/config/tapp-window-schemes",
            post(api::config::update_tapp_window_schemes)
                .route_layer(from_fn(middleware::auth::auth_middleware)), // 登录用户可保存
        )
        .route(
            "/api/config/module-visibility",
            get(api::config::get_module_visibility_preferences),
        )
        .route(
            "/api/config/module-visibility",
            put(api::config::update_module_visibility_preferences)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // 一言配置读取公开；全局写入仅管理员
        .route(
            "/api/config/hitokoto",
            get(api::config::get_hitokoto_config),
        )
        .route(
            "/api/config/hitokoto",
            axum::routing::put(api::config::update_hitokoto_config)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // 报告过期设置：读取公开（读取路径需要）；写入仅管理员
        .route(
            "/api/config/report-settings",
            get(api::config::get_report_settings),
        )
        .route(
            "/api/config/report-settings",
            axum::routing::put(api::config::update_report_settings)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // 权限配置 API
        .route("/api/config/permissions", get(api::config::get_permissions)) // 🔓 公开端点：获取当前用户权限
        .route(
            "/api/config/permissions",
            post(api::config::update_permissions)
                .route_layer(from_fn(middleware::auth::admin_middleware)), // 🔒 仅管理员
        )
        // PR #6: OAuth providers + 本地注册开关（仅管理员可读写）
        .route(
            "/api/config/oauth-providers",
            get(api::config::get_oauth_providers)
                .put(api::config::update_oauth_providers)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/config/test",
            post(api::config::test_platform)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route("/api/config/metadata", get(api::config::get_site_metadata)) // 🔓 公开端点：网站元数据
        .route("/api/config/public", get(api::config::get_public_config)) // 🔓 公开端点：平台公开信息（用于社交链接）
        .route("/api/config/ui", get(api::config::get_public_ui_config)) // 🔓 公开端点：UI配置（萌宠、壁纸等）
        // ✅ 安全修复 P0: CSRF Token 获取端点
        .route("/api/csrf-token", get(middleware::csrf::get_csrf_token))
        // AI推荐API - 🔓 公开端点：图标推荐服务
        .route(
            "/api/ai/recommend-icon",
            post(api::ai_recommend::recommend_icon),
        )
        // Profile routes (use wrapper for dynamic DB access) - ALWAYS REGISTERED
        .route("/api/profile/user-info", get(api::profile::get_user_info))
        .route("/api/profile/batch", get(api::profile::get_batch_user_info)); // 🚀 性能优化：批量API

    let mut api_router = api_router
        .route("/api/profile/metadata", get(api::profile::get_raw_metadata))
        // ==================== Federation (MFP) 公开端点 ====================
        // Layer 1: 发现（无需认证）
        .route(
            "/.well-known/webfinger",
            get(federation::discovery::webfinger),
        )
        .route(
            "/.well-known/nodeinfo",
            get(federation::discovery::nodeinfo_wellknown),
        )
        .route("/nodeinfo/2.1", get(federation::discovery::nodeinfo))
        // Public room directory card (join-by-id / federated public join)
        .route(
            "/api/federation/public/rooms/{room_id}",
            get(federation_get_public_room),
        )
        // Layer 2: Actor + Outbox + Collections（无需认证，AP 标准端点）
        .route("/users/{username}", get(federation::actor::get_actor))
        .route(
            "/users/{username}/avatar",
            get(federation::actor::get_avatar),
        )
        .nest_service(
            "/api/federation/avatar-cache",
            tower::ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::if_not_present(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("public, max-age=604800, immutable"),
                ))
                .service(ServeDir::new(&services::data_paths::paths().cache_images)),
        )
        // Public federation media (Note attachments Image/Video) — URLs embedded in AP.
        // Intentionally unauthenticated GET so remote instances can fetch media during
        // federation. Must stay outside session/auth middleware (see delivery.rs docs).
        .nest_service(
            "/media/federation",
            tower::ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::if_not_present(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("public, max-age=604800"),
                ))
                .service(ServeDir::new(federation::content::federation_media_root())),
        )
        .route(
            "/users/{username}/outbox",
            get(federation::outbox::get_outbox),
        )
        // 让 generate_activity_id 产出的 id 真正可解引用（与 Outbox 同一可见性投影）
        .route("/activities/{id}", get(federation::outbox::get_activity))
        .route(
            "/users/{username}/followers",
            get(federation::actor::get_followers),
        )
        .route(
            "/users/{username}/following",
            get(federation::actor::get_following),
        )
        // Layer 2: Inbox（远程实例投递，通过 HTTP Signature 验证）
        // 40 MiB: channel/room messages (up to 32 MiB payload, Tapp package share)
        // and FileChunk activities. Still under the global 50MB DefaultBodyLimit
        // used for media/avatar uploads — do not lower that global ceiling here.
        .merge(
            Router::new()
                .route(
                    "/users/{username}/inbox",
                    post(federation::inbox::post_inbox),
                )
                .route("/inbox", post(federation::inbox::post_shared_inbox))
                // 远端可达表面。verify_preparse_gate 会在解析 JSON 之前先校验
                // 签名头 / Date / Digest，攻击者要触发解析必须先算出正确的
                // SHA-256 —— 这是这个上限敢放宽的前提。
                .layer(axum::extract::DefaultBodyLimit::max(
                    federation::limits::INBOX_BODY_LIMIT,
                )),
        )
        // ==================== Federation API（需认证）====================
        // Tapp 宿主归因与认证在 federation_api_router() 内按 Router 级统一挂载。
        .merge(federation_api_router());

    // Add DB-dependent routes if we have a connection
    // These routes require more complex state handling so keep them conditional for now
    if let Some(db) = db_opt {
        let db_router = Router::new()
            // 单平台 Insights 生成 - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/reports/platform",
                post(api::reports::generate_platform_reports)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            .route(
                "/api/reports/generate-all",
                post(api::reports::generate_all_reports)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            // Note: /api/auth/me and /api/auth/logout are now registered above with wrappers
            // Note: /api/config routes are now registered above with wrappers, not here
            // Note: /api/profile/user-info, metadata now registered above with wrappers
            .route("/api/platforms", get(api::platforms::list_platforms))
            .route("/api/profiles", get(api::platforms::get_profiles))
            .route(
                "/api/fetch",
                post(api::platforms::trigger_fetch)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/analysis",
                get(api::analysis::get_analysis)
                    .post(api::analysis::trigger_analysis)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Prompt generation - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/prompt/generate",
                post(api::prompt::generate_prompt)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // 后台任务管理 API - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/tasks",
                post(api::tasks::submit_task)
                    .get(api::tasks::list_tasks)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tasks/{task_id}",
                get(api::tasks::get_task_status)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tasks/platform/{platform}",
                get(api::tasks::get_platform_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // 缓存管理 API - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/cache/status",
                get(api::cache::get_cache_status)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/cache/status/{platform}",
                get(api::cache::get_platform_cache_status)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/cache/{platform}",
                delete(api::cache::clear_platform_cache)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            .route(
                "/api/cache/clear",
                post(api::cache::clear_caches)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            .route(
                "/api/cache/all",
                delete(api::cache::clear_all_caches)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            // Profile report routes (complex ones still conditional) - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/profile/fetch-all",
                post(api::profile::fetch_all_data)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/profile/fetch-platform",
                post(api::profile::fetch_single_platform_data)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/profile/refresh",
                post(api::profile::refresh_platform_data)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/profile/cache",
                delete(api::profile::delete_platform_cache)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            // Library data route (公开访问 - 单用户系统)
            .route("/api/library", get(api::profile::get_library_data))
            .route(
                "/api/library/preferences",
                get(api::profile::get_library_source_preferences),
            )
            .route(
                "/api/library/preferences",
                axum::routing::put(api::profile::update_library_source_preferences)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            // Recent activities route (公开访问 - 单用户系统)
            .route("/api/activities", get(api::profile::get_recent_activities))
            // Reports routes (读取端点公开访问，支持未认证用户)
            .route("/api/reports/latest", get(api::reports::get_latest_report))
            .route(
                "/api/reports/list",
                get(api::tapp_runtime::list_reports)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // ============ Tapp 应用管理 API ============
            // 部分公开访问（游客可查看管理员的 Tapp），部分需要认证（在路由内部处理）
            .nest("/api/tapps", api::tapp_store::create_tapp_routes())
            // ============ Tapp Playground（管理员 + Pro 模型）============
            .nest(
                "/api/tapp-playground",
                api::tapp_playground::create_playground_routes(),
            )
            // ============ Agent AI 任务编排 API ============
            // 自然语言任务分解、执行和监控
            .nest("/api/agent", api::agent::create_agent_routes())
            // ============ Brew 阅读 API ============
            // RSS/Atom 订阅管理、文章获取、阅读状态同步
            .nest("/api/brew", api::brew::create_brew_routes())
            // ============ Brewlia AI 增强 API ============
            // AI 词汇注释、内容摘要等增强阅读功能
            .nest("/api/brewlia", api::brewlia::create_brewlia_routes())
            // ============ 语音服务 API ============
            // 腾讯云 TTS 文本转语音、ASR 语音转文本
            .nest("/api/speech", api::speech::create_speech_routes())
            // ============ Tapp API ============
            // Platform data API - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/tapp/platform/{platform}/data",
                get(api::tapp_runtime::get_platform_data)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/platform/{platform}/stats",
                get(api::tapp_runtime::get_platform_stats)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/platform/{platform}/distribution/{dimension}",
                get(api::tapp_runtime::get_platform_distribution)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/platform/items",
                post(api::tapp_runtime::add_platform_item)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/platform/items/batch",
                post(api::tapp_runtime::add_platform_items_batch)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // AI Task API - 支持权限下放（使用 optional_auth）
            .route(
                "/api/tapp/ai/v2/tasks",
                post(api::tapp_runtime::create_ai_task)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/ai/v2/tasks/{task_id}",
                get(api::tapp_runtime::get_ai_task)
                    .delete(api::tapp_runtime::cancel_ai_task)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/ai/v2/tasks/{task_id}/events",
                get(api::tapp_runtime::stream_ai_task_events)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/ai/v2/usage",
                get(api::tapp_runtime::ai_usage)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // 独立 AI 费用账本（宿主 UI 专用，读取本人逐次调用流水）
            .route(
                "/api/tapp/ai/v2/ledger",
                get(api::tapp_runtime::ai_cost_ledger)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // ============ Tapp P0 扩展 API ============
            // Data Processing: inline transforms support guests; platform/storage
            // inputs and outputs are still denied without their Runtime Grant permissions.
            .route(
                "/api/tapp/data/transform",
                post(api::tapp_runtime::data_transform)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // Cross-Tapp data remains private until a visible one-shot host
            // authorization has produced a consumable Data Access Grant.
            .route(
                "/api/tapp/data-exchange/requests",
                post(api::tapp_runtime::prepare_data_exchange)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/data-exchange/requests/{request_id}/authorize",
                post(api::tapp_runtime::authorize_data_exchange)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/data-exchange/requests/{request_id}",
                delete(api::tapp_runtime::cancel_data_exchange)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/data-exchange/consume",
                post(api::tapp_runtime::consume_data_exchange)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // Context API - 🔓 支持权限下放（公开信息）
            .route(
                "/api/tapp/context/app",
                get(api::tapp_runtime::get_context_app)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/context/user",
                get(api::tapp_runtime::get_context_user)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/context/player",
                get(api::tapp_runtime::get_context_player)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/context/navigation",
                get(api::tapp_runtime::get_context_navigation)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/context/system",
                get(api::tapp_runtime::get_context_system)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // Federation feed: guests see public items; users see public + personal items.
            .route(
                "/api/tapp/federation/feed",
                get(api::tapp_runtime::get_federation_feed)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // ============ Tapp P1 扩展 API ============
            // Report CRUD - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/tapp/reports",
                post(api::tapp_runtime::create_report)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/report-catalog",
                get(api::tapp_runtime::list_runtime_reports)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/report-catalog/{report_id}",
                get(api::tapp_runtime::get_runtime_report)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/report-catalog/platform/{platform}",
                get(api::tapp_runtime::get_runtime_platform_report)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/reports/tapp/{tapp_id}",
                get(api::tapp_runtime::list_tapp_reports)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/reports/{tapp_id}/{report_id}",
                get(api::tapp_runtime::get_tapp_report)
                    .put(api::tapp_runtime::update_tapp_report)
                    .delete(api::tapp_runtime::delete_tapp_report)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Media Control - 🔓 支持权限下放
            .route(
                "/api/tapp/media/control",
                post(api::tapp_runtime::media_control)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/media/status",
                get(api::tapp_runtime::media_status)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // Tapp notifications - unified notification pipeline
            .route(
                "/api/tapp/notifications",
                post(api::tapp_runtime::create_tapp_notification)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // P2: Component Registration
            .route(
                "/api/tapp/components/register",
                post(api::tapp_runtime::register_component)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/components/{tapp_id}/{component_type}/{component_id}",
                delete(api::tapp_runtime::unregister_component)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/components/{tapp_id}",
                get(api::tapp_runtime::list_components)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/components/all/{component_type}",
                get(api::tapp_runtime::list_all_components_by_type)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // P2: Shortcut Registration
            .route(
                "/api/tapp/shortcuts/register",
                post(api::tapp_runtime::register_shortcut)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/shortcuts/{tapp_id}/{shortcut_id}",
                delete(api::tapp_runtime::unregister_shortcut)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/shortcuts",
                get(api::tapp_runtime::list_shortcuts)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Manifest-scoped Event Broker
            .route(
                "/api/tapp/events/publish",
                post(api::tapp_runtime::publish_event)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/events/stream",
                get(api::tapp_runtime::stream_events)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/agent/v2/interactions/stream",
                get(api::tapp_runtime::stream_agent_interactions)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/agent/v2/interactions/{interaction_id}",
                get(api::tapp_runtime::get_agent_interaction)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/agent/v2/interactions/{interaction_id}/accept",
                post(api::tapp_runtime::accept_agent_interaction)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/agent/v2/interactions/{interaction_id}/result",
                post(api::tapp_runtime::submit_agent_interaction_result)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/agent/v2/interactions/{interaction_id}/reject",
                post(api::tapp_runtime::reject_agent_interaction)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/agent/v2/interactions/{interaction_id}/intents",
                post(api::tapp_runtime::request_agent_intent)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // Metrics & Rate Limit
            .route(
                "/api/tapp/metrics",
                get(api::tapp_runtime::get_tapp_metrics)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/rate-limit/{tapp_id}",
                get(api::tapp_runtime::get_rate_limit_status)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // ============ Tapp 定时任务 API ============
            // Scheduler - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/tapp/scheduler/tasks",
                get(api::tapp_scheduler::list_tasks)
                    .post(api::tapp_scheduler::register_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks",
                get(api::tapp_scheduler::list_tapp_tasks)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks/{task_id}",
                get(api::tapp_scheduler::get_task)
                    .delete(api::tapp_scheduler::unregister_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks/{task_id}/enable",
                post(api::tapp_scheduler::enable_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks/{task_id}/disable",
                post(api::tapp_scheduler::disable_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks/{task_id}/trigger",
                post(api::tapp_scheduler::trigger_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/ws",
                get(api::tapp_scheduler::scheduler_websocket)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // ============ Tapp API 声明系统 ============
            // API Execute - 支持 public 和 protected 两级权限
            .route(
                "/api/tapp/{tapp_id}/api/{api_name}",
                post(api::tapp_runtime::execute_tapp_api)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // API List - 列出 Tapp 可用的 API
            .route(
                "/api/tapp/{tapp_id}/apis",
                get(api::tapp_runtime::list_tapp_apis)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // Context Geo - 公开 API，获取客户端地理位置
            .route(
                "/api/tapp/context/geo",
                get(api::tapp_runtime::get_context_geo)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // Image proxy route
            .route("/api/proxy/image", get(api::proxy::proxy_image))
            // Client geo location route
            .route("/api/proxy/client-geo", get(api::proxy::get_client_geo))
            // Hitokoto proxy route
            .route("/api/proxy/hitokoto", get(api::proxy::proxy_hitokoto))
            // Web content fetch proxy (for reading list from web search)
            .route(
                "/api/proxy/fetch-content",
                get(api::proxy::fetch_web_content),
            )
            // Music proxy routes
            .route(
                "/api/proxy/music/netease/playlist/{id}",
                get(api::proxy::proxy_netease_playlist),
            )
            .route(
                "/api/proxy/music/netease/lyrics/{id}",
                get(api::proxy::proxy_netease_lyrics),
            )
            .route(
                "/api/proxy/music/netease/lyrics-verbatim/{id}",
                get(api::proxy::proxy_netease_lyrics_verbatim),
            )
            .route(
                "/api/proxy/music/netease/song/{id}",
                get(api::proxy::proxy_netease_song),
            )
            .route(
                "/api/proxy/music/netease/audio/{id}",
                get(api::proxy::proxy_netease_audio),
            )
            // 仅解析 HTTPS CDN 播放链（302），音频字节仍直连网易 — 国内站 Mixed Content 修复
            .route(
                "/api/proxy/music/netease/play-url/{id}",
                get(api::proxy::proxy_netease_play_url),
            )
            .route(
                "/api/proxy/music/qq/playlist/{id}",
                get(api::proxy::proxy_qq_playlist),
            )
            .route(
                "/api/proxy/music/qq/audio/{id}",
                get(api::proxy::proxy_qq_audio),
            )
            .route(
                "/api/proxy/music/qq/lyrics/{id}",
                get(api::proxy::proxy_qq_lyrics),
            )
            .route(
                "/api/proxy/music/kugou/lyrics-verbatim",
                get(api::proxy::proxy_kugou_lyrics_verbatim),
            )
            // Bilibili API routes
            .route("/api/bilibili/user", get(api::bilibili::get_bilibili_user))
            .route(
                "/api/bilibili/user/{uid}",
                get(api::bilibili::get_bilibili_user_info),
            )
            .route(
                "/api/bilibili/favorites/{uid}",
                get(api::bilibili::get_bilibili_favorites),
            )
            .route(
                "/api/bilibili/bangumi/{uid}",
                get(api::bilibili::get_bilibili_bangumi),
            )
            .route(
                "/api/bilibili/bangumi/all/{uid}",
                get(api::bilibili::get_all_bilibili_bangumi),
            )
            // Bangumi API routes
            .route("/api/bangumi/user", get(api::bangumi::get_bangumi_user))
            .route(
                "/api/bangumi/user/{username}",
                get(api::bangumi::get_bangumi_user_info),
            )
            .route("/api/bangumi/me", get(api::bangumi::get_bangumi_me))
            .route(
                "/api/bangumi/collections/{username}",
                get(api::bangumi::get_bangumi_collections),
            )
            // Steam API routes
            .route("/api/steam/presence", get(api::steam::get_steam_presence))
            .route("/api/steam/user", get(api::steam::get_steam_user))
            .route("/api/steam/user/info", get(api::steam::get_steam_user_info))
            .route("/api/steam/games", get(api::steam::get_steam_games))
            // 游戏公开状态小组件（UID / Gamertag / Online ID，无用户 Cookie）
            .route(
                "/api/game/presence",
                get(api::game_presence::get_game_presence),
            )
            .route(
                "/api/game/presence/capabilities",
                get(api::game_presence::get_game_presence_capabilities),
            )
            .route(
                "/api/steam/wishlist/{steam_id}",
                get(api::steam::get_steam_wishlist),
            )
            .route("/api/steam/stats", get(api::steam::get_steam_stats))
            .route(
                "/api/steam/game/{app_id}",
                get(api::steam::get_steam_game_details),
            )
            // X (Twitter) — 直连调试接口会带 bearer query，必须登录；正式同步走配置 + profile fetch
            .route(
                "/api/x/user",
                get(api::x::get_x_user).route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/x/user/info",
                get(api::x::get_x_user_info)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // 分享到 X：仅生成 Intent 链接（不代发帖、不 OAuth）
            .route(
                "/api/x/share/status",
                get(api::x::share_status).route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/x/share",
                post(api::x::share_to_x).route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Discord — 调试接口带 access_token query，必须登录；正式同步走配置 + profile fetch
            .route(
                "/api/discord/status",
                get(api::discord::discord_status)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/discord/me",
                get(api::discord::get_discord_me)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/discord/profile",
                get(api::discord::get_discord_profile)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Discord 数据平台一键授权（start 需 admin cookie；callback 公开 + state CSRF）
            .route(
                "/api/platforms/discord/oauth/start",
                get(api::discord::oauth_start)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/platforms/discord/oauth/callback",
                get(api::discord::oauth_callback),
            )
            // MyAnimeList — 调试接口：username 必填，client_id 可选；正式同步走配置 + profile fetch
            .route(
                "/api/mal/user",
                get(api::mal::get_mal_user).route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/mal/user/{username}",
                get(api::mal::get_mal_user_info)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/mal/anime/{username}",
                get(api::mal::get_mal_anime_list)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/mal/manga/{username}",
                get(api::mal::get_mal_manga_list)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .with_state(db);

        // Merge with base router
        api_router = api_router.merge(db_router);
    }

    // 🚀 Updater admin proxy routes (admin-only). Backend forwards to the updater container
    // and injects UPDATE_TOKEN server-side, so the browser never sees the secret.
    // See docs/updater-spec.md §13.
    {
        use middleware::auth::admin_middleware;
        api_router = api_router
            .route(
                "/api/admin/updater/status",
                get(api::updater_admin::status).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/available",
                get(api::updater_admin::available).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/jobs",
                get(api::updater_admin::jobs).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/jobs/{id}",
                get(api::updater_admin::job).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/snapshots",
                get(api::updater_admin::snapshots).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/snapshots/{id}",
                axum::routing::delete(api::updater_admin::delete_snapshot)
                    .route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/commits",
                get(api::updater_admin::commits).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/builds",
                get(api::updater_admin::builds).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/releases",
                get(api::updater_admin::releases).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/compare",
                get(api::updater_admin::compare).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/update",
                post(api::updater_admin::trigger_update).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/prefs",
                post(api::updater_admin::set_prefs).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/rollback",
                post(api::updater_admin::rollback).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/diagnostics",
                get(api::updater_admin::diagnostics).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/rescue/exit-maintenance",
                post(api::updater_admin::exit_maintenance).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/rescue/forget-current",
                post(api::updater_admin::forget_current).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/rescue/continue",
                post(api::updater_admin::rescue_continue).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/self-update",
                post(api::updater_admin::self_update).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/proxy-update",
                post(api::updater_admin::proxy_update).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/self-update/last",
                get(api::updater_admin::self_update_last).route_layer(from_fn(admin_middleware)),
            );
    }

    // Apply middleware and layers
    let api_router = api_router
        .layer(from_fn(config_mode_middleware))
        .layer(from_fn(middleware::csrf::csrf_middleware)) // ✅ 安全修复 P0: CSRF 防护
        .layer(from_fn(middleware::rate_limit::rate_limit_middleware)) // Rate limiting
        // Apply security headers after the complete route graph is assembled.
        .layer(from_fn(middleware::security::security_headers_middleware))
        // Global 50MB: media/avatar uploads need a large ceiling. Federation public
        // inbox + federation_api_router apply a stricter 40 MiB DefaultBodyLimit
        // on their own routers (nested limits still apply under this outer layer).
        .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024)) // 🛡️ 防止OOM: 限制请求体最大50MB
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Now the type is unified, convert to Router<()> by applying route matching
    let app: Router = if std::path::Path::new(&config.frontend_dist_path).exists() {
        tracing::info!("Serving frontend from: {}", config.frontend_dist_path);
        // SPA fallback: 未匹配的浏览器路由 → index.html（React Router）。
        // 重要：ServeDir 对任何非 GET/HEAD 请求直接返回 405，所以 /api/* 绝不能落到
        // 静态文件服务——否则未注册的 POST（例如旧 backend 进程缺 /prefs）会误报 405
        // 而不是可读的 JSON 404。
        let index_html = std::path::Path::new(&config.frontend_dist_path).join("index.html");
        let serve_dir =
            ServeDir::new(&config.frontend_dist_path).not_found_service(ServeFile::new(index_html));

        api_router.fallback(move |req: Request| {
            let serve_dir = serve_dir.clone();
            async move {
                let path = req.uri().path();
                if path.starts_with("/api/") || path == "/health" {
                    return (
                        StatusCode::NOT_FOUND,
                        Json(json!({
                            "error": "Not Found",
                            "message": format!(
                                "No API route for {} {}",
                                req.method(),
                                path
                            ),
                        })),
                    )
                        .into_response();
                }
                // Resolve the cache tier before `req` is consumed by oneshot.
                let cache_control = static_asset_cache_control(path);
                use tower::ServiceExt;
                match serve_dir.oneshot(req).await {
                    Ok(res) => {
                        let mut res = res.into_response();
                        res.headers_mut().insert(
                            axum::http::header::CACHE_CONTROL,
                            axum::http::HeaderValue::from_static(cache_control),
                        );
                        res
                    }
                    Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                }
            }
        })
    } else {
        tracing::warn!("Frontend dist path not found, serving API only");
        api_router
    };

    // Spawn background task to clean up old tasks (防止内存泄漏)
    tokio::spawn(async {
        let mut cleanup_interval = tokio::time::interval(tokio::time::Duration::from_secs(300)); // 每5分钟
        loop {
            cleanup_interval.tick().await;
            services::background_processor::BACKGROUND_PROCESSOR
                .cleanup_old_tasks()
                .await;
            tracing::info!("🧹 Background task cleanup completed");
        }
    });

    // Spawn background task to monitor for config reload
    tokio::spawn(async move {
        let mut check_interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
        loop {
            check_interval.tick().await;

            if api::system::is_config_reload_requested() {
                tracing::info!(
                    "🔄 Configuration reload detected - attempting to reconnect database"
                );
                api::system::reset_config_reload_flag();

                // Reload .env file with override to ensure latest values
                let env_path = std::path::PathBuf::from(".env");
                if let Err(e) = dotenvy::from_path_override(&env_path) {
                    tracing::warn!("⚠️ Failed to reload .env file: {}", e);
                } else {
                    tracing::info!("♻️ Environment variables reloaded from .env");
                }

                match AppConfig::from_env() {
                    Ok(new_config) => {
                        // Update global config FIRST for hot-reload
                        *GLOBAL_CONFIG.write().await = new_config.clone();
                        tracing::info!(
                            "♻️ Global configuration updated - AI API settings now live!"
                        );

                        if !new_config.database_url.is_empty() {
                            match db::connection::establish_connection(&new_config.database_url)
                                .await
                            {
                                Ok(db) => {
                                    tracing::info!("✅ Database connection established!");

                                    match api::tapp_store::recover_tapp_filesystem_state(&db).await
                                    {
                                        Ok(0) => {}
                                        Ok(count) => tracing::warn!(
                                            count,
                                            "Recovered interrupted Tapp filesystem transactions"
                                        ),
                                        Err(error) => tracing::error!(
                                            %error,
                                            "Failed to inspect Tapp filesystem transaction state"
                                        ),
                                    }

                                    // Update global database connection
                                    *DB_CONNECTION.write().await = Some(db.clone());

                                    // Reload dynamic configuration from database
                                    let config_service = ConfigService::new(db);
                                    match config_service.load_config().await {
                                        Ok(dynamic_config) => {
                                            *GLOBAL_DYNAMIC_CONFIG.write().await = dynamic_config;
                                            tracing::info!(
                                                "✅ Dynamic configuration reloaded from database"
                                            );
                                        }
                                        Err(e) => {
                                            tracing::warn!(
                                                "⚠️  Failed to reload dynamic config: {}",
                                                e
                                            );
                                        }
                                    }

                                    // 🔐 Reload OAuth provider registry from new dynamic config
                                    services::oauth::registry::REGISTRY.reload().await;

                                    // Switch to full mode FIRST before logging
                                    CONFIG_MODE.store(false, Ordering::Relaxed);

                                    tracing::info!(
                                        "🎉 Switched from CONFIGURATION MODE to FULL MODE"
                                    );
                                    tracing::info!("✨ All API endpoints are now available!");
                                    tracing::info!(
                                        "🔓 Login endpoint is now accessible at /api/auth/login"
                                    );
                                }
                                Err(e) => {
                                    tracing::error!(
                                        "❌ Database connection failed after reload: {}",
                                        e
                                    );
                                    tracing::info!("🔧 Staying in configuration mode");
                                }
                            }
                        } else {
                            tracing::warn!("⚠️  DATABASE_URL still empty after reload");
                        }
                    }
                    Err(e) => {
                        tracing::error!("❌ Failed to reload configuration: {}", e);
                    }
                }
            }
        }
    });

    // Spawn database health check task (P1优化：定期健康检查和自动重连)
    tokio::spawn(async {
        let mut health_check_interval = tokio::time::interval(tokio::time::Duration::from_secs(60)); // 每分钟检查一次
        loop {
            health_check_interval.tick().await;

            let db_opt = DB_CONNECTION.read().await;
            if let Some(db) = db_opt.as_ref() {
                // 执行简单查询测试连接
                match db
                    .execute(sea_orm::Statement::from_string(
                        sea_orm::DatabaseBackend::Postgres,
                        "SELECT 1".to_owned(),
                    ))
                    .await
                {
                    Ok(_) => {
                        tracing::debug!("💚 Database health check passed");
                    }
                    Err(e) => {
                        tracing::error!("❌ Database health check failed: {}", e);

                        // 尝试重新连接
                        drop(db_opt); // 释放读锁

                        let config = GLOBAL_CONFIG.read().await;
                        if !config.database_url.is_empty() {
                            tracing::info!("🔄 Attempting to reconnect to database...");
                            match crate::db::connection::establish_connection(&config.database_url)
                                .await
                            {
                                Ok(new_db) => {
                                    *DB_CONNECTION.write().await = Some(new_db);
                                    tracing::info!("✅ Database reconnected successfully");
                                }
                                Err(e) => {
                                    tracing::error!("❌ Failed to reconnect to database: {}", e);
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Start server with the app (convert to service within start_server)
    start_server(config, app).await
}

/// Common server startup logic
async fn start_server(config: AppConfig, app: Router) -> anyhow::Result<()> {
    let host = config
        .server_host
        .parse::<std::net::IpAddr>()
        .unwrap_or_else(|_| std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let addr = SocketAddr::new(host, config.server_port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("🚀 Server listening on http://{}", addr);

    // Use graceful shutdown with ConnectInfo support
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

async fn shutdown_signal() {
    use tokio::signal;

    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            tracing::info!("Received Ctrl+C signal");
        },
        _ = terminate => {
            tracing::info!("Received terminate signal");
        },
    }

    tracing::info!("Starting graceful shutdown...");

    // 停止调度器引擎
    api::tapp_scheduler::shutdown_scheduler().await;
    services::brew_scheduler::shutdown_brew_scheduler().await;

    // 等待进行中的 heartbeat（最长 30s），减少杀进程时半途副作用
    services::agent::heartbeat::wait_inflight_drain(std::time::Duration::from_secs(30)).await;

    // Agent 状态落盘 + MCP 子进程回收（滚动更新不丢最近记忆/技能统计）
    if let Some(memory) = services::agent::memory::get_memory() {
        memory.force_flush().await;
        tracing::info!("[Shutdown] Agent memory flushed");
    }
    if let Some(evolution) = services::agent::skill_evolution::get_skill_evolution() {
        evolution.flush().await;
        tracing::info!("[Shutdown] Skill evolution stats flushed");
    }
    services::agent::mcp::shutdown_mcp().await;
}

#[cfg(test)]
mod cache_control_tests {

    /// `?limit=` 的宽松解析必须保持不变。
    ///
    /// 改造前是手写 `q.split('&').find_map(...)`，对 `limit=abc` / `limit=` 静默
    /// 回落到默认值。换成 `Query<LimitQuery>` 时若用 `Option<i64>`，serde 会把
    /// 这些请求变成 400 —— 那是夹带在重构里的行为改变。
    #[test]
    fn limit_query_falls_back_instead_of_rejecting() {
        let malformed = super::LimitQuery {
            limit: Some("abc".into()),
        };
        assert_eq!(malformed.or(50), 50);

        let empty = super::LimitQuery {
            limit: Some(String::new()),
        };
        assert_eq!(empty.or(100), 100);

        let absent = super::LimitQuery { limit: None };
        assert_eq!(absent.or(7), 7);

        let valid = super::LimitQuery {
            limit: Some("25".into()),
        };
        assert_eq!(valid.or(50), 25);

        // 负数与超大值原样透传给下游（与手写解析一致，不在这层做范围检查）
        let negative = super::LimitQuery {
            limit: Some("-1".into()),
        };
        assert_eq!(negative.or(50), -1);
    }

    /// `?cancelled_only=` 的真值解析必须保持宽松。
    ///
    /// 前端用的是 `?cancelled_only=1`。若换成 `Option<bool>`，serde 只认
    /// `true`/`false`，`1` 会变成 400。
    #[test]
    fn purge_dead_query_accepts_loose_truthy_values() {
        let t = |v: &str| {
            super::PurgeDeadQuery {
                limit: None,
                cancelled_only: Some(v.into()),
            }
            .cancelled_only()
        };

        for truthy in ["1", "true", "TRUE", "yes", "on", "On"] {
            assert!(t(truthy), "{truthy} should be truthy");
        }
        for falsy in ["0", "false", "no", "off", "", "garbage"] {
            assert!(!t(falsy), "{falsy} should be falsy");
        }

        // 缺省即 false
        assert!(!super::PurgeDeadQuery {
            limit: None,
            cancelled_only: None,
        }
        .cancelled_only());

        // limit 沿用同样的宽松回落
        assert_eq!(
            super::PurgeDeadQuery {
                limit: Some("abc".into()),
                cancelled_only: None,
            }
            .limit_or(100),
            100
        );
    }
    use super::static_asset_cache_control;

    #[test]
    fn hashed_assets_are_immutable() {
        assert_eq!(
            static_asset_cache_control("/assets/AnimatedView-xVp24sZE.js"),
            "public, max-age=31536000, immutable"
        );
        // A hashed image under /assets/ is still immutable (hash wins over ext).
        assert_eq!(
            static_asset_cache_control("/assets/logo-abc123.png"),
            "public, max-age=31536000, immutable"
        );
    }

    #[test]
    fn unhashed_media_and_fonts_get_weeklong_ttl() {
        let expected = "public, max-age=604800, stale-while-revalidate=86400";
        assert_eq!(
            static_asset_cache_control("/icons/config/users.png"),
            expected
        );
        assert_eq!(
            static_asset_cache_control("/game-logos/starrail.png"),
            expected
        );
        assert_eq!(static_asset_cache_control("/logo.webp"), expected);
        assert_eq!(static_asset_cache_control("/favicon.webp"), expected);
        assert_eq!(
            static_asset_cache_control("/fonts/hoyo/GenshinUI-subset.woff2"),
            expected
        );
    }

    #[test]
    fn sw_and_html_always_revalidate() {
        assert_eq!(static_asset_cache_control("/sw.js"), "no-cache");
        assert_eq!(static_asset_cache_control("/"), "no-cache");
        assert_eq!(static_asset_cache_control("/index.html"), "no-cache");
        // SPA fallback routes resolve to index.html but keep their request path.
        assert_eq!(static_asset_cache_control("/tapp/run/abc"), "no-cache");
    }
}
