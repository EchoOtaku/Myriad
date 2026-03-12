//! Agent API 端点
//!
//! 提供 AI Agent 自然语言任务编排的 HTTP 接口

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Extension, Json,
};
use chrono::Utc;
use futures::stream::Stream;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::StreamExt;

use crate::middleware::auth::Claims;
use crate::models::entities::agent_task_presets;
use crate::services::agent::{
    Agent, AgentProgressEvent, AgentResponse, AgentResponseType, RequestContext, TaskState,
    UserRequest,
};

// ============ 请求/响应类型 ============

/// 处理请求
#[derive(Debug, Deserialize)]
pub struct ProcessRequest {
    /// 用户的自然语言输入
    pub input: String,
    /// 可选的上下文信息
    #[serde(default)]
    pub context: Option<ProcessContext>,
}

/// 处理上下文
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcessContext {
    /// 当前页面路由
    pub current_route: Option<String>,
    /// 活跃的平台
    pub active_platforms: Option<Vec<String>>,
    /// 会话 ID（用于多轮对话）
    pub session_id: Option<String>,
    /// 对话历史（用于继续对话模式）
    pub conversation_history: Option<Vec<ConversationMessageApi>>,
    /// 自定义数据
    pub custom_data: Option<Value>,
}

/// 对话消息（API 格式）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageApi {
    /// 角色: user, assistant, system
    pub role: String,
    /// 消息内容
    pub content: String,
    /// 创建时间
    pub created_at: Option<String>,
}

/// API 响应（增强版）
#[derive(Debug, Clone, Serialize)]
pub struct ApiResponse {
    /// 是否成功
    pub success: bool,
    /// 响应类型
    #[serde(rename = "responseType")]
    pub response_type: String,
    /// 消息
    pub message: String,
    /// 数据
    pub data: Option<Value>,
    /// 数据展示类型提示
    #[serde(rename = "dataDisplay", skip_serializing_if = "Option::is_none")]
    pub data_display: Option<DataDisplayHintApi>,
    /// 后续建议
    pub suggestions: Vec<String>,
    /// 任务信息
    pub task: Option<TaskInfo>,
    /// 敏感操作确认请求
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation: Option<ConfirmationInfo>,
    /// 前端操作指令（路由导航、音乐控制等）
    #[serde(rename = "frontendAction", skip_serializing_if = "Option::is_none")]
    pub frontend_action: Option<Value>,
}

/// 数据展示类型提示（API 版本）
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DataDisplayHintApi {
    /// 表格展示
    Table {
        columns: Vec<ColumnDefApi>,
        #[serde(rename = "dataPath", skip_serializing_if = "Option::is_none")]
        data_path: Option<String>,
    },
    /// 图表展示
    Chart {
        #[serde(rename = "chartType")]
        chart_type: String,
        #[serde(rename = "xField")]
        x_field: String,
        #[serde(rename = "yField")]
        y_field: String,
    },
    /// 卡片列表
    CardList {
        #[serde(rename = "titleField")]
        title_field: String,
        #[serde(rename = "descriptionField", skip_serializing_if = "Option::is_none")]
        description_field: Option<String>,
        #[serde(rename = "imageField", skip_serializing_if = "Option::is_none")]
        image_field: Option<String>,
    },
    /// Markdown
    Markdown,
    /// 键值对
    KeyValue,
    /// 时间线
    Timeline {
        #[serde(rename = "timeField")]
        time_field: String,
        #[serde(rename = "contentField")]
        content_field: String,
    },
    /// 原始 JSON
    Raw,
}

/// 表格列定义（API 版本）
#[derive(Debug, Clone, Serialize)]
pub struct ColumnDefApi {
    pub field: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    pub sortable: bool,
}

/// 敏感操作确认信息
#[derive(Debug, Clone, Serialize)]
pub struct ConfirmationInfo {
    /// 确认 ID
    #[serde(rename = "confirmationId")]
    pub confirmation_id: String,
    /// 风险等级
    #[serde(rename = "riskLevel")]
    pub risk_level: String,
    /// 过期时间（秒）
    #[serde(rename = "expiresInSeconds")]
    pub expires_in_seconds: i64,
    /// 待确认的步骤
    #[serde(rename = "pendingSteps")]
    pub pending_steps: Vec<PendingStepInfo>,
}

/// 待确认步骤信息
#[derive(Debug, Clone, Serialize)]
pub struct PendingStepInfo {
    /// 步骤 ID
    #[serde(rename = "stepId")]
    pub step_id: String,
    /// 能力名称
    #[serde(rename = "capabilityName")]
    pub capability_name: String,
    /// 确认消息
    pub message: String,
    /// 影响说明
    pub impact: Vec<String>,
}

/// 任务信息（增强版）
#[derive(Debug, Clone, Serialize)]
pub struct TaskInfo {
    /// 任务 ID
    #[serde(rename = "taskId")]
    pub task_id: String,
    /// 状态
    pub status: String,
    /// 进度 (0-100)
    pub progress: u8,
    /// 错误信息
    pub error: Option<String>,
    /// 当前执行步骤信息
    #[serde(rename = "currentStep", skip_serializing_if = "Option::is_none")]
    pub current_step: Option<StepInfo>,
    /// 已完成步骤数
    #[serde(rename = "completedSteps")]
    pub completed_steps: u32,
    /// 总步骤数（包含动态生成的）
    #[serde(rename = "totalSteps")]
    pub total_steps: u32,
    /// 动态生成的步骤数
    #[serde(rename = "dynamicStepsAdded")]
    pub dynamic_steps_added: u32,
    /// 待回答的问题（如果有）
    #[serde(rename = "pendingQuestion", skip_serializing_if = "Option::is_none")]
    pub pending_question: Option<QuestionSummary>,
    /// 步骤执行历史
    #[serde(rename = "stepHistory", skip_serializing_if = "Vec::is_empty")]
    pub step_history: Vec<StepExecution>,
}

/// 当前步骤信息
#[derive(Debug, Clone, Serialize)]
pub struct StepInfo {
    /// 步骤 ID
    #[serde(rename = "stepId")]
    pub step_id: String,
    /// 能力名称（用户友好的描述）
    #[serde(rename = "capabilityName")]
    pub capability_name: String,
    /// 步骤描述
    pub description: String,
    /// 开始时间
    #[serde(rename = "startedAt")]
    pub started_at: String,
}

/// 步骤执行记录
#[derive(Debug, Clone, Serialize)]
pub struct StepExecution {
    /// 步骤 ID
    #[serde(rename = "stepId")]
    pub step_id: String,
    /// 能力名称
    #[serde(rename = "capabilityName")]
    pub capability_name: String,
    /// 执行状态
    pub status: String,
    /// 执行时长（毫秒）
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// 输出摘要（简短描述，非完整数据）
    #[serde(rename = "outputSummary", skip_serializing_if = "Option::is_none")]
    pub output_summary: Option<String>,
    /// 是否为动态生成的步骤
    #[serde(rename = "isDynamic")]
    pub is_dynamic: bool,
}

/// 问题摘要
#[derive(Debug, Clone, Serialize)]
pub struct QuestionSummary {
    /// 问题 ID
    #[serde(rename = "questionId")]
    pub question_id: String,
    /// 问题类型
    #[serde(rename = "questionType")]
    pub question_type: String,
    /// 问题文本
    pub question: String,
    /// 选项（如果有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
}

// ============ SSE 进度事件类型 ============

/// SSE 进度事件（使用 service 层统一类型）
pub type ProgressEvent = AgentProgressEvent;

// ============ 任务预设 API 类型 ============

/// 对话消息（用于 conversation_data）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    /// 消息角色: user, assistant, system
    pub role: String,
    /// 消息内容
    pub content: String,
    /// 消息元数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
    /// 创建时间
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

/// 任务预设响应
#[derive(Debug, Clone, Serialize)]
pub struct TaskPresetResponse {
    /// 预设 ID
    pub id: i32,
    /// 用户输入的原始文本
    pub input: String,
    /// 预设类型: 'favorite' 或 'history'
    #[serde(rename = "presetType")]
    pub preset_type: String,
    /// 解析后的步骤
    #[serde(rename = "parsedSteps", skip_serializing_if = "Option::is_none")]
    pub parsed_steps: Option<Value>,
    /// 意图摘要
    #[serde(rename = "intentSummary", skip_serializing_if = "Option::is_none")]
    pub intent_summary: Option<String>,
    /// 最后使用时间
    #[serde(rename = "lastUsedAt")]
    pub last_used_at: String,
    /// 使用次数
    #[serde(rename = "useCount")]
    pub use_count: i32,
    /// 创建时间
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// 对话标题
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 对话历史数据
    #[serde(rename = "conversationData", skip_serializing_if = "Option::is_none")]
    pub conversation_data: Option<Vec<ConversationMessage>>,
    /// 是否有对话历史（前端用于判断是否显示"继续对话"按钮）
    #[serde(rename = "hasConversation")]
    pub has_conversation: bool,
}

/// 创建任务预设请求
#[derive(Debug, Deserialize)]
pub struct CreatePresetRequest {
    /// 用户输入的原始文本
    pub input: String,
    /// 预设类型: 'favorite' 或 'history'
    #[serde(rename = "presetType")]
    pub preset_type: String,
    /// 解析后的步骤（可选）
    #[serde(rename = "parsedSteps")]
    pub parsed_steps: Option<Value>,
    /// 意图摘要（可选）
    #[serde(rename = "intentSummary")]
    pub intent_summary: Option<String>,
    /// 对话标题（可选）
    pub title: Option<String>,
    /// 对话历史数据（可选）
    #[serde(rename = "conversationData")]
    pub conversation_data: Option<Vec<ConversationMessage>>,
}

/// 更新任务预设请求（预留）
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct UpdatePresetRequest {
    /// 意图摘要
    #[serde(rename = "intentSummary")]
    pub intent_summary: Option<String>,
}

/// 任务预设列表响应
#[derive(Debug, Serialize)]
pub struct TaskPresetListResponse {
    /// 收藏列表
    pub favorites: Vec<TaskPresetResponse>,
    /// 历史记录列表
    pub history: Vec<TaskPresetResponse>,
}

impl From<agent_task_presets::Model> for TaskPresetResponse {
    fn from(model: agent_task_presets::Model) -> Self {
        // 解析 conversation_data
        let conversation_data: Option<Vec<ConversationMessage>> = model
            .conversation_data
            .as_ref()
            .and_then(|j| serde_json::from_value(serde_json::Value::from(j.clone())).ok());

        let has_conversation = conversation_data
            .as_ref()
            .map(|c| !c.is_empty())
            .unwrap_or(false);

        Self {
            id: model.id,
            input: model.input,
            preset_type: model.preset_type,
            parsed_steps: model.parsed_steps.map(|j| serde_json::Value::from(j)),
            intent_summary: model.intent_summary,
            last_used_at: model.last_used_at.to_rfc3339(),
            use_count: model.use_count,
            created_at: model.created_at.to_rfc3339(),
            title: model.title,
            conversation_data,
            has_conversation,
        }
    }
}

impl From<&TaskState> for TaskInfo {
    fn from(state: &TaskState) -> Self {
        // 计算已完成步骤数
        let completed_steps = state.step_results.values().filter(|r| r.success).count() as u32;

        // 获取动态步骤数
        let dynamic_steps_added = state
            .execution_context
            .as_ref()
            .map(|ctx| ctx.dynamic_steps_generated as u32)
            .unwrap_or(0);

        // 计算总步骤数
        let total_steps = state.step_results.len() as u32
            + state
                .execution_context
                .as_ref()
                .map(|ctx| ctx.pending_dynamic_steps.len() as u32)
                .unwrap_or(0);

        // 构建步骤执行历史
        let step_history: Vec<StepExecution> = state
            .step_results
            .iter()
            .map(|(step_id, result)| {
                let output_summary = result.output.as_ref().and_then(|o| {
                    // 生成简短摘要
                    summarize_output(o)
                });

                StepExecution {
                    step_id: step_id.clone(),
                    capability_name: extract_capability_name(step_id),
                    status: if result.success {
                        "completed".to_string()
                    } else {
                        "failed".to_string()
                    },
                    duration_ms: Some(result.duration_ms),
                    output_summary,
                    is_dynamic: step_id.starts_with("dynamic_"),
                }
            })
            .collect();

        // 待回答问题
        let pending_question = state.pending_question.as_ref().map(|q| QuestionSummary {
            question_id: q.question_id.clone(),
            question_type: format!("{:?}", q.question_type).to_lowercase(),
            question: q.question.clone(),
            options: q
                .options
                .as_ref()
                .map(|opts| opts.iter().map(|o| o.label.clone()).collect()),
        });

        Self {
            task_id: state.task_id.clone(),
            status: format!("{:?}", state.status).to_lowercase(),
            progress: state.progress,
            error: state.error.clone(),
            current_step: None, // 由执行器在运行时设置
            completed_steps,
            total_steps: total_steps.max(completed_steps),
            dynamic_steps_added,
            pending_question,
            step_history,
        }
    }
}

/// 从输出生成简短摘要
fn summarize_output(output: &Value) -> Option<String> {
    match output {
        Value::String(s) => {
            if s.len() > 100 {
                Some(format!("{}...", &s[..100]))
            } else {
                Some(s.clone())
            }
        }
        Value::Array(arr) => Some(format!("返回 {} 条数据", arr.len())),
        Value::Object(obj) => {
            if let Some(msg) = obj.get("message").and_then(|v| v.as_str()) {
                Some(msg.to_string())
            } else if let Some(count) = obj.get("count").and_then(|v| v.as_u64()) {
                Some(format!("处理了 {} 条记录", count))
            } else if let Some(items) = obj.get("items").and_then(|v| v.as_array()) {
                Some(format!("返回 {} 条数据", items.len()))
            } else {
                Some(format!("返回 {} 个字段", obj.len()))
            }
        }
        Value::Bool(b) => Some(if *b {
            "成功".to_string()
        } else {
            "失败".to_string()
        }),
        Value::Number(n) => Some(n.to_string()),
        Value::Null => None,
    }
}

/// 从步骤 ID 提取能力名称
fn extract_capability_name(step_id: &str) -> String {
    // 步骤 ID 格式通常为 "step_1_platform.bilibili"
    if let Some(cap_part) = step_id.split('_').next_back() {
        // 将 capability id 转换为友好名称
        match cap_part {
            "bilibili" | "platform.bilibili" => "获取 B 站数据".to_string(),
            "steam" | "platform.steam" => "获取 Steam 数据".to_string(),
            "github" | "platform.github" => "获取 GitHub 数据".to_string(),
            "netease" | "platform.netease" => "获取网易云数据".to_string(),
            "summarize" | "ai.summarize" => "AI 总结".to_string(),
            "analyze" | "ai.analyze" => "AI 分析".to_string(),
            "webSearch" | "ai.webSearch" => "网络搜索".to_string(),
            "discover" | "brew.discover" => "发现 RSS 源".to_string(),
            "subscribe" | "brew.subscribe" => "订阅 RSS 源".to_string(),
            _ => cap_part.replace(['.', '_'], " "),
        }
    } else {
        step_id.to_string()
    }
}

impl From<AgentResponse> for ApiResponse {
    fn from(response: AgentResponse) -> Self {
        let data_display = response.data_display.map(convert_data_display_hint);

        // 转换确认请求
        let confirmation = response.confirmation.map(|req| {
            let expires_in = (req.expires_at - chrono::Utc::now()).num_seconds();
            ConfirmationInfo {
                confirmation_id: req.confirmation_id,
                risk_level: req
                    .pending_steps
                    .iter()
                    .map(|s| &s.risk_level)
                    .max_by_key(|r| match r {
                        crate::services::agent::RiskLevel::Critical => 4,
                        crate::services::agent::RiskLevel::High => 3,
                        crate::services::agent::RiskLevel::Medium => 2,
                        crate::services::agent::RiskLevel::Low => 1,
                        crate::services::agent::RiskLevel::None => 0,
                    })
                    .map(|r| format!("{:?}", r).to_lowercase())
                    .unwrap_or_else(|| "none".to_string()),
                expires_in_seconds: expires_in.max(0),
                pending_steps: req
                    .pending_steps
                    .into_iter()
                    .map(|s| PendingStepInfo {
                        step_id: s.step_id,
                        capability_name: s.capability_name,
                        message: s.confirmation_message,
                        impact: s.impact,
                    })
                    .collect(),
            }
        });

        // 转换前端操作指令
        let frontend_action = response
            .frontend_action
            .map(|fa| serde_json::to_value(&fa).unwrap_or(Value::Null));

        Self {
            success: !matches!(response.response_type, AgentResponseType::Error),
            response_type: format!("{:?}", response.response_type).to_lowercase(),
            message: response.message,
            data: response.data,
            data_display,
            suggestions: response.suggestions,
            task: response.task.as_ref().map(TaskInfo::from),
            confirmation,
            frontend_action,
        }
    }
}

// ============ 辅助函数 ============

/// 输入限制常量
const MAX_INPUT_LEN: usize = 2000;
const MAX_HISTORY_ITEMS: usize = 50;

/// 将 API 层的 ProcessContext 转换为 service 层的 RequestContext
fn build_request_context(ctx: ProcessContext) -> RequestContext {
    let conversation_history = ctx.conversation_history.map(|msgs| {
        msgs.into_iter()
            .take(MAX_HISTORY_ITEMS)
            .map(|m| crate::services::agent::types::ConversationMessage {
                role: m.role,
                content: m.content,
                created_at: m.created_at,
            })
            .collect()
    });

    RequestContext {
        current_route: ctx.current_route,
        active_platforms: ctx.active_platforms.unwrap_or_default(),
        preferences: None,
        session_id: ctx.session_id,
        conversation_history,
        custom_data: ctx.custom_data,
    }
}

/// 将 DataDisplayHint 从 service 层转换为 API 层类型
fn convert_data_display_hint(
    hint: crate::services::agent::DataDisplayHint,
) -> DataDisplayHintApi {
    match hint {
        crate::services::agent::DataDisplayHint::Table { columns, data_path } => {
            DataDisplayHintApi::Table {
                columns: columns
                    .into_iter()
                    .map(|c| ColumnDefApi {
                        field: c.field,
                        title: c.title,
                        width: c.width,
                        sortable: c.sortable,
                    })
                    .collect(),
                data_path,
            }
        }
        crate::services::agent::DataDisplayHint::Chart {
            chart_type,
            x_field,
            y_field,
        } => DataDisplayHintApi::Chart {
            chart_type: format!("{:?}", chart_type).to_lowercase(),
            x_field,
            y_field,
        },
        crate::services::agent::DataDisplayHint::CardList {
            title_field,
            description_field,
            image_field,
        } => DataDisplayHintApi::CardList {
            title_field,
            description_field,
            image_field,
        },
        crate::services::agent::DataDisplayHint::Markdown => DataDisplayHintApi::Markdown,
        crate::services::agent::DataDisplayHint::KeyValue => DataDisplayHintApi::KeyValue,
        crate::services::agent::DataDisplayHint::Timeline {
            time_field,
            content_field,
        } => DataDisplayHintApi::Timeline {
            time_field,
            content_field,
        },
        crate::services::agent::DataDisplayHint::Raw => DataDisplayHintApi::Raw,
    }
}

/// 解析 user_id，返回标准化错误
fn parse_user_id(claims: &Claims) -> Result<i32, (StatusCode, Json<Value>)> {
    claims.sub.parse::<i32>().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid user" })),
        )
    })
}

/// 验证输入长度
fn validate_input(input: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if input.len() > MAX_INPUT_LEN {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("输入过长，最大允许 {} 字符", MAX_INPUT_LEN)
            })),
        ));
    }
    if input.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "输入不能为空" })),
        ));
    }
    Ok(())
}

// ============ API 端点 ============

/// 处理自然语言请求
/// POST /api/agent/process
pub async fn process(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<ProcessRequest>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;
    validate_input(&req.input)?;

    tracing::info!(
        user_id = user_id,
        input_len = req.input.len(),
        "[Agent API] Processing request"
    );

    let user_request = UserRequest {
        raw_input: req.input,
        timestamp: chrono::Utc::now(),
        user_id,
        context: req.context.map(build_request_context),
    };

    // 创建 Agent 并处理请求
    let agent = Agent::new(db).await;
    let response = agent.process(user_request).await.map_err(|e| {
        tracing::error!(error = %e, "[Agent API] Processing failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
    })?;

    Ok(Json(response.into()))
}

/// 流式处理自然语言请求（带实时进度更新）
/// POST /api/agent/process/stream
pub async fn process_stream(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<ProcessRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;
    validate_input(&req.input)?;

    tracing::info!(
        user_id = user_id,
        input_len = req.input.len(),
        "[Agent API] Processing request with streaming"
    );

    let user_request = UserRequest {
        raw_input: req.input,
        timestamp: chrono::Utc::now(),
        user_id,
        context: req.context.map(build_request_context),
    };

    // 创建进度通道
    let (tx, rx) = tokio::sync::mpsc::channel::<ProgressEvent>(32);

    // 在后台执行任务
    let db_clone = db.clone();
    // tx 会被移动到 spawn 中，确保 channel 在任务完成前不会关闭
    tokio::spawn(async move {
        let agent = Agent::new(db_clone).await;

        // 使用带进度回调的处理方法
        match agent.process_with_progress(user_request, tx.clone()).await {
            Ok(response) => {
                let api_response: ApiResponse = response.into();
                let task_id = api_response
                    .task
                    .as_ref()
                    .map(|t| t.task_id.clone())
                    .unwrap_or_default();
                let success = api_response.success;
                // 序列化为 Value，避免 service 层依赖 API 类型
                let response_value = serde_json::to_value(&api_response)
                    .unwrap_or_else(|_| json!({"error": "serialization failed"}));

                tracing::info!("[Agent API] Sending TaskCompleted event");
                let send_result = tx
                    .send(AgentProgressEvent::TaskCompleted {
                        task_id,
                        success,
                        response: Box::new(response_value),
                    })
                    .await;
                if let Err(e) = send_result {
                    tracing::error!(error = %e, "[Agent API] Failed to send TaskCompleted event");
                } else {
                    tracing::info!("[Agent API] TaskCompleted event sent successfully");
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "[Agent API] Processing failed, sending error event");
                let _ = tx
                    .send(AgentProgressEvent::Error {
                        task_id: None,
                        message: e.clone(),
                        code: "PROCESSING_ERROR".to_string(),
                    })
                    .await;
            }
        }
        // tx 在这里被 drop，channel 关闭，SSE 流结束
    });

    // 将通道转换为 SSE 流
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        Ok(Event::default().data(data))
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

/// 获取任务状态
/// GET /api/agent/tasks/{task_id}
pub async fn get_task(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(task_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    tracing::debug!(
        user_id = user_id,
        task_id = %task_id,
        "[Agent API] Getting task status"
    );

    // 带所有权校验，防止 IDOR
    let agent = Agent::new(db).await;
    let task = agent.get_task_for_user(&task_id, user_id).await;

    match task {
        Some(task_state) => Ok(Json(json!({
            "success": true,
            "task": TaskInfo::from(&task_state),
            "results": task_state.step_results,
            "startedAt": task_state.started_at.to_rfc3339(),
            "completedAt": task_state.completed_at.map(|t| t.to_rfc3339())
        }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Task not found or access denied" })),
        )),
    }
}

/// 获取用户的所有任务
/// GET /api/agent/tasks
/// 任务列表分页参数
#[derive(Debug, Deserialize, Default)]
pub struct TaskListQuery {
    /// 最多返回多少条，默认 20，最大 100
    #[serde(default = "default_task_limit")]
    pub limit: usize,
    /// 偏移量，默认 0
    #[serde(default)]
    pub offset: usize,
}

fn default_task_limit() -> usize {
    20
}

pub async fn list_tasks(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Query(pagination): Query<TaskListQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    // 限制单次最多返回 100 条
    let limit = pagination.limit.min(100);
    let offset = pagination.offset;

    tracing::debug!(user_id = user_id, limit = limit, offset = offset, "[Agent API] Listing user tasks");

    let agent = Agent::new(db).await;
    let all_tasks = agent.get_user_tasks(user_id).await;
    let total = all_tasks.len();

    let task_list: Vec<Value> = all_tasks
        .iter()
        .rev() // 最新任务优先
        .skip(offset)
        .take(limit)
        .map(|t| {
            json!({
                "taskId": t.task_id,
                "recipeId": t.recipe_id,
                "status": format!("{:?}", t.status).to_lowercase(),
                "progress": t.progress,
                "startedAt": t.started_at.to_rfc3339(),
                "completedAt": t.completed_at.map(|time| time.to_rfc3339())
            })
        })
        .collect();

    Ok(Json(json!({
        "success": true,
        "tasks": task_list,
        "total": total,
        "limit": limit,
        "offset": offset,
        "hasMore": offset + limit < total
    })))
}

/// 获取系统能力列表
/// GET /api/agent/capabilities
pub async fn list_capabilities(
    Extension(_claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let capabilities = crate::services::agent::get_capabilities_summary().await;

    Ok(Json(json!({
        "success": true,
        "capabilities": capabilities
    })))
}

/// 取消任务
/// POST /api/agent/tasks/{task_id}/cancel
pub async fn cancel_task(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(task_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    tracing::info!(
        user_id = user_id,
        task_id = %task_id,
        "[Agent API] Cancelling task"
    );

    // 通过 Agent 接口取消（含所有权校验，防止 IDOR）
    let agent = Agent::new(db).await;
    let cancelled = agent.cancel_task_for_user(&task_id, user_id).await;

    if cancelled {
        Ok(Json(json!({
            "success": true,
            "message": "Task cancellation requested",
            "taskId": task_id
        })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Task not found or access denied" })),
        ))
    }
}

/// 回答问题请求
#[derive(Debug, Deserialize)]
pub struct AnswerQuestionRequest {
    /// 问题 ID
    pub question_id: String,
    /// 用户答案
    pub answer: String,
}

/// 回答任务中的问题
/// POST /api/agent/tasks/{task_id}/answer
pub async fn answer_task_question(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(task_id): Path<String>,
    Json(req): Json<AnswerQuestionRequest>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    tracing::info!(
        user_id = user_id,
        task_id = %task_id,
        question_id = %req.question_id,
        "[Agent API] Answering task question"
    );

    // 验证任务所有权：确认 task_id 属于当前用户
    let agent = Agent::new(db.clone()).await;
    let user_tasks = agent.get_user_tasks(user_id).await;
    let task = user_tasks.iter().find(|t| t.task_id == task_id);

    let (original_question, original_input) = match task {
        Some(t) => {
            // 验证 question_id 是否匹配待回答问题
            let q = t.pending_question.as_ref().filter(|q| q.question_id == req.question_id);
            let input = t
                .execution_context
                .as_ref()
                .map(|ctx| ctx.original_request.as_str())
                .unwrap_or("")
                .to_string();
            (q.map(|q| q.question.clone()), input)
        }
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Task not found or access denied" })),
            ));
        }
    };

    // 用用户回答 + 原始请求上下文重新处理
    // 携带 question context 以便 agent 能理解这是对某个问题的回答
    let new_input = if let Some(question) = original_question {
        format!("{}\n问题：{}\n回答：{}", original_input, question, req.answer)
    } else {
        // question_id 不匹配，直接把回答作为新输入
        req.answer.clone()
    };

    validate_input(&new_input)?;

    let user_request = UserRequest {
        raw_input: new_input,
        timestamp: chrono::Utc::now(),
        user_id,
        context: None,
    };

    agent
        .process(user_request)
        .await
        .map(|response| Json(ApiResponse::from(response)))
        .map_err(|e| {
            tracing::error!(error = %e, "[Agent API] Failed to process answer");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("处理回答失败: {}", e) })),
            )
        })
}

/// 提供澄清回答
/// POST /api/agent/clarify
#[derive(Debug, Deserialize)]
pub struct ClarifyRequest {
    /// 原始请求
    pub original_input: String,
    /// 澄清点 ID
    pub clarification_id: String,
    /// 用户选择或回答
    pub answer: String,
    /// 上下文
    #[serde(default)]
    pub context: Option<ProcessContext>,
}

pub async fn clarify(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<ClarifyRequest>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;
    validate_input(&req.original_input)?;

    tracing::info!(
        user_id = user_id,
        clarification_id = %req.clarification_id,
        "[Agent API] Processing clarification"
    );

    // 将澄清合并到原始请求
    let combined_input = format!("{}\n补充说明：{}", req.original_input, req.answer);

    let user_request = UserRequest {
        raw_input: combined_input,
        timestamp: chrono::Utc::now(),
        user_id,
        context: req.context.map(build_request_context),
    };

    let agent = Agent::new(db).await;
    let response = agent.process(user_request).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
    })?;

    Ok(Json(response.into()))
}

/// 健康检查
/// GET /api/agent/health
pub async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "agent",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

// ============ 任务预设 API ============

/// 获取任务预设列表
/// GET /api/agent/presets
pub async fn list_presets(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<TaskPresetListResponse>, (StatusCode, Json<Value>)> {
    use sea_orm::QuerySelect;

    let user_id = parse_user_id(&claims)?;

    // 并行发起两次查询，减少串行等待时间
    let (favorites_result, history_result) = tokio::join!(
        agent_task_presets::Entity::find()
            .filter(agent_task_presets::Column::UserId.eq(user_id))
            .filter(agent_task_presets::Column::PresetType.eq("favorite"))
            .order_by_desc(agent_task_presets::Column::LastUsedAt)
            .all(&db),
        agent_task_presets::Entity::find()
            .filter(agent_task_presets::Column::UserId.eq(user_id))
            .filter(agent_task_presets::Column::PresetType.eq("history"))
            .order_by_desc(agent_task_presets::Column::LastUsedAt)
            .limit(20) // DB 层限制，避免拉取全量到内存
            .all(&db),
    );

    let favorites = favorites_result
        .map_err(|e| {
            tracing::error!("[Agent Presets] Failed to fetch favorites: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch favorites" })),
            )
        })?
        .into_iter()
        .map(TaskPresetResponse::from)
        .collect();

    let history = history_result
        .map_err(|e| {
            tracing::error!("[Agent Presets] Failed to fetch history: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch history" })),
            )
        })?
        .into_iter()
        .map(TaskPresetResponse::from)
        .collect();

    Ok(Json(TaskPresetListResponse { favorites, history }))
}

/// 创建或更新任务预设
/// POST /api/agent/presets
pub async fn create_preset(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreatePresetRequest>,
) -> Result<Json<TaskPresetResponse>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    // 验证预设类型
    if req.preset_type != "favorite" && req.preset_type != "history" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid preset type, must be 'favorite' or 'history'" })),
        ));
    }

    let now = Utc::now().fixed_offset();

    // 检查是否已存在相同的输入
    let existing = agent_task_presets::Entity::find()
        .filter(agent_task_presets::Column::UserId.eq(user_id))
        .filter(agent_task_presets::Column::Input.eq(&req.input))
        .one(&db)
        .await
        .map_err(|e| {
            tracing::error!("[Agent Presets] Failed to check existing preset: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            )
        })?;

    if let Some(existing_preset) = existing {
        // 更新已存在的预设
        let mut active_model: agent_task_presets::ActiveModel = existing_preset.clone().into();
        // 只有当现有预设是 history 类型时才更新类型（保留 favorite 状态）
        if existing_preset.preset_type == "history" {
            active_model.preset_type = Set(req.preset_type);
        }
        active_model.last_used_at = Set(now);
        // 从原始 Model 获取 use_count 避免 ActiveValue::unwrap() panic
        active_model.use_count = Set(existing_preset.use_count + 1);
        if req.parsed_steps.is_some() {
            active_model.parsed_steps = Set(req.parsed_steps.map(sea_orm::JsonValue::from));
        }
        if req.intent_summary.is_some() {
            active_model.intent_summary = Set(req.intent_summary);
        }
        // 更新对话数据
        if req.title.is_some() {
            active_model.title = Set(req.title);
        }
        if req.conversation_data.is_some() {
            active_model.conversation_data = Set(
                req.conversation_data
                    .map(|c| sea_orm::JsonValue::from(serde_json::to_value(&c).unwrap_or_default()))
            );
        }

        let updated = active_model.update(&db).await.map_err(|e| {
            tracing::error!("[Agent Presets] Failed to update preset: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to update preset" })),
            )
        })?;

        return Ok(Json(TaskPresetResponse::from(updated)));
    }

    // 创建新预设
    let new_preset = agent_task_presets::ActiveModel {
        id: sea_orm::ActiveValue::NotSet,
        user_id: Set(user_id),
        input: Set(req.input),
        preset_type: Set(req.preset_type.clone()),
        parsed_steps: Set(req.parsed_steps.map(sea_orm::JsonValue::from)),
        intent_summary: Set(req.intent_summary),
        last_used_at: Set(now),
        use_count: Set(1),
        created_at: Set(now),
        title: Set(req.title),
        conversation_data: Set(
            req.conversation_data
                .map(|c| sea_orm::JsonValue::from(serde_json::to_value(&c).unwrap_or_default()))
        ),
    };

    let created = new_preset.insert(&db).await.map_err(|e| {
        tracing::error!("[Agent Presets] Failed to create preset: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create preset" })),
        )
    })?;

    // 如果是历史记录，清理超过 20 条的旧记录
    if req.preset_type == "history" {
        cleanup_old_history(&db, user_id).await;
    }

    Ok(Json(TaskPresetResponse::from(created)))
}

/// 清理超过 20 条的历史记录
///
/// 只查询超出部分的 ID（加 LIMIT+OFFSET），避免拉取全量数据到内存
async fn cleanup_old_history(db: &DatabaseConnection, user_id: i32) {
    use sea_orm::{PaginatorTrait, QuerySelect};

    // 先计算总数，若不超出则跳过
    let count = agent_task_presets::Entity::find()
        .filter(agent_task_presets::Column::UserId.eq(user_id))
        .filter(agent_task_presets::Column::PresetType.eq("history"))
        .count(db)
        .await
        .unwrap_or(0);

    if count <= 20 {
        return;
    }

    // 只查询第 21 条起的 ID，在 DB 层做 LIMIT/OFFSET
    let to_delete_ids: Vec<i32> = agent_task_presets::Entity::find()
        .filter(agent_task_presets::Column::UserId.eq(user_id))
        .filter(agent_task_presets::Column::PresetType.eq("history"))
        .order_by_desc(agent_task_presets::Column::LastUsedAt)
        .offset(20)
        .limit(count)
        .all(db)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.id)
        .collect();

    if !to_delete_ids.is_empty() {
        let _ = agent_task_presets::Entity::delete_many()
            .filter(agent_task_presets::Column::Id.is_in(to_delete_ids))
            .exec(db)
            .await;
    }
}

/// 删除任务预设（仅限历史类型，收藏类型不允许直接删除）
/// DELETE /api/agent/presets/{id}
pub async fn delete_preset(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(preset_id): Path<i32>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    // 确保只能删除自己的预设
    let preset = agent_task_presets::Entity::find_by_id(preset_id)
        .filter(agent_task_presets::Column::UserId.eq(user_id))
        .one(&db)
        .await
        .map_err(|e| {
            tracing::error!("[Agent Presets] Failed to find preset: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            )
        })?;

    let preset = preset.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Preset not found" })),
        )
    })?;

    // 只允许删除历史类型的预设，收藏类型需要先取消收藏
    if preset.preset_type == "favorite" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cannot delete favorite preset, please unfavorite first" })),
        ));
    }

    agent_task_presets::Entity::delete_by_id(preset_id)
        .exec(&db)
        .await
        .map_err(|e| {
            tracing::error!("[Agent Presets] Failed to delete preset: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete preset" })),
            )
        })?;

    Ok(Json(json!({ "success": true })))
}

/// 切换收藏状态
/// POST /api/agent/presets/{id}/toggle-favorite
pub async fn toggle_favorite(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(preset_id): Path<i32>,
) -> Result<Json<TaskPresetResponse>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    // 查找预设
    let preset = agent_task_presets::Entity::find_by_id(preset_id)
        .filter(agent_task_presets::Column::UserId.eq(user_id))
        .one(&db)
        .await
        .map_err(|e| {
            tracing::error!("[Agent Presets] Failed to find preset: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
        })?;

    // 切换类型
    let new_type = if preset.preset_type == "favorite" {
        "history"
    } else {
        "favorite"
    };

    let mut active_model: agent_task_presets::ActiveModel = preset.into();
    active_model.preset_type = Set(new_type.to_string());

    let updated = active_model.update(&db).await.map_err(|e| {
        tracing::error!("[Agent Presets] Failed to toggle favorite: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to toggle favorite" })),
        )
    })?;

    Ok(Json(TaskPresetResponse::from(updated)))
}

/// 更新预设使用时间（每次使用时调用）
/// POST /api/agent/presets/{id}/use
pub async fn use_preset(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(preset_id): Path<i32>,
) -> Result<Json<TaskPresetResponse>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    let now = Utc::now().fixed_offset();

    // 查找预设
    let preset = agent_task_presets::Entity::find_by_id(preset_id)
        .filter(agent_task_presets::Column::UserId.eq(user_id))
        .one(&db)
        .await
        .map_err(|e| {
            tracing::error!("[Agent Presets] Failed to find preset: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
        })?;

    let new_use_count = preset.use_count + 1;
    let mut active_model: agent_task_presets::ActiveModel = preset.into();
    active_model.last_used_at = Set(now);
    active_model.use_count = Set(new_use_count);

    let updated = active_model.update(&db).await.map_err(|e| {
        tracing::error!("[Agent Presets] Failed to update use time: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to update preset" })),
        )
    })?;

    Ok(Json(TaskPresetResponse::from(updated)))
}

/// 更新预设对话数据请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConversationRequest {
    /// 对话标题
    pub title: String,
    /// 对话记录
    pub conversation_data: Vec<ConversationMessage>,
}

/// 更新预设的对话数据（用于「继续对话」功能）
/// PATCH /api/agent/presets/{id}/conversation
pub async fn update_preset_conversation(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(preset_id): Path<i32>,
    Json(request): Json<UpdateConversationRequest>,
) -> Result<Json<TaskPresetResponse>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    let now = Utc::now().fixed_offset();

    // 查找预设
    let preset = agent_task_presets::Entity::find_by_id(preset_id)
        .filter(agent_task_presets::Column::UserId.eq(user_id))
        .one(&db)
        .await
        .map_err(|e| {
            tracing::error!("[Agent Presets] Failed to find preset: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
        })?;

    // 更新对话数据
    let mut active_model: agent_task_presets::ActiveModel = preset.into();
    active_model.title = Set(Some(request.title));
    active_model.conversation_data = Set(Some(serde_json::to_value(&request.conversation_data).unwrap_or_default()));
    active_model.last_used_at = Set(now);

    let updated = active_model.update(&db).await.map_err(|e| {
        tracing::error!("[Agent Presets] Failed to update conversation: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to update conversation" })),
        )
    })?;

    tracing::info!(
        user_id = user_id,
        preset_id = preset_id,
        "[Agent Presets] Updated conversation data"
    );

    Ok(Json(TaskPresetResponse::from(updated)))
}

/// 执行任务预设
/// POST /api/agent/presets/{id}/execute
///
/// 直接执行已保存的预设，跳过意图分析步骤
pub async fn execute_preset(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(preset_id): Path<i32>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<Value>)> {
    let user_id = parse_user_id(&claims)?;

    // 查找预设
    let preset = agent_task_presets::Entity::find_by_id(preset_id)
        .filter(agent_task_presets::Column::UserId.eq(user_id))
        .one(&db)
        .await
        .map_err(|e| {
            tracing::error!("[Agent Presets] Failed to find preset: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
        })?;

    // 检查是否有保存的 recipe
    let mut recipe: crate::services::agent::types::Recipe = preset
        .parsed_steps
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Preset has no saved recipe, please run the task first" })),
            )
        })?;

    // 🔑 重要：清除保存的 page_context，让步骤重新执行获取最新数据
    // 这确保 "获取最新文章 → AI总结" 这样的流程会获取当时的最新内容
    // 而不是使用保存时的旧数据
    recipe.page_context = None;

    tracing::info!(
        user_id = user_id,
        preset_id = preset_id,
        recipe_id = %recipe.id,
        "[Agent API] Executing preset with saved recipe"
    );

    // 更新使用时间
    let now = Utc::now().fixed_offset();
    let new_use_count = preset.use_count + 1;
    let mut active_model: agent_task_presets::ActiveModel = preset.into();
    active_model.last_used_at = Set(now);
    active_model.use_count = Set(new_use_count);
    let _ = active_model.update(&db).await;

    // 创建进度通道
    let (tx, rx) = tokio::sync::mpsc::channel::<ProgressEvent>(32);

    // 在后台执行任务
    let db_clone = db.clone();
    tokio::spawn(async move {
        let agent = crate::services::agent::Agent::new(db_clone).await;

        // 发送任务创建事件
        let _ = tx
            .send(ProgressEvent::TaskCreated {
                task_id: recipe.id.clone(),
                message: format!("正在执行预设任务：{}", recipe.name),
                total_steps: recipe.steps.len() as u32,
            })
            .await;

        // 直接执行已保存的 recipe（跳过意图分析）
        match agent.execute_saved_recipe(&recipe, user_id, tx.clone()).await {
            Ok(response) => {
                let api_response: ApiResponse = response.into();
                let task_id = api_response
                    .task
                    .as_ref()
                    .map(|t| t.task_id.clone())
                    .unwrap_or_default();
                let success = api_response.success;
                let response_value = serde_json::to_value(&api_response)
                    .unwrap_or_else(|_| json!({"error": "serialization failed"}));
                tracing::info!("[Agent API] Preset execution completed, sending TaskCompleted event");
                let _ = tx
                    .send(AgentProgressEvent::TaskCompleted {
                        task_id,
                        success,
                        response: Box::new(response_value),
                    })
                    .await;
            }
            Err(e) => {
                tracing::error!(error = %e, "[Agent API] Preset execution failed");
                let _ = tx
                    .send(ProgressEvent::Error {
                        task_id: None,
                        message: e.clone(),
                        code: "EXECUTION_ERROR".to_string(),
                    })
                    .await;
            }
        }
    });

    // 将通道转换为 SSE 流
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        Ok(Event::default().data(data))
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

// ============ 路由构建 ============

use axum::routing::{get, post};
use axum::Router;

/// 创建 Agent API 路由
pub fn create_agent_routes() -> Router<DatabaseConnection> {
    use crate::middleware;
    use axum::middleware::from_fn;

    Router::new()
        // 健康检查（公开）
        .route("/health", get(health))
        // 能力列表（需要认证）
        .route(
            "/capabilities",
            get(list_capabilities).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 处理自然语言请求（需要认证）
        .route(
            "/process",
            post(process).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 流式处理请求（带实时进度更新）
        .route(
            "/process/stream",
            post(process_stream).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 提供澄清（需要认证）
        .route(
            "/clarify",
            post(clarify).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 任务列表（需要认证）
        .route(
            "/tasks",
            get(list_tasks).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 任务详情（需要认证）
        .route(
            "/tasks/{task_id}",
            get(get_task).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 取消任务（需要认证）
        .route(
            "/tasks/{task_id}/cancel",
            post(cancel_task).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 回答任务问题（需要认证）
        .route(
            "/tasks/{task_id}/answer",
            post(answer_task_question).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // ============ 任务预设路由 ============
        // 预设列表（需要认证）
        .route(
            "/presets",
            get(list_presets).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 创建预设（需要认证）
        .route(
            "/presets",
            post(create_preset).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 删除预设（需要认证）
        .route(
            "/presets/{preset_id}",
            axum::routing::delete(delete_preset)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 切换收藏状态（需要认证）
        .route(
            "/presets/{preset_id}/toggle-favorite",
            post(toggle_favorite).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 更新使用时间（需要认证）
        .route(
            "/presets/{preset_id}/use",
            post(use_preset).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 更新预设对话数据（用于「继续对话」功能）
        .route(
            "/presets/{preset_id}/conversation",
            axum::routing::patch(update_preset_conversation)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // 执行预设（直接执行已保存的 recipe，跳过意图分析）
        .route(
            "/presets/{preset_id}/execute",
            post(execute_preset).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
}
