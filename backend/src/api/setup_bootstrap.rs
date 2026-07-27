//! CONFIG_MODE 的引导凭证（Setup 控制面守卫）
//!
//! # 要解决的问题
//!
//! `CONFIG_MODE` 会在**数据库连不上**时自动开启，而它开放的 setup 路由可以改写
//! `.env` 里的 `DATABASE_URL` / `JWT_SECRET` / `CORS_ORIGINS`。这两件事组合起来，
//! 把一次普通的数据库故障升级成了「匿名可达的控制面」：任何能访问该端口的人都
//! 能把实例指向自己的 PostgreSQL、换掉 JWT 签名密钥、放开 CORS。
//!
//! # 修复思路
//!
//! 区分两种进入 CONFIG_MODE 的情形：
//!
//! - **首次安装** —— 还没有 `.env`，或 `.env` 里没有真实的 `DATABASE_URL`。
//!   此时 setup 向导本来就该开放，否则用户没有任何办法完成初装。
//! - **已配置过的实例** —— `.env` 里有真实 `DATABASE_URL`，说明这台实例此前跑起来
//!   过，现在只是数据库不可达。此时 setup **不该**重新开放。
//!
//! 第二种情形下，进程会生成一次性引导令牌，写进日志和一个仅属主可读的文件；
//! 改写配置的 setup 端点必须携带 `X-Bootstrap-Token` 才会执行。运维能从容器日志
//! 或宿主文件系统拿到它，网络上的攻击者拿不到。
//!
//! 这与 Jenkins 的 `initialAdminPassword` 是同一个模式：不牺牲可恢复性，但把
//! 「能改配置」从「能连到端口」收紧为「能读到宿主的日志/文件」。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use rand::{distr::Alphanumeric, RngExt};
use serde_json::{json, Value};
use subtle::ConstantTimeEq;

/// 请求头名称。
pub const BOOTSTRAP_TOKEN_HEADER: &str = "x-bootstrap-token";

/// 令牌落盘文件名（与 `.env` 同目录）。
const TOKEN_FILE_NAME: &str = ".bootstrap-token";

/// 进程级引导令牌。
///
/// `None` = 首次安装，setup 无需令牌；`Some` = 已配置实例进入了 CONFIG_MODE。
static BOOTSTRAP_TOKEN: OnceLock<Option<String>> = OnceLock::new();

/// `.env` 里被视为「占位符」的 DATABASE_URL 值。
///
/// `.env.example` 复制过来但没填的情况很常见，不能因此就认定实例已配置。
fn is_placeholder_database_url(value: &str) -> bool {
    let v = value.trim().trim_matches('"').trim_matches('\'');
    if v.is_empty() {
        return true;
    }
    let lower = v.to_ascii_lowercase();
    lower.contains("your_password")
        || lower.contains("yourpassword")
        || lower.contains("changeme")
        || lower.contains("<")
        || lower == "postgres://"
        || lower == "postgresql://"
}

/// 从 `.env` 文本里取某个 key 的值。
fn env_value<'a>(content: &'a str, key: &str) -> Option<&'a str> {
    content.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            return None;
        }
        let (k, v) = trimmed.split_once('=')?;
        (k.trim() == key).then_some(v.trim())
    })
}

/// 这台实例此前是否已经完成过配置。
///
/// 判定依据只看磁盘上的 `.env` —— 因为进入 CONFIG_MODE 时数据库按定义是不可达的，
/// 不能依赖任何数据库状态。
pub fn instance_previously_configured(env_path: &Path) -> bool {
    configured_with_env(env_path, std::env::var("DATABASE_URL").ok().as_deref())
}

/// [`instance_previously_configured`] 的纯函数版本。
///
/// 把进程环境作为参数传入而不是在内部读取 —— 否则这个判断没法在测试里
/// 稳定复现（环境变量是进程全局的，并行测试会互相干扰）。
fn configured_with_env(env_path: &Path, database_url_env: Option<&str>) -> bool {
    // 环境变量里直接给了 DATABASE_URL（compose 常见写法）也算已配置。
    if let Some(from_env) = database_url_env {
        if !is_placeholder_database_url(from_env) {
            return true;
        }
    }
    let Ok(content) = std::fs::read_to_string(env_path) else {
        return false;
    };
    env_value(&content, "DATABASE_URL")
        .map(|v| !is_placeholder_database_url(v))
        .unwrap_or(false)
}

fn token_file_path(env_path: &Path) -> PathBuf {
    env_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(TOKEN_FILE_NAME)
}

/// 生成 48 字符的字母数字令牌。
fn generate_token() -> String {
    rand::rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

/// 把令牌写到仅属主可读的文件。
///
/// 写失败不是致命错误 —— 日志里那份仍然可用，所以只记 warn。
fn persist_token(path: &Path, token: &str) {
    if let Err(e) = std::fs::write(path, format!("{token}\n")) {
        tracing::warn!(path = %path.display(), "Failed to write bootstrap token file: {e}");
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
            tracing::warn!(path = %path.display(), "Failed to chmod bootstrap token file: {e}");
        }
    }
}

/// 进入 CONFIG_MODE 时调用一次，决定本进程是否需要引导令牌。
///
/// 幂等：重复调用返回首次的结果。
pub fn init_for_config_mode(env_path: &Path) -> Option<&'static str> {
    BOOTSTRAP_TOKEN
        .get_or_init(|| {
            if !instance_previously_configured(env_path) {
                tracing::info!(
                    "🔓 First-run setup: no configured DATABASE_URL on disk, \
                     setup endpoints are open without a bootstrap token"
                );
                return None;
            }

            // 允许运维用固定值预置（k8s Secret / compose env 场景）。
            let token = std::env::var("MYRIAD_BOOTSTRAP_TOKEN")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(generate_token);

            let path = token_file_path(env_path);
            persist_token(&path, &token);

            tracing::warn!(
                "🔐 This instance is already configured but the database is unreachable.\n\
                 Setup endpoints that modify configuration now REQUIRE a bootstrap token.\n\
                 Token: {token}\n\
                 Also written to: {}\n\
                 Send it as the `{BOOTSTRAP_TOKEN_HEADER}` header.",
                path.display()
            );

            Some(token)
        })
        .as_deref()
}

/// 校验请求携带的引导令牌。
///
/// 首次安装（无令牌要求）直接放行。
pub fn require_bootstrap(headers: &HeaderMap) -> Result<(), (StatusCode, Json<Value>)> {
    let Some(Some(expected)) = BOOTSTRAP_TOKEN.get() else {
        // 未初始化或首次安装 —— 无需令牌。
        return Ok(());
    };

    let provided = headers
        .get(BOOTSTRAP_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .unwrap_or("");

    // 长度先比，避免把长度差异也交给常数时间比较（长度本身不是秘密）。
    let ok = provided.len() == expected.len()
        && provided.as_bytes().ct_eq(expected.as_bytes()).into();

    if ok {
        return Ok(());
    }

    tracing::warn!(
        "🚨 Setup request REJECTED: missing or invalid {} header. \
         This instance is already configured; reconfiguring requires the bootstrap \
         token printed in the startup logs.",
        BOOTSTRAP_TOKEN_HEADER
    );
    Err((
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "error": "Bootstrap token required",
            "message": "该实例此前已完成配置。修改配置需要提供启动日志中打印的引导令牌。",
            "header": BOOTSTRAP_TOKEN_HEADER,
        })),
    ))
}

/// 校验单个 `.env` 值是否可以安全写入。
///
/// `.env` 是逐行 `KEY=VALUE` 的格式，值里出现 CR/LF 就能凭空造出新的一行，
/// 也就是注入任意环境变量。NUL 会截断多数解析器，一并拒绝。
pub fn validate_env_value(key: &str, value: &str) -> Result<(), String> {
    if value.contains('\n') || value.contains('\r') {
        return Err(format!(
            "{key} contains a line break; that would inject additional .env entries"
        ));
    }
    if value.contains('\0') {
        return Err(format!("{key} contains a NUL byte"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_database_urls_do_not_count_as_configured() {
        assert!(is_placeholder_database_url(""));
        assert!(is_placeholder_database_url("  "));
        assert!(is_placeholder_database_url(
            "postgres://user:your_password@localhost/db"
        ));
        assert!(is_placeholder_database_url("postgres://<host>/db"));
        assert!(is_placeholder_database_url("postgres://"));
        assert!(!is_placeholder_database_url(
            "postgres://myriad:s3cret@db:5432/myriad"
        ));
    }

    #[test]
    fn env_value_skips_comments_and_trims() {
        let content = "# DATABASE_URL=commented\nRUST_LOG=info\nDATABASE_URL= postgres://a/b \n";
        assert_eq!(env_value(content, "DATABASE_URL"), Some("postgres://a/b"));
        assert_eq!(env_value(content, "RUST_LOG"), Some("info"));
        assert_eq!(env_value(content, "MISSING"), None);
    }

    #[test]
    fn previously_configured_reads_env_file() {
        let dir = std::env::temp_dir().join(format!("myriad-bootstrap-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let env_path = dir.join(".env");

        // 显式传 None，不受运行环境里是否设了 DATABASE_URL 影响
        // 不存在 → 首次安装
        assert!(!configured_with_env(&env_path, None));

        // 占位符 → 仍算首次安装
        std::fs::write(
            &env_path,
            "DATABASE_URL=postgres://user:your_password@localhost/db\n",
        )
        .unwrap();
        assert!(!configured_with_env(&env_path, None));

        // 真实值 → 已配置，setup 必须上锁
        std::fs::write(&env_path, "DATABASE_URL=postgres://m:p@db:5432/m\n").unwrap();
        assert!(configured_with_env(&env_path, None));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn process_env_database_url_alone_marks_configured() {
        // compose 直接把 DATABASE_URL 注进环境、磁盘上没有 .env 的部署形态
        let missing = Path::new("/nonexistent/myriad/.env");
        assert!(configured_with_env(
            missing,
            Some("postgres://m:p@db:5432/m")
        ));
        assert!(!configured_with_env(missing, Some("")));
        assert!(!configured_with_env(
            missing,
            Some("postgres://u:your_password@h/d")
        ));
        assert!(!configured_with_env(missing, None));
    }

    #[test]
    fn env_value_validation_blocks_crlf_injection() {
        // 这正是 update-env 曾经允许的注入：值里塞换行 → 多出一整行环境变量
        assert!(validate_env_value("JWT_SECRET", "abc\nADMIN_OVERRIDE=1").is_err());
        assert!(validate_env_value("JWT_SECRET", "abc\r\nADMIN_OVERRIDE=1").is_err());
        assert!(validate_env_value("JWT_SECRET", "abc\rdef").is_err());
        assert!(validate_env_value("JWT_SECRET", "abc\0def").is_err());
        assert!(validate_env_value("JWT_SECRET", "a-perfectly-normal-secret").is_ok());
        // 值里带 `=` 是合法的（base64/连接串常见）
        assert!(validate_env_value("DATABASE_URL", "postgres://a:b==@h/d").is_ok());
    }

    #[test]
    fn generated_tokens_are_long_and_unique() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
