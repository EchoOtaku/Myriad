//! Lane Queue 请求队列
//!
//! 每个用户会话一个 Lane（串行锁），全局并发上限。
//! 防止同一用户的并发请求竞态条件，控制系统整体负载。

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, OwnedMutexGuard, OwnedSemaphorePermit, RwLock, Semaphore};

/// Lane Queue 全局管理器
///
/// 核心并发控制：
/// - 每个 lane（用户/会话）一个 Mutex，保证串行执行
/// - 全局 Semaphore 限制最大并发数
///
/// 使用方式：
/// ```ignore
/// let guard = queue.acquire("user:1").await?;
/// let result = agent.process(request).await;
/// drop(guard); // 释放锁，下一个请求可以执行
/// ```
pub struct LaneQueue {
    /// lane_key -> 串行锁
    lanes: RwLock<HashMap<String, Arc<Mutex<()>>>>,
    /// 全局并发上限
    global_semaphore: Arc<Semaphore>,
    /// 最大并发数（用于状态查询）
    max_concurrent: usize,
}

impl LaneQueue {
    /// 创建新的 LaneQueue
    ///
    /// `max_concurrent`: 全局最大并发执行数（推荐 4）
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            lanes: RwLock::new(HashMap::new()),
            global_semaphore: Arc::new(Semaphore::new(max_concurrent)),
            max_concurrent,
        }
    }

    /// 生成 lane key
    ///
    /// 同一用户的请求串行执行；不同用户可并行（受全局上限约束）。
    pub fn make_lane_key(user_id: i32, session_id: Option<&str>) -> String {
        match session_id {
            Some(sid) => format!("user:{}:session:{}", user_id, sid),
            None => format!("user:{}", user_id),
        }
    }

    /// 获取或创建 lane 的串行锁
    async fn get_or_create_lane(&self, lane_key: &str) -> Arc<Mutex<()>> {
        // 快路径：读锁检查
        {
            let lanes = self.lanes.read().await;
            if let Some(mutex) = lanes.get(lane_key) {
                return mutex.clone();
            }
        }
        // 慢路径：写锁创建
        let mut lanes = self.lanes.write().await;
        lanes
            .entry(lane_key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// 获取执行许可
    ///
    /// 1. 获取 lane 内串行锁（同一用户的请求排队等待）
    /// 2. 获取全局并发许可（控制系统整体负载）
    ///
    /// 返回的 `LaneGuard` drop 时自动释放两把锁。
    pub async fn acquire(&self, lane_key: &str) -> Result<LaneGuard, String> {
        let lane_mutex = self.get_or_create_lane(lane_key).await;

        // 先获取 lane 串行锁（同用户排队）
        let lane_lock = lane_mutex.lock_owned().await;

        tracing::debug!(
            lane = %lane_key,
            "[LaneQueue] Lane lock acquired, waiting for global permit"
        );

        // 再获取全局并发许可
        let permit = self
            .global_semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| "系统正在关闭".to_string())?;

        tracing::debug!(
            lane = %lane_key,
            available = self.global_semaphore.available_permits(),
            "[LaneQueue] Execution slot acquired"
        );

        Ok(LaneGuard {
            _lane_lock: lane_lock,
            _permit: permit,
            lane_key: lane_key.to_string(),
        })
    }

    /// 获取队列状态
    pub async fn get_status(&self) -> QueueStatus {
        let lanes = self.lanes.read().await;
        QueueStatus {
            total_lanes: lanes.len(),
            max_concurrent: self.max_concurrent,
            available_permits: self.global_semaphore.available_permits(),
        }
    }

    /// 清理空闲 Lane（定期调用，防止 HashMap 无限增长）
    #[allow(dead_code)]
    pub async fn cleanup_idle_lanes(&self) {
        let mut lanes = self.lanes.write().await;
        lanes.retain(|_, mutex| {
            // 如果锁没被持有，说明 lane 空闲，可以清理
            mutex.try_lock().is_ok()
        });
    }
}

/// Lane 执行守卫
///
/// 持有 lane 串行锁 + 全局并发许可。
/// Drop 时自动释放，允许下一个请求执行。
pub struct LaneGuard {
    _lane_lock: OwnedMutexGuard<()>,
    _permit: OwnedSemaphorePermit,
    /// Lane key（用于日志）
    pub lane_key: String,
}

impl Drop for LaneGuard {
    fn drop(&mut self) {
        tracing::debug!(
            lane = %self.lane_key,
            "[LaneQueue] Execution slot released"
        );
    }
}

/// 队列状态
#[derive(Debug, Clone, serde::Serialize)]
pub struct QueueStatus {
    pub total_lanes: usize,
    pub max_concurrent: usize,
    pub available_permits: usize,
}
