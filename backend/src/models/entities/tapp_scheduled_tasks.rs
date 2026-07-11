//! Tapp 定时任务实体定义

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 调度类型
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(20))")]
#[derive(Default)]
pub enum ScheduleType {
    #[sea_orm(string_value = "cron")]
    Cron,
    #[sea_orm(string_value = "interval")]
    #[default]
    Interval,
    #[sea_orm(string_value = "once")]
    Once,
    #[sea_orm(string_value = "daily")]
    Daily,
}

/// 执行目标
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(20))")]
#[derive(Default)]
pub enum ExecutionTarget {
    #[sea_orm(string_value = "backend")]
    Backend,
    #[sea_orm(string_value = "frontend")]
    #[default]
    Frontend,
    #[sea_orm(string_value = "both")]
    Both,
}

/// 错过执行策略
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(20))")]
#[derive(Default)]
pub enum MissedPolicy {
    #[sea_orm(string_value = "skip")]
    #[default]
    Skip,
    #[sea_orm(string_value = "run-once")]
    RunOnce,
    #[sea_orm(string_value = "run-all")]
    RunAll,
}

/// 任务作用域
/// 决定任务的执行范围和前端推送目标
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(20))")]
#[derive(Default)]
pub enum TaskScope {
    /// 用户级别：只影响注册该任务的用户
    /// 后端执行时使用该用户的权限，前端推送给该用户
    #[sea_orm(string_value = "user")]
    #[default]
    User,
    /// Tapp 级别（共享数据）：影响所有安装了该 Tapp 的用户
    /// 后端执行一次，结果共享给所有用户，前端推送给所有安装该 Tapp 的用户
    #[sea_orm(string_value = "tapp")]
    Tapp,
    /// Tapp 级别（个性化数据）：为每个安装了该 Tapp 的用户分别执行
    /// 后端为每个用户单独执行（可访问用户上下文如 IP），前端推送给对应用户
    /// 适用场景：天气（基于用户 IP）、个性化推荐等
    #[sea_orm(string_value = "tapp-per-user")]
    TappPerUser,
    /// 全局级别：系统任务，不关联特定用户
    /// 后端执行，不需要前端推送（或推送给管理员）
    #[sea_orm(string_value = "global")]
    Global,
}

/// 定时任务实体
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "tapp_scheduled_tasks")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,

    /// 任务 ID（Tapp 内唯一）
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub task_id: String,

    /// 所属 Tapp ID
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub tapp_id: String,

    /// 所属用户 ID
    pub user_id: i32,

    /// 任务名称
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub name: String,

    /// 调度类型
    pub schedule_type: ScheduleType,

    /// 调度配置 (JSON)
    /// { cron?: string, interval?: number, at?: number, time?: string }
    #[sea_orm(column_type = "Json")]
    pub schedule_config: serde_json::Value,

    /// 任务负载 (JSON)
    #[sea_orm(column_type = "Json", nullable)]
    pub payload: Option<serde_json::Value>,

    /// 执行目标
    pub execution_target: ExecutionTarget,

    /// 后端可执行的操作列表 (JSON)
    #[sea_orm(column_type = "Json", nullable)]
    pub backend_actions: Option<serde_json::Value>,

    /// 是否启用
    pub enabled: bool,

    /// 错过执行策略
    pub missed_policy: MissedPolicy,

    /// 任务作用域
    #[sea_orm(default_value = "user")]
    pub scope: TaskScope,

    /// 重试配置 (JSON)
    #[sea_orm(column_type = "Json", nullable)]
    pub retry_config: Option<serde_json::Value>,

    /// 下次执行时间
    #[sea_orm(nullable)]
    pub next_run_at: Option<DateTimeWithTimeZone>,

    /// 上次执行时间
    #[sea_orm(nullable)]
    pub last_run_at: Option<DateTimeWithTimeZone>,

    /// 上次执行结果 (JSON)
    #[sea_orm(column_type = "Json", nullable)]
    pub last_run_result: Option<serde_json::Value>,

    /// 执行统计 (JSON)
    #[sea_orm(column_type = "Json")]
    pub stats: serde_json::Value,

    /// 创建时间
    pub created_at: DateTimeWithTimeZone,

    /// 更新时间
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::tapp_task_executions::Entity")]
    TaskExecutions,
}

impl Related<super::tapp_task_executions::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TaskExecutions.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

/// 调度配置结构
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScheduleConfig {
    /// cron 表达式（type=cron 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,
    /// 间隔毫秒（type=interval 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval: Option<i64>,
    /// 执行时间戳（type=once 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<i64>,
    /// 每日时间 HH:mm（type=daily 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
}

/// 重试配置结构
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RetryConfig {
    /// 最大重试次数
    #[serde(default)]
    pub max_retries: i32,
    /// 重试延迟（毫秒）
    #[serde(default)]
    pub retry_delay: i64,
}

/// 执行统计结构
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TaskStats {
    #[serde(default, rename = "totalRuns")]
    pub total_runs: i64,
    #[serde(default, rename = "successRuns")]
    pub success_runs: i64,
    #[serde(default, rename = "failedRuns")]
    pub failed_runs: i64,
    #[serde(default, rename = "missedRuns")]
    pub missed_runs: i64,
}

/// 后端操作包装器（支持结果命名和条件执行）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackendActionWrapper {
    /// 操作类型和参数
    #[serde(flatten)]
    pub action: BackendAction,
    /// 将结果存储到指定变量名（可在后续操作中通过 {{varName}} 引用）
    #[serde(rename = "resultAs", skip_serializing_if = "Option::is_none")]
    pub result_as: Option<String>,
    /// 条件执行：只有当指定变量存在且为真时才执行
    #[serde(rename = "if", skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
}

/// 后端操作类型
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "action")]
pub enum BackendAction {
    /// 平台数据同步
    #[serde(rename = "platform.sync")]
    PlatformSync { platform: String },
    /// 存储设置
    #[serde(rename = "storage.set")]
    StorageSet {
        key: String,
        value: serde_json::Value,
    },
    /// 存储删除
    #[serde(rename = "storage.delete")]
    StorageDelete { key: String },
    /// AI 生成
    #[serde(rename = "ai.generate")]
    AiGenerate { prompt: String },
    /// HTTP 请求
    #[serde(rename = "fetch")]
    Fetch {
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        method: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        headers: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        body: Option<serde_json::Value>,
    },
    /// 发送通知（进入用户的持久通知中心）
    #[serde(rename = "notification.queue")]
    NotificationQueue {
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        message: String,
        #[serde(rename = "notificationType", skip_serializing_if = "Option::is_none")]
        notification_type: Option<String>,
    },
    /// 存储读取
    #[serde(rename = "storage.get")]
    StorageGet { key: String },
    /// 数据转换/处理
    #[serde(rename = "transform")]
    Transform {
        /// 输入变量名
        input: String,
        /// JSONPath 表达式提取数据
        #[serde(skip_serializing_if = "Option::is_none")]
        extract: Option<String>,
        /// 模板字符串
        #[serde(skip_serializing_if = "Option::is_none")]
        template: Option<String>,
    },
}
