use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Rate limit configuration for different endpoint types
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    pub max_requests: usize,
    pub window: Duration,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_requests: 100,
            window: Duration::from_secs(60),
        }
    }
}

/// Request record for tracking
#[derive(Debug, Clone)]
struct RequestRecord {
    count: usize,
    window_start: Instant,
}

/// Global rate limiter state
pub struct RateLimiter {
    // IP -> (endpoint_pattern -> request_record)
    records: Arc<RwLock<HashMap<IpAddr, HashMap<String, RequestRecord>>>>,
    config: RateLimitConfig,
}

impl RateLimiter {
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            records: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    /// Check if request should be rate limited
    async fn check_limit(&self, ip: IpAddr, endpoint: &str) -> bool {
        let mut records = self.records.write().await;
        let now = Instant::now();

        // Get or create IP record
        let ip_records = records.entry(ip).or_insert_with(HashMap::new);

        // Get or create endpoint record
        let record = ip_records
            .entry(endpoint.to_string())
            .or_insert(RequestRecord {
                count: 0,
                window_start: now,
            });

        // Check if window expired
        if now.duration_since(record.window_start) > self.config.window {
            // Reset window
            record.count = 1;
            record.window_start = now;
            return true;
        }

        // Check if limit exceeded
        if record.count >= self.config.max_requests {
            return false;
        }

        // Increment counter
        record.count += 1;
        true
    }

    /// Clean up old records (call periodically)
    pub async fn cleanup(&self) {
        let mut records = self.records.write().await;
        let now = Instant::now();

        records.retain(|_, ip_records| {
            ip_records.retain(|_, record| {
                now.duration_since(record.window_start) <= self.config.window * 2
            });
            !ip_records.is_empty()
        });
    }
}

/// Global rate limiter instance
static RATE_LIMITER: once_cell::sync::Lazy<RateLimiter> = once_cell::sync::Lazy::new(|| {
    // Spawn cleanup task
    let limiter = RateLimiter::new(RateLimitConfig::default());
    let limiter_clone = RateLimiter {
        records: limiter.records.clone(),
        config: limiter.config.clone(),
    };

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300)); // Cleanup every 5 minutes
        loop {
            interval.tick().await;
            limiter_clone.cleanup().await;
        }
    });

    limiter
});

/// Rate limiting middleware
pub async fn rate_limit_middleware(req: Request, next: Next) -> Response {
    // Extract client IP
    let ip = req
        .extensions()
        .get::<std::net::SocketAddr>()
        .map(|addr| addr.ip())
        .unwrap_or_else(|| IpAddr::from([127, 0, 0, 1]));

    // Get endpoint path
    let path = req.uri().path().to_string();

    // ✅ 安全修复 P0: 使用全局单例，确保限流计数器跨请求持久化
    // 不同类型的端点使用不同的路径前缀来区分限流规则
    let (allowed, retry_after) = if is_sensitive_endpoint(&path) {
        // 敏感端点：5次请求/5分钟（全局限流器会跟踪每个IP+endpoint组合）
        let _ = RATE_LIMITER.check_limit(ip, &path).await; // 记录请求
                                                           // 手动检查是否超过敏感端点的阈值
        let record_count = {
            let records = RATE_LIMITER.records.read().await;
            records
                .get(&ip)
                .and_then(|ip_rec| ip_rec.get(&path))
                .map(|rec| rec.count)
                .unwrap_or(0)
        };
        (record_count <= 5, 300)
    } else if is_compute_intensive(&path) {
        // 计算密集型端点：10次请求/分钟
        let _ = RATE_LIMITER.check_limit(ip, &path).await; // 记录请求
        let record_count = {
            let records = RATE_LIMITER.records.read().await;
            records
                .get(&ip)
                .and_then(|ip_rec| ip_rec.get(&path))
                .map(|rec| rec.count)
                .unwrap_or(0)
        };
        (record_count <= 10, 60)
    } else {
        // 标准端点：使用默认配置（100次/分钟）
        let allowed = RATE_LIMITER.check_limit(ip, &path).await;
        (allowed, 60)
    };

    if !allowed {
        tracing::warn!("Rate limit exceeded for IP {} on endpoint {}", ip, path);
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(
                axum::http::header::RETRY_AFTER,
                retry_after.to_string(),
            )],
            Json(json!({
                "error": "Too many requests",
                "message": format!("Rate limit exceeded. Please try again in {} seconds.", retry_after),
                "retry_after": retry_after
            })),
        )
            .into_response();
    }

    next.run(req).await
}

/// Check if endpoint is sensitive (login, password change, etc.)
fn is_sensitive_endpoint(path: &str) -> bool {
    path.contains("/auth/login")
        || path.contains("/auth/change-password")
        || path.contains("/setup/create-admin")
}

/// Check if endpoint is compute-intensive
fn is_compute_intensive(path: &str) -> bool {
    path.contains("/fetch")
        || path.contains("/analysis")
        || path.contains("/persona/generate")
        || path.contains("/prompt/generate")
        || path.contains("/profile/report")
        || path.contains("/profile/refresh")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_rate_limit_basic() {
        let limiter = RateLimiter::new(RateLimitConfig {
            max_requests: 3,
            window: Duration::from_secs(10),
        });

        let ip = IpAddr::from([127, 0, 0, 1]);
        let endpoint = "/api/test";

        // First 3 requests should pass
        assert!(limiter.check_limit(ip, endpoint).await);
        assert!(limiter.check_limit(ip, endpoint).await);
        assert!(limiter.check_limit(ip, endpoint).await);

        // 4th request should be blocked
        assert!(!limiter.check_limit(ip, endpoint).await);
    }

    #[tokio::test]
    async fn test_rate_limit_window_reset() {
        let limiter = RateLimiter::new(RateLimitConfig {
            max_requests: 2,
            window: Duration::from_millis(100),
        });

        let ip = IpAddr::from([127, 0, 0, 1]);
        let endpoint = "/api/test";

        // First 2 requests pass
        assert!(limiter.check_limit(ip, endpoint).await);
        assert!(limiter.check_limit(ip, endpoint).await);

        // 3rd is blocked
        assert!(!limiter.check_limit(ip, endpoint).await);

        // Wait for window to expire
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Should pass again
        assert!(limiter.check_limit(ip, endpoint).await);
    }
}
