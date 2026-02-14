//! Agent 类型定义
//!
//! 定义 AI Agent 系统的核心类型结构

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// ============ 意图分析相关类型 ============

/// 用户原始请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRequest {
    /// 原始自然语言输入
    pub raw_input: String,
    /// 请求时间
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// 用户 ID
    pub user_id: i32,
    /// 可选的上下文数据
    pub context: Option<RequestContext>,
}

/// 请求上下文
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RequestContext {
    /// 当前页面/路由
    pub current_route: Option<String>,
    /// 最近活动的平台
    pub active_platforms: Vec<String>,
    /// 用户偏好
    pub preferences: Option<Value>,
    /// 会话 ID（用于多轮对话）
    pub session_id: Option<String>,
    /// 对话历史（用于继续对话模式）
    pub conversation_history: Option<Vec<ConversationMessage>>,
    /// 自定义数据（如当前阅读的文章内容）
    pub custom_data: Option<Value>,
}

/// 对话消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    /// 角色: user, assistant, system
    pub role: String,
    /// 消息内容
    pub content: String,
    /// 创建时间
    #[serde(default)]
    pub created_at: Option<String>,
}

/// 解析后的意图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedIntent {
    /// 意图 ID
    pub id: String,
    /// 主要动作
    pub action: IntentAction,
    /// 操作对象
    pub target: IntentTarget,
    /// 约束条件
    pub constraints: IntentConstraints,
    /// 置信度 (0.0 - 1.0)
    pub confidence: f32,
    /// 需要澄清的点
    pub clarifications_needed: Vec<ClarificationPoint>,
    /// 子意图（复杂任务拆解）
    pub sub_intents: Vec<ParsedIntent>,
    /// AI 建议使用的能力列表
    #[serde(default)]
    pub suggested_capabilities: Vec<String>,
    /// 不支持的原因（如果请求无法执行）
    #[serde(default)]
    pub unsupported_reason: Option<String>,
}

/// 意图动作类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum IntentAction {
    /// 查询类动作
    Query,
    /// 汇总/总结
    Summarize,
    /// 分析
    Analyze,
    /// 监控/追踪
    Monitor,
    /// 创建/生成
    Create,
    /// 更新/修改
    Update,
    /// 删除
    Delete,
    /// 比较
    Compare,
    /// 推荐
    Recommend,
    /// 导出
    Export,
    /// 执行/运行
    Execute,
    /// 导航/打开
    Navigate,
    /// 控制（如媒体播放器控制）
    Control,
    /// 未知动作
    Unknown(String),
}

impl IntentAction {
    pub fn from_verb(verb: &str) -> Self {
        match verb.to_lowercase().as_str() {
            "查" | "看" | "获取" | "读取" | "显示" | "列出" | "query" | "get" | "show" | "list" => {
                Self::Query
            }
            "总结" | "汇总" | "概括" | "summarize" | "summary" => Self::Summarize,
            "分析" | "统计" | "计算" | "analyze" | "analyse" => Self::Analyze,
            "监控" | "追踪" | "跟踪" | "观察" | "monitor" | "track" | "watch" => {
                Self::Monitor
            }
            "创建" | "生成" | "新建" | "制作" | "写" | "create" | "generate" | "make" | "write" => {
                Self::Create
            }
            "更新" | "修改" | "编辑" | "改" | "update" | "edit" | "modify" => Self::Update,
            "删除" | "移除" | "清除" | "delete" | "remove" | "clear" => Self::Delete,
            "比较" | "对比" | "compare" => Self::Compare,
            "推荐" | "建议" | "suggest" | "recommend" => Self::Recommend,
            "导出" | "下载" | "export" | "download" => Self::Export,
            "打开" | "跳转" | "前往" | "去" | "进入" | "访问" | "open" | "navigate" | "goto"
            | "go" => Self::Navigate,
            "播放" | "暂停" | "停止" | "继续" | "下一首" | "上一首" | "调节" | "静音" | "play"
            | "pause" | "stop" | "resume" | "next" | "previous" | "mute" | "control" => {
                Self::Control
            }
            _ => Self::Unknown(verb.to_string()),
        }
    }
}

impl ParsedIntent {
    /// 检查是否需要 AI 处理
    #[allow(dead_code)]
    pub fn requires_ai_processing(&self) -> bool {
        matches!(
            self.action,
            IntentAction::Summarize
                | IntentAction::Analyze
                | IntentAction::Recommend
                | IntentAction::Compare
        )
    }
}

/// 意图目标类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum IntentTarget {
    /// 平台数据 (bilibili, steam, github 等)
    Platform(String),
    /// 报告
    Report(Option<String>),
    /// Tapp 应用
    Tapp(Option<String>),
    /// Brew 内容
    Brew(Option<String>),
    /// 音乐播放器
    Music(Option<String>),
    /// 用户资料
    Profile,
    /// 通用数据
    Data(String),
    /// 事件
    Event(String),
    /// 当前页面（根据 current_route 确定）
    CurrentPage(String),
    /// 未指定
    Unspecified,
}

/// 意图约束条件
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntentConstraints {
    /// 时间范围
    pub time_range: Option<TimeRange>,
    /// 数量限制
    pub limit: Option<u32>,
    /// 筛选条件
    pub filters: HashMap<String, Value>,
    /// 排序方式
    pub sort: Option<SortSpec>,
    /// 输出格式
    pub output_format: Option<OutputFormat>,
}

/// 时间范围
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRange {
    /// 开始时间
    pub start: Option<chrono::DateTime<chrono::Utc>>,
    /// 结束时间
    pub end: Option<chrono::DateTime<chrono::Utc>>,
    /// 相对时间描述 (如 "最近一周")
    pub relative: Option<String>,
}

/// 排序规格
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortSpec {
    pub field: String,
    pub order: SortOrder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    Asc,
    Desc,
}

/// 输出格式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Text,
    Json,
    Markdown,
    Html,
    Chart,
}

/// 需要澄清的点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClarificationPoint {
    /// 问题 ID
    pub id: String,
    /// 澄清类型
    pub clarification_type: ClarificationType,
    /// 问题描述
    pub question: String,
    /// 可能的选项
    pub options: Vec<String>,
    /// 默认值
    pub default: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClarificationType {
    /// 时间范围不明确
    TimeRange,
    /// 目标不明确
    Target,
    /// 动作不明确
    Action,
    /// 参数缺失
    MissingParameter,
    /// 歧义
    Ambiguity,
}

// ============ 能力注册相关类型 ============

/// 系统能力定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability {
    /// 能力 ID
    pub id: String,
    /// 能力名称
    pub name: String,
    /// 能力描述
    pub description: String,
    /// 能力类别
    pub category: CapabilityCategory,
    /// 支持的动作列表
    pub supported_actions: Vec<IntentAction>,
    /// 输入参数规格
    pub input_schema: Value,
    /// 输出格式规格
    pub output_schema: Value,
    /// 所需权限
    pub required_permissions: Vec<String>,
    /// 是否需要 AI
    pub requires_ai: bool,
    /// 估计执行时间（毫秒）
    pub estimated_duration_ms: Option<u64>,
    /// 是否需要二次确认（敏感操作）
    #[serde(default)]
    pub requires_confirmation: bool,
    /// 确认提示信息
    #[serde(default)]
    pub confirmation_message: Option<String>,
    /// 风险等级
    #[serde(default)]
    pub risk_level: RiskLevel,
}

/// 风险等级
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    /// 无风险
    #[default]
    None,
    /// 低风险 - 可逆操作
    Low,
    /// 中风险 - 可能影响数据
    Medium,
    /// 高风险 - 不可逆操作
    High,
    /// 危险 - 系统级敏感操作
    Critical,
}

/// 能力类别
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityCategory {
    /// 数据读取
    DataRead,
    /// 数据写入
    DataWrite,
    /// AI 处理
    AiProcess,
    /// 资源创建
    ResourceCreate,
    /// 系统操作
    SystemOp,
    /// 外部集成
    ExternalIntegration,
    /// UI 控制/交互
    UiControl,
}

// ============ 方案（Recipe）相关类型 ============

/// 执行方案
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recipe {
    /// 方案 ID
    pub id: String,
    /// 方案名称
    pub name: String,
    /// 原始请求
    pub original_request: String,
    /// 执行类型
    pub execution_type: ExecutionType,
    /// 执行步骤
    pub steps: Vec<RecipeStep>,
    /// 预期输出格式
    pub expected_output: OutputFormat,
    /// 估计总时长（毫秒）
    pub estimated_duration_ms: u64,
    /// 创建时间
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// 元数据
    pub metadata: HashMap<String, Value>,
    /// 页面上下文（当前阅读的文章等）
    #[serde(default)]
    pub page_context: Option<Value>,
    /// 对话历史上下文（用于继续对话模式）
    #[serde(default)]
    pub conversation_context: Option<Vec<ConversationMessage>>,
}

/// 执行类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionType {
    /// 即时查询 - 执行后立即返回结果
    Instant,
    /// 持续监控 - 设置后持续执行
    Continuous,
    /// 资源创建 - 创建新的资源/内容
    Creation,
    /// 批处理 - 批量处理数据
    Batch,
}

/// 方案步骤
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecipeStep {
    /// 步骤 ID
    pub id: String,
    /// 步骤序号
    pub order: u32,
    /// 使用的能力 ID
    pub capability_id: String,
    /// 动作
    pub action: String,
    /// 输入参数
    pub params: HashMap<String, Value>,
    /// 依赖的步骤 ID 列表
    pub depends_on: Vec<String>,
    /// 失败处理策略
    pub on_failure: FailureStrategy,
    /// 重试配置
    pub retry: Option<RetryConfig>,
    /// 超时时间（毫秒）
    pub timeout_ms: Option<u64>,
}

/// 失败处理策略
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FailureStrategy {
    /// 终止整个方案
    Abort,
    /// 跳过并继续
    Skip,
    /// 使用默认值继续
    UseDefault(Value),
    /// 回退到备用能力
    Fallback(String),
}

/// 重试配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    /// 最大重试次数
    pub max_attempts: u32,
    /// 重试间隔（毫秒）
    pub delay_ms: u64,
    /// 指数退避
    pub exponential_backoff: bool,
}

// ============ 执行状态相关类型 ============

/// 任务执行状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskState {
    /// 任务 ID
    pub task_id: String,
    /// 方案 ID
    pub recipe_id: String,
    /// 当前状态
    pub status: TaskStatus,
    /// 当前步骤索引
    pub current_step: usize,
    /// 步骤执行结果
    pub step_results: HashMap<String, StepResult>,
    /// 开始时间
    pub started_at: chrono::DateTime<chrono::Utc>,
    /// 完成时间
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// 错误信息
    pub error: Option<String>,
    /// 进度百分比 (0-100)
    pub progress: u8,
    /// 待用户回答的问题（当状态为 WaitingForInput 时）
    #[serde(default)]
    pub pending_question: Option<UserQuestion>,
    /// 执行上下文（用于恢复执行）
    /// 注意：此字段现在会被序列化以支持任务持久化和动态步骤恢复
    #[serde(default)]
    pub execution_context: Option<ExecutionContext>,
}

/// 用户问题 - Agent 向用户提出的澄清问题
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserQuestion {
    /// 问题 ID
    pub question_id: String,
    /// 问题类型
    pub question_type: QuestionType,
    /// 问题文本
    pub question: String,
    /// 问题上下文（为什么要问这个问题）
    pub context: String,
    /// 可选项（用于选择类问题）
    pub options: Option<Vec<QuestionOption>>,
    /// 是否必须回答
    pub required: bool,
    /// 默认值
    pub default_value: Option<String>,
    /// 创建时间
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// 过期时间
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// 问题类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum QuestionType {
    /// 自由文本输入
    FreeText,
    /// 单选
    SingleChoice,
    /// 多选
    MultipleChoice,
    /// 是/否确认
    Confirmation,
    /// 数值输入
    Numeric,
    /// 日期选择
    Date,
}

/// 问题选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionOption {
    /// 选项值
    pub value: String,
    /// 显示文本
    pub label: String,
    /// 选项描述
    pub description: Option<String>,
}

/// 用户回答
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct UserAnswer {
    /// 问题 ID
    pub question_id: String,
    /// 任务 ID
    pub task_id: String,
    /// 回答内容
    pub answer: String,
    /// 是否跳过（用户选择不回答）
    pub skipped: bool,
}

/// 任务状态枚举
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// 等待执行
    Pending,
    /// 执行中
    Running,
    /// 等待用户输入
    WaitingForInput,
    /// 已暂停
    Paused,
    /// 已完成
    Completed,
    /// 失败
    Failed,
    /// 已取消
    Cancelled,
}

/// 步骤执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    /// 步骤 ID
    pub step_id: String,
    /// 是否成功
    pub success: bool,
    /// 输出数据
    pub output: Option<Value>,
    /// 错误信息
    pub error: Option<String>,
    /// 执行时长（毫秒）
    pub duration_ms: u64,
    /// 重试次数
    pub retry_count: u32,
}

// ============ 监控任务相关类型 ============

/// 监控任务配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorConfig {
    /// 监控 ID
    pub id: String,
    /// 检查间隔（秒）
    pub interval_secs: u64,
    /// 触发条件
    pub trigger_conditions: Vec<TriggerCondition>,
    /// 通知方式
    pub notify_methods: Vec<NotifyMethod>,
    /// 有效期
    pub valid_until: Option<chrono::DateTime<chrono::Utc>>,
    /// 是否启用
    pub enabled: bool,
}

/// 触发条件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCondition {
    /// 条件类型
    pub condition_type: ConditionType,
    /// 目标字段
    pub field: String,
    /// 比较操作符
    pub operator: String,
    /// 阈值
    pub threshold: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConditionType {
    /// 数值变化
    ValueChange,
    /// 新增项目
    NewItem,
    /// 阈值突破
    ThresholdBreak,
    /// 关键词匹配
    KeywordMatch,
    /// 时间触发
    TimeTrigger,
}

/// 通知方式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotifyMethod {
    /// 系统通知
    SystemNotification,
    /// Toast 消息
    Toast,
    /// 生成报告
    Report,
    /// 触发 Tapp
    TriggerTapp(String),
}

// ============ Agent 响应类型 ============

/// Agent 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    /// 响应类型
    pub response_type: AgentResponseType,
    /// 消息内容
    pub message: String,
    /// 结果数据
    pub data: Option<Value>,
    /// 数据展示类型提示（帮助前端选择合适的渲染方式）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_display: Option<DataDisplayHint>,
    /// 后续建议
    pub suggestions: Vec<String>,
    /// 任务状态（如果有后台任务）
    pub task: Option<TaskState>,
    /// 确认请求信息（当 response_type 为 ConfirmationRequired 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation: Option<ConfirmationRequest>,
    /// 前端操作指令（路由导航、页面元素交互等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontend_action: Option<FrontendAction>,
}

/// 前端操作指令
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendAction {
    /// 操作类型
    #[serde(rename = "type")]
    pub action_type: String,
    /// 目标元素（页面交互用）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<PageElementTarget>,
    /// Tapp ID（Tapp 操作用）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tapp_id: Option<String>,
    /// 窗口 ID（窗口操作用）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_id: Option<String>,
    /// 脚本内容
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    /// 时间戳
    #[serde(default)]
    pub timestamp: i64,
    /// 操作数据
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    /// 导航路径
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// 路由参数
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    /// 查询参数
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<Value>,
    /// 完整路径
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_path: Option<String>,
    /// 是否替换历史记录
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replace: Option<bool>,
    /// 交互动作类型
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// 滚动选项
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll_options: Option<ScrollOptions>,
    /// 等待条件
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait_for: Option<WaitCondition>,
    /// 载荷数据 (用于 reading_list 等需要传递复杂数据的动作)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    /// 筛选条件描述 (用于 reading_list)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub criteria: Option<String>,
}

/// 页面元素目标
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageElementTarget {
    /// CSS 选择器
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    /// data-testid
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_id: Option<String>,
    /// 文本内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// aria-label
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aria_label: Option<String>,
    /// role 属性
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// 索引
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<i32>,
}

/// 滚动选项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollOptions {
    /// 方向
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    /// 偏移量
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i32>,
    /// 是否平滑滚动
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smooth: Option<bool>,
}

/// 等待条件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitCondition {
    /// 是否等待可见
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    /// 超时时间（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<i64>,
}

/// 数据展示类型提示
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataDisplayHint {
    /// 表格展示
    Table {
        /// 列定义
        columns: Vec<ColumnDef>,
        /// 数据路径（JSON path 到数组数据）
        #[serde(default)]
        data_path: Option<String>,
    },
    /// 图表展示
    Chart {
        /// 图表类型
        chart_type: ChartType,
        /// X 轴字段
        x_field: String,
        /// Y 轴字段
        y_field: String,
    },
    /// 卡片列表
    CardList {
        /// 标题字段
        title_field: String,
        /// 描述字段
        description_field: Option<String>,
        /// 图片字段
        image_field: Option<String>,
    },
    /// Markdown 富文本
    Markdown,
    /// 键值对展示
    KeyValue,
    /// 时间线
    Timeline {
        /// 时间字段
        time_field: String,
        /// 内容字段
        content_field: String,
    },
    /// 原始 JSON
    Raw,
}

/// 表格列定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    /// 字段名
    pub field: String,
    /// 显示标题
    pub title: String,
    /// 列宽
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// 是否可排序
    #[serde(default)]
    pub sortable: bool,
}

/// 图表类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChartType {
    Line,
    Bar,
    Pie,
    Area,
}

/// Agent 响应类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentResponseType {
    /// 直接回答
    Answer,
    /// 需要澄清
    Clarification,
    /// 需要确认（敏感操作）
    ConfirmationRequired,
    /// 任务已创建
    TaskCreated,
    /// 任务进度更新
    TaskProgress,
    /// 任务完成
    TaskCompleted,
    /// 错误
    Error,
}

/// 确认请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmationRequest {
    /// 确认 ID（用于后续确认/取消）
    pub confirmation_id: String,
    /// 待确认的配方 ID
    pub recipe_id: String,
    /// 需要确认的步骤
    pub pending_steps: Vec<PendingConfirmation>,
    /// 过期时间
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

/// 待确认的步骤
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingConfirmation {
    /// 步骤 ID
    pub step_id: String,
    /// 能力 ID
    pub capability_id: String,
    /// 能力名称
    pub capability_name: String,
    /// 操作描述
    pub description: String,
    /// 风险等级
    pub risk_level: RiskLevel,
    /// 确认提示
    pub confirmation_message: String,
    /// 操作影响说明
    pub impact: Vec<String>,
}

/// 用户确认响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct UserConfirmation {
    /// 确认 ID
    pub confirmation_id: String,
    /// 是否确认执行
    pub confirmed: bool,
    /// 用户备注（可选）
    pub user_note: Option<String>,
}

// ============ 辅助 trait ============

impl Default for ParsedIntent {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            action: IntentAction::Query,
            target: IntentTarget::Unspecified,
            constraints: IntentConstraints::default(),
            confidence: 0.0,
            clarifications_needed: Vec::new(),
            sub_intents: Vec::new(),
            suggested_capabilities: Vec::new(),
            unsupported_reason: None,
        }
    }
}

impl Capability {
    /// 创建基础能力（不需要确认）
    #[allow(dead_code)]
    pub fn new(id: &str, name: &str, description: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            category: CapabilityCategory::DataRead,
            supported_actions: vec![],
            input_schema: serde_json::json!({}),
            output_schema: serde_json::json!({}),
            required_permissions: vec![],
            requires_ai: false,
            estimated_duration_ms: None,
            requires_confirmation: false,
            confirmation_message: None,
            risk_level: RiskLevel::None,
        }
    }

    /// 设置为需要确认的敏感操作
    #[allow(dead_code)]
    pub fn with_confirmation(mut self, message: &str, risk: RiskLevel) -> Self {
        self.requires_confirmation = true;
        self.confirmation_message = Some(message.to_string());
        self.risk_level = risk;
        self
    }

    /// 检查是否是敏感操作
    #[allow(dead_code)]
    pub fn is_sensitive(&self) -> bool {
        self.requires_confirmation || self.risk_level != RiskLevel::None
    }
}

impl Default for Capability {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            category: CapabilityCategory::DataRead,
            supported_actions: vec![],
            input_schema: serde_json::json!({}),
            output_schema: serde_json::json!({}),
            required_permissions: vec![],
            requires_ai: false,
            estimated_duration_ms: None,
            requires_confirmation: false,
            confirmation_message: None,
            risk_level: RiskLevel::None,
        }
    }
}

impl Recipe {
    pub fn new(name: &str, original_request: &str, execution_type: ExecutionType) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            original_request: original_request.to_string(),
            execution_type,
            steps: Vec::new(),
            expected_output: OutputFormat::Text,
            estimated_duration_ms: 0,
            created_at: chrono::Utc::now(),
            metadata: HashMap::new(),
            page_context: None,
            conversation_context: None,
        }
    }

    /// 设置页面上下文（当前阅读的文章等）
    #[allow(dead_code)]
    pub fn with_page_context(mut self, context: Option<Value>) -> Self {
        self.page_context = context;
        self
    }

    /// 设置对话历史上下文（用于继续对话模式）
    #[allow(dead_code)]
    pub fn with_conversation_context(mut self, context: Option<Vec<ConversationMessage>>) -> Self {
        self.conversation_context = context;
        self
    }

    pub fn add_step(&mut self, step: RecipeStep) {
        self.steps.push(step);
        self.recalculate_duration();
    }

    fn recalculate_duration(&mut self) {
        self.estimated_duration_ms = self
            .steps
            .iter()
            .map(|s| s.timeout_ms.unwrap_or(5000))
            .sum();
    }
}

impl TaskState {
    pub fn new(recipe: &Recipe) -> Self {
        Self {
            task_id: uuid::Uuid::new_v4().to_string(),
            recipe_id: recipe.id.clone(),
            status: TaskStatus::Pending,
            current_step: 0,
            step_results: HashMap::new(),
            started_at: chrono::Utc::now(),
            completed_at: None,
            error: None,
            progress: 0,
            pending_question: None,
            execution_context: None,
        }
    }

    /// 设置待回答的问题，并将状态改为等待输入
    #[allow(dead_code)]
    pub fn set_pending_question(&mut self, question: UserQuestion) {
        self.pending_question = Some(question);
        self.status = TaskStatus::WaitingForInput;
    }

    /// 清除待回答问题，恢复执行状态
    #[allow(dead_code)]
    pub fn clear_pending_question(&mut self) {
        self.pending_question = None;
        self.status = TaskStatus::Running;
    }

    pub fn update_progress(&mut self, total_steps: usize) {
        if total_steps > 0 {
            self.progress = ((self.current_step as f32 / total_steps as f32) * 100.0) as u8;
        }
    }
}

// ============ 动态任务更新机制 ============

/// 动态步骤触发器 - 定义何时触发动态步骤生成
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DynamicTrigger {
    /// 步骤完成后触发
    AfterStep(String),
    /// 当输出匹配特定模式时触发
    OnOutputMatch { step_id: String, pattern: String },
    /// 当发现特定类型的数据时触发
    OnDataDiscovery {
        step_id: String,
        data_type: DiscoveredDataType,
    },
}

/// 发现的数据类型
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveredDataType {
    /// UI 元素（按钮、输入框等）
    UiElements,
    /// 可交互内容
    InteractiveContent,
    /// 需要进一步获取的数据
    PendingData,
    /// 错误需要处理
    ErrorToHandle,
    /// 用户需要确认
    NeedsConfirmation,
}

/// 动态步骤生成器配置
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicStepConfig {
    /// 触发条件
    pub trigger: DynamicTrigger,
    /// 生成器类型
    pub generator: StepGenerator,
    /// 最大生成步骤数
    pub max_steps: Option<usize>,
    /// 是否允许递归生成
    pub allow_recursive: bool,
}

/// 步骤生成器类型
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepGenerator {
    /// 基于 UI 分析结果生成交互步骤
    UiInteractionFromAnalysis {
        /// 源步骤 ID（tapp.ui 分析步骤）
        source_step: String,
        /// 要执行的操作描述
        operation_intent: String,
    },
    /// 基于列表数据生成迭代步骤
    IterateFromList {
        /// 源步骤 ID
        source_step: String,
        /// 每项要执行的能力
        item_capability: String,
    },
    /// 基于条件分支
    ConditionalBranch {
        /// 条件表达式
        condition: String,
        /// 满足条件时的步骤
        if_true: Vec<RecipeStep>,
        /// 不满足条件时的步骤
        if_false: Vec<RecipeStep>,
    },
    /// AI 智能生成（根据上下文让 AI 决定下一步）
    AiGenerated {
        /// AI 上下文提示
        context_prompt: String,
        /// 可选的能力范围限制
        capability_scope: Option<Vec<String>>,
    },
}

/// 执行上下文 - 在步骤间传递的动态上下文
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExecutionContext {
    /// 所有步骤的输出
    pub step_outputs: HashMap<String, Value>,
    /// 发现的 UI 元素
    pub discovered_ui_elements: Option<Value>,
    /// 当前交互目标
    pub interaction_target: Option<InteractionTarget>,
    /// 待执行的动态步骤队列
    pub pending_dynamic_steps: Vec<RecipeStep>,
    /// 已生成的动态步骤数量
    pub dynamic_steps_generated: usize,
    /// 执行变量（可被后续步骤引用）
    pub variables: HashMap<String, Value>,
    /// 原始用户请求（用于 AI 分析时参考）
    pub original_request: String,
    /// 用户意图描述
    pub user_intent: String,
    /// 不确定性列表（需要澄清的点）
    pub uncertainties: Vec<Uncertainty>,
    /// 已回答的问题
    pub answered_questions: HashMap<String, String>,
    /// 执行决策历史（用于追踪 AI 的决策过程）
    pub decision_history: Vec<ExecutionDecision>,
    /// 页面上下文（当前阅读的文章等）
    pub page_context: Option<Value>,
    /// 对话历史上下文（用于「继续对话」功能）
    /// 包含之前的对话消息，让 AI 能够理解上下文
    #[serde(default)]
    pub conversation_context: Option<Vec<ConversationMessage>>,
}

/// 不确定性 - 执行过程中发现的需要澄清的点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Uncertainty {
    /// 不确定性 ID
    pub id: String,
    /// 不确定性类型
    pub uncertainty_type: UncertaintyType,
    /// 描述
    pub description: String,
    /// 可能的选项
    pub possible_values: Vec<String>,
    /// 重要程度（影响后续执行的程度）
    pub importance: UncertaintyImportance,
    /// 发现时的步骤 ID
    pub discovered_at_step: Option<String>,
}

/// 不确定性类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UncertaintyType {
    /// 目标不明确（如"那个应用"具体是哪个）
    AmbiguousTarget,
    /// 操作不明确（如"处理一下"具体要怎么处理）
    AmbiguousAction,
    /// 参数不明确（如"最近的"是多久）
    AmbiguousParameter,
    /// 多个匹配项（找到多个可能的目标）
    MultipleMatches,
    /// 缺少必要信息
    MissingRequired,
    /// 结果需要确认
    NeedsConfirmation,
    /// 意外情况（执行结果与预期不符）
    UnexpectedResult,
}

/// 不确定性重要程度
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UncertaintyImportance {
    /// 关键 - 必须解决才能继续
    Critical,
    /// 重要 - 影响结果准确性
    Important,
    /// 次要 - 可以使用默认值
    Minor,
}

/// 执行决策 - 记录 AI 在执行过程中的决策
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionDecision {
    /// 决策时间
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// 决策类型
    pub decision_type: DecisionType,
    /// 决策描述
    pub description: String,
    /// 决策依据
    pub reasoning: String,
    /// 相关步骤 ID
    pub related_step: Option<String>,
}

/// 决策类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionType {
    /// 生成新步骤
    GenerateSteps,
    /// 跳过步骤
    SkipStep,
    /// 修改参数
    ModifyParams,
    /// 询问用户
    AskUser,
    /// 使用默认值
    UseDefault,
    /// 终止执行
    Abort,
    /// 重试
    Retry,
}

/// 交互目标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionTarget {
    /// 目标元素 ID
    pub element_id: String,
    /// 元素类型
    pub element_type: String,
    /// 要执行的操作
    pub operation: String,
    /// 操作参数
    pub params: Option<Value>,
}

/// 动态更新请求 - 用于在执行过程中请求更新任务
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicUpdateRequest {
    /// 任务 ID
    pub task_id: String,
    /// 更新类型
    pub update_type: UpdateType,
    /// 更新数据
    pub data: Value,
}

/// 更新类型
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateType {
    /// 追加新步骤
    AppendSteps(Vec<RecipeStep>),
    /// 插入步骤（在指定步骤后）
    InsertStepsAfter {
        after_step_id: String,
        steps: Vec<RecipeStep>,
    },
    /// 替换后续步骤
    ReplaceRemainingSteps(Vec<RecipeStep>),
    /// 终止执行
    Abort { reason: String },
    /// 暂停等待用户输入
    PauseForInput { prompt: String },
}

#[allow(dead_code)]
impl ExecutionContext {
    pub fn new() -> Self {
        Self::default()
    }

    /// 从用户请求创建上下文
    pub fn from_request(request: &str, intent: &str) -> Self {
        Self {
            original_request: request.to_string(),
            user_intent: intent.to_string(),
            ..Default::default()
        }
    }

    /// 从用户请求创建上下文（带页面上下文）
    pub fn from_request_with_page_context(
        request: &str,
        intent: &str,
        page_context: Option<Value>,
    ) -> Self {
        Self {
            original_request: request.to_string(),
            user_intent: intent.to_string(),
            page_context,
            ..Default::default()
        }
    }

    /// 从用户请求创建完整上下文（包含对话历史和页面上下文）
    pub fn from_request_full(
        request: &str,
        intent: &str,
        page_context: Option<Value>,
        conversation_context: Option<Vec<ConversationMessage>>,
    ) -> Self {
        Self {
            original_request: request.to_string(),
            user_intent: intent.to_string(),
            page_context,
            conversation_context,
            ..Default::default()
        }
    }

    /// 添加步骤输出
    pub fn add_output(&mut self, step_id: &str, output: Value) {
        self.step_outputs.insert(step_id.to_string(), output);
    }

    /// 获取步骤输出
    pub fn get_output(&self, step_id: &str) -> Option<&Value> {
        self.step_outputs.get(step_id)
    }

    /// 设置变量
    pub fn set_var(&mut self, key: &str, value: Value) {
        self.variables.insert(key.to_string(), value);
    }

    /// 获取变量
    pub fn get_var(&self, key: &str) -> Option<&Value> {
        self.variables.get(key)
    }

    /// 添加待执行的动态步骤
    pub fn queue_dynamic_steps(&mut self, steps: Vec<RecipeStep>) {
        self.dynamic_steps_generated += steps.len();
        self.pending_dynamic_steps.extend(steps);
    }

    /// 在队列前端插入步骤（优先执行）
    pub fn prepend_dynamic_steps(&mut self, steps: Vec<RecipeStep>) {
        self.dynamic_steps_generated += steps.len();
        let mut new_steps = steps;
        new_steps.append(&mut self.pending_dynamic_steps);
        self.pending_dynamic_steps = new_steps;
    }

    /// 取出下一个待执行的动态步骤
    pub fn pop_dynamic_step(&mut self) -> Option<RecipeStep> {
        if !self.pending_dynamic_steps.is_empty() {
            Some(self.pending_dynamic_steps.remove(0))
        } else {
            None
        }
    }

    /// 检查是否有待执行的动态步骤
    pub fn has_pending_steps(&self) -> bool {
        !self.pending_dynamic_steps.is_empty()
    }

    /// 添加不确定性
    pub fn add_uncertainty(&mut self, uncertainty: Uncertainty) {
        self.uncertainties.push(uncertainty);
    }

    /// 检查是否有关键不确定性需要解决
    pub fn has_critical_uncertainty(&self) -> bool {
        self.uncertainties
            .iter()
            .any(|u| u.importance == UncertaintyImportance::Critical)
    }

    /// 获取所有未解决的关键不确定性
    pub fn get_critical_uncertainties(&self) -> Vec<&Uncertainty> {
        self.uncertainties
            .iter()
            .filter(|u| u.importance == UncertaintyImportance::Critical)
            .filter(|u| !self.answered_questions.contains_key(&u.id))
            .collect()
    }

    /// 记录用户回答
    pub fn record_answer(&mut self, question_id: &str, answer: &str) {
        self.answered_questions
            .insert(question_id.to_string(), answer.to_string());
    }

    /// 记录执行决策
    pub fn record_decision(
        &mut self,
        decision_type: DecisionType,
        description: &str,
        reasoning: &str,
        step_id: Option<&str>,
    ) {
        self.decision_history.push(ExecutionDecision {
            timestamp: chrono::Utc::now(),
            decision_type,
            description: description.to_string(),
            reasoning: reasoning.to_string(),
            related_step: step_id.map(|s| s.to_string()),
        });
    }

    /// 生成上下文摘要（用于 AI 分析）
    pub fn generate_summary(&self) -> Value {
        serde_json::json!({
            "original_request": self.original_request,
            "user_intent": self.user_intent,
            "completed_steps": self.step_outputs.keys().collect::<Vec<_>>(),
            "pending_steps": self.pending_dynamic_steps.len(),
            "uncertainties": self.uncertainties.iter().map(|u| &u.description).collect::<Vec<_>>(),
            "answered_questions": self.answered_questions,
            "variables": self.variables,
        })
    }
}

impl UserQuestion {
    /// 创建自由文本问题
    #[allow(dead_code)]
    pub fn free_text(question: &str, context: &str, required: bool) -> Self {
        Self {
            question_id: uuid::Uuid::new_v4().to_string(),
            question_type: QuestionType::FreeText,
            question: question.to_string(),
            context: context.to_string(),
            options: None,
            required,
            default_value: None,
            created_at: chrono::Utc::now(),
            expires_at: Some(chrono::Utc::now() + chrono::Duration::minutes(30)),
        }
    }

    /// 创建单选问题
    #[allow(dead_code)]
    pub fn single_choice(
        question: &str,
        context: &str,
        options: Vec<QuestionOption>,
        required: bool,
    ) -> Self {
        Self {
            question_id: uuid::Uuid::new_v4().to_string(),
            question_type: QuestionType::SingleChoice,
            question: question.to_string(),
            context: context.to_string(),
            options: Some(options),
            required,
            default_value: None,
            created_at: chrono::Utc::now(),
            expires_at: Some(chrono::Utc::now() + chrono::Duration::minutes(30)),
        }
    }

    /// 创建确认问题
    #[allow(dead_code)]
    pub fn confirmation(question: &str, context: &str) -> Self {
        Self {
            question_id: uuid::Uuid::new_v4().to_string(),
            question_type: QuestionType::Confirmation,
            question: question.to_string(),
            context: context.to_string(),
            options: Some(vec![
                QuestionOption {
                    value: "yes".to_string(),
                    label: "是".to_string(),
                    description: None,
                },
                QuestionOption {
                    value: "no".to_string(),
                    label: "否".to_string(),
                    description: None,
                },
            ]),
            required: true,
            default_value: None,
            created_at: chrono::Utc::now(),
            expires_at: Some(chrono::Utc::now() + chrono::Duration::minutes(30)),
        }
    }
}

impl QuestionOption {
    #[allow(dead_code)]
    pub fn new(value: &str, label: &str) -> Self {
        Self {
            value: value.to_string(),
            label: label.to_string(),
            description: None,
        }
    }

    #[allow(dead_code)]
    pub fn with_description(mut self, description: &str) -> Self {
        self.description = Some(description.to_string());
        self
    }
}
