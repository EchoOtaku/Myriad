//! Agent 模块
//!
//! AI 驱动的自然语言任务编排系统
//!
//! ## 架构（含智能升级）
//!
//! ```text
//! 用户输入 ──▶ IntentAnalyzer ──▶ ParsedIntent
//!                                      │
//!                                      ▼
//!                              RecipeGenerator ──▶ Recipe (Level 1)
//!                                      │
//!                                      ▼
//!                            ConfirmationCheck (敏感操作)
//!                                      │
//!                                      ▼
//!                                 Executor ──▶ TaskState + Result
//!                                      │
//!                                      ▼
//!                             ResultEvaluator ──▶ 满足目标?
//!                                      │
//!                         ┌────────────┴────────────┐
//!                         │ Yes                     │ No
//!                         ▼                         ▼
//!                   AgentResponse           EscalationManager
//!                                                   │
//!                                                   ▼
//!                                          升级策略 (Local→Web)
//!                                                   │
//!                                                   ▼
//!                                             New Recipe
//!                                                   │
//!                                                   ▼
//!                                              Executor ──▶ ...
//! ```
//!
//! ## 模块
//!
//! - `types`: 核心类型定义
//! - `capability`: 能力注册表
//! - `intent`: 意图分析器
//! - `recipe`: 方案生成器
//! - `executor`: 执行引擎
//! - `escalation`: 结果评估与智能升级
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! use crate::services::agent::{Agent, UserRequest};
//!
//! let agent = Agent::new(db).await;
//! let request = UserRequest {
//!     raw_input: "总结一下最近一周B站的更新".to_string(),
//!     timestamp: chrono::Utc::now(),
//!     user_id: 1,
//!     context: None,
//! };
//!
//! let response = agent.process(request).await?;
//! ```

pub mod capability;
pub mod escalation;
pub mod executor;
pub mod intent;
pub mod recipe;
pub mod types;

// 重新导出核心类型
pub use types::*;

use chrono::{Duration, Utc};
use once_cell::sync::Lazy;
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 从输出生成简短摘要（用于进度更新）
fn summarize_output_simple(output: &Value) -> Option<String> {
    match output {
        Value::String(s) => {
            let chars: Vec<char> = s.chars().collect();
            if chars.len() > 80 {
                Some(format!("{}...", chars[..80].iter().collect::<String>()))
            } else {
                Some(s.clone())
            }
        }
        Value::Array(arr) => Some(format!("返回 {} 条数据", arr.len())),
        Value::Object(obj) => {
            if let Some(msg) = obj.get("message").and_then(|v| v.as_str()) {
                let chars: Vec<char> = msg.chars().collect();
                if chars.len() > 80 {
                    Some(format!("{}...", chars[..80].iter().collect::<String>()))
                } else {
                    Some(msg.to_string())
                }
            } else if let Some(items) = obj.get("items").and_then(|v| v.as_array()) {
                Some(format!("返回 {} 条数据", items.len()))
            } else if let Some(summary) = obj.get("aiSummary").and_then(|v| v.as_str()) {
                let chars: Vec<char> = summary.chars().collect();
                if chars.len() > 80 {
                    Some(format!("{}...", chars[..80].iter().collect::<String>()))
                } else {
                    Some(summary.to_string())
                }
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

/// 待确认配方存储
static PENDING_CONFIRMATIONS: Lazy<Arc<RwLock<HashMap<String, PendingRecipeConfirmation>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// 待确认的配方信息
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct PendingRecipeConfirmation {
    /// 确认请求
    pub request: ConfirmationRequest,
    /// 原始配方
    pub recipe: Recipe,
    /// 用户 ID
    pub user_id: i32,
    /// 原始意图
    pub intent: ParsedIntent,
}

/// Agent 主入口
///
/// 整合意图分析、方案生成、执行和智能升级的统一接口
pub struct Agent {
    /// 意图分析器
    intent_analyzer: intent::IntentAnalyzer,
    /// 方案生成器
    recipe_generator: recipe::RecipeGenerator,
    /// 执行引擎
    executor: executor::Executor,
    /// 升级管理器
    escalation_manager: escalation::EscalationManager,
}

impl Agent {
    /// 创建新的 Agent 实例
    pub async fn new(db: DatabaseConnection) -> Self {
        Self {
            intent_analyzer: intent::IntentAnalyzer::new().await,
            recipe_generator: recipe::RecipeGenerator::new(),
            executor: executor::Executor::new(db).await,
            escalation_manager: escalation::EscalationManager::new(),
        }
    }

    /// 处理用户请求
    ///
    /// 完整流程：
    /// 1. 解析意图
    /// 2. 检查是否需要澄清
    /// 3. 生成执行方案
    /// 4. 检查敏感操作，需要则请求确认
    /// 5. 执行方案
    /// 6. 返回结果
    pub async fn process(&self, request: UserRequest) -> Result<AgentResponse, String> {
        let user_id = request.user_id;

        // 请求驱动的过期任务清理（低概率触发，避免独立定时任务）
        executor::maybe_cleanup_tasks().await;

        tracing::info!(
            user_id = user_id,
            input = %request.raw_input,
            "[Agent] Processing request"
        );

        // 1. 解析意图
        let intent = self.intent_analyzer.analyze(&request).await?;

        tracing::debug!(
            action = ?intent.action,
            target = ?intent.target,
            confidence = intent.confidence,
            "[Agent] Intent parsed"
        );

        // 1.5 检查是否是不支持的请求
        if let Some(reason) = &intent.unsupported_reason {
            return Ok(AgentResponse {
                response_type: AgentResponseType::Answer,
                message: reason.clone(),
                data: Some(json!({
                    "unsupported": true,
                    "reason": reason,
                    "supportedFeatures": [
                        "搜索 Steam 游戏库",
                        "查看 Bilibili 追番",
                        "管理 GitHub 仓库",
                        "分析网易云音乐播放记录",
                        "订阅 RSS/Atom 源",
                        "创建和管理 Tapp",
                        "生成数据报告",
                        "联网搜索新闻和实时信息"
                    ]
                })),
                data_display: None,
                suggestions: vec![
                    "搜索最新的科技新闻".to_string(),
                    "查看我的 Steam 游戏".to_string(),
                    "分析我的 Bilibili 追番".to_string(),
                ],
                task: None,
                confirmation: None,
                frontend_action: None,
            });
        }

        // 2. 检查是否需要澄清
        if !intent.clarifications_needed.is_empty() && intent.confidence < 0.6 {
            return Ok(AgentResponse {
                response_type: AgentResponseType::Clarification,
                message: "我需要更多信息来理解你的请求".to_string(),
                data: Some(json!({
                    "intent": {
                        "action": format!("{:?}", intent.action),
                        "confidence": intent.confidence
                    },
                    "clarifications": intent.clarifications_needed
                })),
                data_display: None,
                suggestions: intent
                    .clarifications_needed
                    .iter()
                    .flat_map(|c| c.options.clone())
                    .collect(),
                task: None,
                confirmation: None,
                frontend_action: None,
            });
        }

        // 3. 生成执行方案
        let recipe = self
            .recipe_generator
            .generate(&intent, Some(&request))
            .await?;

        tracing::debug!(
            recipe_id = %recipe.id,
            execution_type = ?recipe.execution_type,
            steps = recipe.steps.len(),
            "[Agent] Recipe generated"
        );

        // 3.5 检查是否有可执行的步骤（回答用户是必须的输出，不是能力调用）
        if recipe.steps.is_empty() {
            // 没有找到合适的能力来处理请求，直接返回友好响应
            let message = match &intent.action {
                IntentAction::Query => {
                    "抱歉，我无法理解你想查询什么。请告诉我具体的平台（如 Steam、Bilibili、GitHub）或内容类型。".to_string()
                }
                IntentAction::Summarize => {
                    "请告诉我你想总结什么内容？例如：总结我的 Steam 游戏、总结最近的 Bilibili 追番。".to_string()
                }
                IntentAction::Analyze => {
                    "请告诉我你想分析什么？例如：分析我的游戏库、分析播放时间趋势。".to_string()
                }
                _ => {
                    "抱歉，我无法理解你的请求。请更具体地描述你想做什么。".to_string()
                }
            };

            return Ok(AgentResponse {
                response_type: AgentResponseType::Answer,
                message,
                data: Some(json!({
                    "reason": "no_suitable_capability",
                    "intent_action": format!("{:?}", intent.action),
                    "intent_target": format!("{:?}", intent.target),
                })),
                data_display: None,
                suggestions: vec![
                    "查看我的 Steam 游戏".to_string(),
                    "总结 Bilibili 追番".to_string(),
                    "搜索科技新闻".to_string(),
                    "分析我的游戏时间".to_string(),
                ],
                task: None,
                confirmation: None,
                frontend_action: None,
            });
        }

        // 4. 检查敏感操作
        let sensitive_steps = self.check_sensitive_steps(&recipe).await;
        if !sensitive_steps.is_empty() {
            return self
                .request_confirmation(&recipe, &intent, user_id, sensitive_steps)
                .await;
        }

        // 5. 执行方案
        self.execute_recipe(&recipe, &intent, user_id).await
    }

    /// 处理用户请求（带实时进度回调）
    ///
    /// 与 process 相同的逻辑，但会通过 channel 发送进度更新
    pub async fn process_with_progress(
        &self,
        request: UserRequest,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    ) -> Result<AgentResponse, String> {
        let user_id = request.user_id;

        // 从请求上下文中获取对话历史（由前端「继续对话」功能传入）
        let conversation_context = request
            .context
            .as_ref()
            .and_then(|ctx| ctx.custom_data.as_ref())
            .and_then(|data| data.get("conversation_history"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // 增强日志：打印对话历史详情
        if let Some(ref history) = conversation_context {
            tracing::info!(
                user_id = user_id,
                history_len = history.len(),
                history_preview = %history.chars().take(200).collect::<String>(),
                "[Agent] 🔵 对话历史已获取"
            );
        }

        tracing::info!(
            user_id = user_id,
            input = %request.raw_input,
            has_history = conversation_context.is_some(),
            "[Agent] Processing request with progress tracking"
        );

        // 1. 解析意图（带对话历史上下文）
        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 5,
                completed_steps: 0,
                total_steps: 0,
                message: "正在理解你的请求...".to_string(),
            })
            .await;

        // 将对话历史注入到请求上下文中
        let request_with_context = {
            let mut enhanced_request = request.clone();
            let mut ctx = enhanced_request.context.unwrap_or_default();
            let mut custom = ctx.custom_data.unwrap_or(json!({}));
            if let Some(obj) = custom.as_object_mut() {
                // 添加对话历史（如果有）
                if let Some(history) = conversation_context {
                    obj.insert("conversation_history".to_string(), json!(history));
                }
            }
            ctx.custom_data = Some(custom);
            enhanced_request.context = Some(ctx);
            enhanced_request
        };

        let intent = self.intent_analyzer.analyze(&request_with_context).await?;

        // 1.5 检查是否是不支持的请求
        if let Some(reason) = &intent.unsupported_reason {
            return Ok(AgentResponse {
                response_type: AgentResponseType::Answer,
                message: reason.clone(),
                data: Some(json!({
                    "unsupported": true,
                    "reason": reason,
                })),
                data_display: None,
                suggestions: vec![
                    "搜索最新的科技新闻".to_string(),
                    "查看我的 Steam 游戏".to_string(),
                ],
                task: None,
                confirmation: None,
                frontend_action: None,
            });
        }

        // 2. 检查是否需要澄清
        if !intent.clarifications_needed.is_empty() && intent.confidence < 0.6 {
            return Ok(AgentResponse {
                response_type: AgentResponseType::Clarification,
                message: "我需要更多信息来理解你的请求".to_string(),
                data: Some(json!({
                    "intent": {
                        "action": format!("{:?}", intent.action),
                        "confidence": intent.confidence
                    },
                    "clarifications": intent.clarifications_needed
                })),
                data_display: None,
                suggestions: intent
                    .clarifications_needed
                    .iter()
                    .flat_map(|c| c.options.clone())
                    .collect(),
                task: None,
                confirmation: None,
                frontend_action: None,
            });
        }

        // 3. 生成执行方案
        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 15,
                completed_steps: 0,
                total_steps: 0,
                message: "正在规划执行步骤...".to_string(),
            })
            .await;

        let recipe = self
            .recipe_generator
            .generate(&intent, Some(&request))
            .await?;

        // 3.5 检查是否有可执行的步骤
        if recipe.steps.is_empty() {
            let message = match &intent.action {
                IntentAction::Query => {
                    "抱歉，我无法理解你想查询什么。请告诉我具体的平台或内容类型。".to_string()
                }
                _ => "抱歉，我无法理解你的请求。请更具体地描述你想做什么。".to_string(),
            };

            return Ok(AgentResponse {
                response_type: AgentResponseType::Answer,
                message,
                data: None,
                data_display: None,
                suggestions: vec![
                    "查看我的 Steam 游戏".to_string(),
                    "搜索科技新闻".to_string(),
                ],
                task: None,
                confirmation: None,
                frontend_action: None,
            });
        }

        // ========== 快速路径优化 ==========
        // 对于简单的单步查询，跳过任务创建，直接执行
        // 这样可以减少不必要的开销，提升响应速度
        let is_simple_query = recipe.steps.len() == 1
            && matches!(intent.action, IntentAction::Query)
            && !self.is_sensitive_capability(&recipe.steps[0].capability_id);

        if is_simple_query {
            tracing::debug!(
                recipe_id = %recipe.id,
                "[Agent] Using fast path for simple query"
            );
            return self
                .execute_simple_query(&recipe, &intent, user_id, progress_tx)
                .await;
        }
        // ========== 快速路径优化结束 ==========

        // 发送任务创建事件（多步骤任务）
        let _ = progress_tx
            .send(AgentProgressEvent::TaskCreated {
                task_id: recipe.id.clone(),
                message: format!("开始执行：{}", recipe.name),
                total_steps: recipe.steps.len() as u32,
            })
            .await;

        // 4. 检查敏感操作
        let sensitive_steps = self.check_sensitive_steps(&recipe).await;
        if !sensitive_steps.is_empty() {
            return self
                .request_confirmation(&recipe, &intent, user_id, sensitive_steps)
                .await;
        }

        // 5. 执行方案（带进度回调）
        self.execute_recipe_with_progress(&recipe, &intent, user_id, progress_tx)
            .await
    }

    /// 执行配方（带进度回调）- 使用实时 SSE 事件和智能升级
    async fn execute_recipe_with_progress(
        &self,
        recipe: &Recipe,
        intent: &ParsedIntent,
        user_id: i32,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    ) -> Result<AgentResponse, String> {
        // 确定初始升级等级
        let initial_level = escalation::EscalationLevel::from_intent(intent);

        // 使用带升级的执行
        self.execute_with_escalation(
            recipe,
            intent,
            user_id,
            initial_level,
            0,
            Some(progress_tx),
        ).await
    }

    /// 执行已保存的 Recipe（跳过意图分析）
    ///
    /// 用于从预设中直接执行任务，避免重复的意图解析
    pub async fn execute_saved_recipe(
        &self,
        recipe: &Recipe,
        user_id: i32,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    ) -> Result<AgentResponse, String> {
        tracing::info!(
            user_id = user_id,
            recipe_id = %recipe.id,
            recipe_name = %recipe.name,
            steps_count = recipe.steps.len(),
            "[Agent] Executing saved recipe directly"
        );

        // 直接执行 recipe
        let task_state = self
            .executor
            .execute_with_progress(recipe, user_id, Some(progress_tx))
            .await?;

        // 根据执行类型返回结果
        let mut result = self.extract_final_result(&task_state);
        let frontend_action = self.extract_frontend_action(&result);

        // 添加 recipe 到结果
        if let Some(obj) = result.as_object_mut() {
            obj.insert("recipe".to_string(), serde_json::to_value(recipe).unwrap_or_default());
        }

        // 为已保存的 recipe 生成简单消息
        let message = match task_state.status {
            types::TaskStatus::Completed => format!("已完成：{}", recipe.name),
            types::TaskStatus::Failed => format!("执行失败：{}", task_state.error.clone().unwrap_or_default()),
            _ => format!("正在执行：{}", recipe.name),
        };

        Ok(AgentResponse {
            response_type: AgentResponseType::Answer,
            message,
            data: Some(result),
            data_display: None,
            suggestions: vec![],
            task: Some(task_state),
            confirmation: None,
            frontend_action,
        })
    }

    /// 快速路径：执行简单的单步查询
    ///
    /// 跳过任务创建流程，直接执行并返回结果
    /// 适用于：单步查询、非敏感操作
    async fn execute_simple_query(
        &self,
        recipe: &Recipe,
        intent: &ParsedIntent,
        user_id: i32,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    ) -> Result<AgentResponse, String> {
        let step = &recipe.steps[0];
        // 使用带上下文的步骤描述
        let step_description = capability::get_step_description(step);

        // 发送开始执行进度
        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 20,
                completed_steps: 0,
                total_steps: 1,
                message: format!("正在{}...", step_description),
            })
            .await;

        // 发送步骤开始
        let _ = progress_tx
            .send(AgentProgressEvent::StepStarted {
                step_id: step.id.clone(),
                step_index: 0,
                total_steps: 1,
                capability_name: step_description.clone(),
                description: format!("正在执行: {}", step_description),
            })
            .await;

        // 直接执行
        let start_time = std::time::Instant::now();
        let task_state = self.executor.execute(recipe, user_id).await?;
        let duration_ms = start_time.elapsed().as_millis() as u64;

        // 获取执行结果
        let (success, output_summary) = task_state
            .step_results
            .get(&step.id)
            .map(|r| {
                (
                    r.success,
                    r.output.as_ref().and_then(summarize_output_simple),
                )
            })
            .unwrap_or((false, None));

        // 发送步骤完成
        let _ = progress_tx
            .send(AgentProgressEvent::StepCompleted {
                step_id: step.id.clone(),
                step_index: 0,
                success,
                duration_ms,
                output_summary,
            })
            .await;

        // 发送完成进度
        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 100,
                completed_steps: 1,
                total_steps: 1,
                message: "完成".to_string(),
            })
            .await;

        // 构建响应
        let mut result = self.extract_final_result(&task_state);
        let frontend_action = self.extract_frontend_action(&result);
        let data_display = self.infer_data_display(&result, intent);

        // 将 recipe 添加到结果中，供前端保存到预设
        if let Some(obj) = result.as_object_mut() {
            obj.insert("recipe".to_string(), serde_json::to_value(recipe).unwrap_or_default());
        }

        Ok(AgentResponse {
            response_type: AgentResponseType::Answer,
            message: self.generate_response_message(intent, &task_state),
            data: Some(result),
            data_display,
            suggestions: vec![],
            task: None, // 简单查询不创建任务
            confirmation: None,
            frontend_action,
        })
    }

    /// 检查能力是否为敏感操作
    fn is_sensitive_capability(&self, capability_id: &str) -> bool {
        // 敏感操作列表
        const SENSITIVE_CAPABILITIES: &[&str] = &[
            "delete",
            "remove",
            "unfollow",
            "unsubscribe",
            "clear",
            "reset",
            "export_all",
            "batch_",
        ];

        SENSITIVE_CAPABILITIES
            .iter()
            .any(|s| capability_id.contains(s))
    }

    /// 处理用户确认
    #[allow(dead_code)]
    pub async fn process_confirmation(
        &self,
        confirmation: UserConfirmation,
    ) -> Result<AgentResponse, String> {
        let pending = {
            let mut store = PENDING_CONFIRMATIONS.write().await;
            store.remove(&confirmation.confirmation_id)
        };

        match pending {
            Some(pending_confirmation) => {
                if !confirmation.confirmed {
                    // 用户取消
                    return Ok(AgentResponse {
                        response_type: AgentResponseType::Answer,
                        message: "操作已取消".to_string(),
                        data: Some(json!({
                            "cancelled": true,
                            "confirmation_id": confirmation.confirmation_id
                        })),
                        data_display: None,
                        suggestions: vec!["查看其他操作".to_string()],
                        task: None,
                        confirmation: None,
                        frontend_action: None,
                    });
                }

                // 检查是否过期
                if Utc::now() > pending_confirmation.request.expires_at {
                    return Ok(AgentResponse {
                        response_type: AgentResponseType::Error,
                        message: "确认请求已过期，请重新发起操作".to_string(),
                        data: None,
                        data_display: None,
                        suggestions: vec!["重新执行".to_string()],
                        task: None,
                        confirmation: None,
                        frontend_action: None,
                    });
                }

                tracing::info!(
                    confirmation_id = %confirmation.confirmation_id,
                    user_id = pending_confirmation.user_id,
                    "[Agent] User confirmed sensitive operation"
                );

                // 执行已确认的配方
                self.execute_recipe(
                    &pending_confirmation.recipe,
                    &pending_confirmation.intent,
                    pending_confirmation.user_id,
                )
                .await
            }
            None => Ok(AgentResponse {
                response_type: AgentResponseType::Error,
                message: "确认请求不存在或已处理".to_string(),
                data: None,
                data_display: None,
                suggestions: vec!["重新发起操作".to_string()],
                task: None,
                confirmation: None,
                frontend_action: None,
            }),
        }
    }

    /// 检查配方中的敏感步骤
    async fn check_sensitive_steps(&self, recipe: &Recipe) -> Vec<PendingConfirmation> {
        let mut sensitive = Vec::new();
        let registry = capability::get_registry().await;

        for step in &recipe.steps {
            // 使用异步版本，可以从 Capability 结构体或静态配置获取
            if let Some((message, risk_level)) =
                capability::capability_requires_confirmation_async(&step.capability_id).await
            {
                let capability_name = registry
                    .get(&step.capability_id)
                    .map(|c| c.name.clone())
                    .unwrap_or_else(|| step.capability_id.clone());

                let description = registry
                    .get(&step.capability_id)
                    .map(|c| c.description.clone())
                    .unwrap_or_default();

                // 生成影响说明
                let impact = self.generate_impact_description(step, &risk_level);

                sensitive.push(PendingConfirmation {
                    step_id: step.id.clone(),
                    capability_id: step.capability_id.clone(),
                    capability_name,
                    description,
                    risk_level,
                    confirmation_message: message,
                    impact,
                });
            }
        }

        sensitive
    }

    /// 生成操作影响说明
    fn generate_impact_description(
        &self,
        step: &RecipeStep,
        risk_level: &RiskLevel,
    ) -> Vec<String> {
        let mut impact = Vec::new();

        match risk_level {
            RiskLevel::Critical => {
                impact.push("⚠️ 此操作为系统级敏感操作".to_string());
                impact.push("⚠️ 操作不可逆，请谨慎确认".to_string());
            }
            RiskLevel::High => {
                impact.push("🔴 此操作可能导致数据丢失".to_string());
                impact.push("🔴 操作完成后无法撤销".to_string());
            }
            RiskLevel::Medium => {
                impact.push("🟡 此操作将修改数据或系统配置".to_string());
            }
            RiskLevel::Low => {
                impact.push("🟢 此操作影响较小，可以恢复".to_string());
            }
            RiskLevel::None => {}
        }

        // 添加具体参数信息
        if let Some(platform) = step.params.get("platform") {
            impact.push(format!("目标平台: {}", platform));
        }
        if let Some(url) = step.params.get("url") {
            impact.push(format!("目标 URL: {}", url));
        }

        impact
    }

    /// 请求用户确认
    async fn request_confirmation(
        &self,
        recipe: &Recipe,
        intent: &ParsedIntent,
        user_id: i32,
        sensitive_steps: Vec<PendingConfirmation>,
    ) -> Result<AgentResponse, String> {
        let confirmation_id = uuid::Uuid::new_v4().to_string();

        // 确定最高风险等级
        let max_risk = sensitive_steps
            .iter()
            .map(|s| &s.risk_level)
            .max_by_key(|r| match r {
                RiskLevel::Critical => 4,
                RiskLevel::High => 3,
                RiskLevel::Medium => 2,
                RiskLevel::Low => 1,
                RiskLevel::None => 0,
            })
            .cloned()
            .unwrap_or(RiskLevel::None);

        // 过期时间：高风险 5 分钟，其他 15 分钟
        let expires_in = match max_risk {
            RiskLevel::Critical | RiskLevel::High => Duration::minutes(5),
            _ => Duration::minutes(15),
        };

        let confirmation_request = ConfirmationRequest {
            confirmation_id: confirmation_id.clone(),
            recipe_id: recipe.id.clone(),
            pending_steps: sensitive_steps,
            expires_at: Utc::now() + expires_in,
        };

        // 存储待确认的配方
        {
            let mut store = PENDING_CONFIRMATIONS.write().await;
            store.insert(
                confirmation_id.clone(),
                PendingRecipeConfirmation {
                    request: confirmation_request.clone(),
                    recipe: recipe.clone(),
                    user_id,
                    intent: intent.clone(),
                },
            );
        }

        // 生成确认消息
        let message = self.generate_confirmation_message(&confirmation_request, &max_risk);

        tracing::info!(
            confirmation_id = %confirmation_id,
            risk_level = ?max_risk,
            steps = confirmation_request.pending_steps.len(),
            "[Agent] Requesting user confirmation for sensitive operation"
        );

        Ok(AgentResponse {
            response_type: AgentResponseType::ConfirmationRequired,
            message,
            data: None,
            data_display: None,
            suggestions: vec![
                "确认执行".to_string(),
                "取消操作".to_string(),
                "查看详情".to_string(),
            ],
            task: None,
            confirmation: Some(confirmation_request),
            frontend_action: None,
        })
    }

    /// 生成确认提示消息
    fn generate_confirmation_message(
        &self,
        request: &ConfirmationRequest,
        risk_level: &RiskLevel,
    ) -> String {
        let risk_prefix = match risk_level {
            RiskLevel::Critical => "⚠️ 危险操作",
            RiskLevel::High => "🔴 高风险操作",
            RiskLevel::Medium => "🟡 敏感操作",
            RiskLevel::Low => "🟢 需确认操作",
            RiskLevel::None => "操作确认",
        };

        let step_names: Vec<_> = request
            .pending_steps
            .iter()
            .map(|s| s.capability_name.as_str())
            .collect();

        format!(
            "{}: 即将执行 {}。\n\n{}\n\n请确认是否继续执行？",
            risk_prefix,
            step_names.join("、"),
            request
                .pending_steps
                .iter()
                .map(|s| format!("• {}: {}", s.capability_name, s.confirmation_message))
                .collect::<Vec<_>>()
                .join("\n")
        )
    }

    /// 执行配方（内部方法）
    ///
    /// 包含智能升级逻辑：如果结果不满足用户目标，会自动升级策略重试
    async fn execute_recipe(
        &self,
        recipe: &Recipe,
        intent: &ParsedIntent,
        user_id: i32,
    ) -> Result<AgentResponse, String> {
        // 确定初始升级等级
        let initial_level = escalation::EscalationLevel::from_intent(intent);

        // 带升级的执行
        self.execute_with_escalation(
            recipe,
            intent,
            user_id,
            initial_level,
            0,  // 初始升级次数
            None,
        ).await
    }

    /// 带智能升级的执行逻辑（循环版本，避免递归 async 问题）
    async fn execute_with_escalation(
        &self,
        recipe: &Recipe,
        intent: &ParsedIntent,
        user_id: i32,
        initial_level: escalation::EscalationLevel,
        initial_count: u32,
        progress_tx: Option<tokio::sync::mpsc::Sender<AgentProgressEvent>>,
    ) -> Result<AgentResponse, String> {
        use escalation::EscalationDecision;

        let mut current_recipe = recipe.clone();
        let mut current_intent = intent.clone();
        let mut current_level = initial_level;
        let mut escalation_count = initial_count;

        loop {
            tracing::info!(
                level = %current_level,
                escalation_count = escalation_count,
                recipe_id = %current_recipe.id,
                "[Agent] Executing recipe at level"
            );

            // 执行配方
            let task_state = if let Some(ref tx) = progress_tx {
                self.executor.execute_with_progress(&current_recipe, user_id, Some(tx.clone())).await?
            } else {
                self.executor.execute(&current_recipe, user_id).await?
            };

            // 提取结果
            let result = self.extract_final_result(&task_state);

            // 评估结果是否满足目标
            let decision = self.escalation_manager.evaluate_and_escalate(
                &current_intent,
                &current_recipe,
                &result,
                current_level,
                escalation_count,
            ).await;

            match decision {
                EscalationDecision::Accept => {
                    // 结果满足目标，返回响应
                    tracing::info!(
                        level = %current_level,
                        "[Agent] Result accepted at level"
                    );
                    return self.build_response_from_result(&current_intent, &task_state, result, &current_recipe).await;
                }
                EscalationDecision::Escalate { new_level, new_intent, reason } => {
                    // 需要升级
                    tracing::info!(
                        from = %current_level,
                        to = %new_level,
                        reason = %reason,
                        "[Agent] Escalating to higher level"
                    );

                    // 发送升级进度事件
                    if let Some(ref tx) = progress_tx {
                        let _ = tx.send(AgentProgressEvent::Progress {
                            progress: 50,
                            completed_steps: escalation_count + 1,
                            total_steps: 0, // 未知
                            message: format!("正在升级策略：{}", reason),
                        }).await;
                    }

                    // 为升级后的意图生成新的 Recipe
                    let new_recipe = self.escalation_manager
                        .generate_escalated_recipe(&new_intent, None)
                        .await?;

                    // 更新状态，继续循环
                    current_recipe = new_recipe;
                    current_intent = new_intent;
                    current_level = new_level;
                    escalation_count += 1;
                    // 继续循环
                }
                EscalationDecision::RequireConfirmation { suggested_level, message } => {
                    // 需要用户确认是否升级
                    return Ok(AgentResponse {
                        response_type: AgentResponseType::Clarification,
                        message: format!(
                            "当前结果可能不完整。{}\n是否要{}？",
                            message,
                            suggested_level
                        ),
                        data: Some(json!({
                            "currentResult": result,
                            "suggestedLevel": format!("{:?}", suggested_level),
                            "reason": message
                        })),
                        data_display: None,
                        suggestions: vec![
                            format!("是，{}", suggested_level),
                            "不用了，当前结果就够了".to_string(),
                        ],
                        task: Some(task_state),
                        confirmation: None,
                        frontend_action: None,
                    });
                }
            }
        }
    }

    /// 从执行结果构建响应
    async fn build_response_from_result(
        &self,
        intent: &ParsedIntent,
        task_state: &TaskState,
        mut result: Value,
        recipe: &Recipe,
    ) -> Result<AgentResponse, String> {
        // 根据执行类型决定响应方式
        match recipe.execution_type {
            ExecutionType::Instant => {
                // 提取前端动作
                let frontend_action = self.extract_frontend_action(&result);

                // 根据结果类型生成展示提示
                let data_display = self.infer_data_display(&result, intent);

                // 将 recipe 添加到结果
                if let Some(obj) = result.as_object_mut() {
                    obj.insert("recipe".to_string(), serde_json::to_value(recipe).unwrap_or_default());
                }

                Ok(AgentResponse {
                    response_type: AgentResponseType::Answer,
                    message: self.generate_response_message(intent, task_state),
                    data: Some(result),
                    data_display,
                    suggestions: self.generate_suggestions(intent),
                    task: Some(task_state.clone()),
                    confirmation: None,
                    frontend_action,
                })
            }
            ExecutionType::Continuous => {
                // 创建监控任务
                Ok(AgentResponse {
                    response_type: AgentResponseType::TaskCreated,
                    message: format!(
                        "已创建监控任务：{}。系统将持续关注相关变化并及时通知你。",
                        recipe.name
                    ),
                    data: Some(json!({
                        "monitorConfig": recipe.metadata.get("monitorConfig")
                    })),
                    data_display: None,
                    suggestions: vec![
                        "查看监控状态".to_string(),
                        "修改监控条件".to_string(),
                        "停止监控".to_string(),
                    ],
                    task: Some(task_state.clone()),
                    confirmation: None,
                    frontend_action: None,
                })
            }
            ExecutionType::Creation => {
                // 创建资源任务
                let frontend_action = self.extract_frontend_action(&result);
                let data_display = self.infer_data_display(&result, intent);

                Ok(AgentResponse {
                    response_type: AgentResponseType::TaskCompleted,
                    message: format!("{}已完成", recipe.name),
                    data: Some(result),
                    data_display,
                    suggestions: self.generate_creation_suggestions(intent),
                    task: Some(task_state.clone()),
                    confirmation: None,
                    frontend_action,
                })
            }
            ExecutionType::Batch => {
                // 批处理任务
                let frontend_action = self.extract_frontend_action(&result);
                let data_display = self.infer_data_display(&result, intent);

                Ok(AgentResponse {
                    response_type: AgentResponseType::TaskCompleted,
                    message: format!("批处理任务已完成：{}", recipe.name),
                    data: Some(result),
                    data_display,
                    suggestions: vec!["查看处理结果".to_string(), "执行下一步".to_string()],
                    task: Some(task_state.clone()),
                    confirmation: None,
                    frontend_action,
                })
            }
        }
    }

    /// 获取任务状态（带所有权校验，防止 IDOR）
    pub async fn get_task_for_user(&self, task_id: &str, user_id: i32) -> Option<TaskState> {
        executor::get_task_for_user(task_id, user_id).await
    }

    /// 取消任务（带所有权校验）
    pub async fn cancel_task_for_user(&self, task_id: &str, user_id: i32) -> bool {
        executor::cancel_task_for_user(task_id, user_id).await
    }

    /// 获取任务状态（不含所有权校验，内部使用）
    #[allow(dead_code)]
    pub async fn get_task_status(&self, task_id: &str) -> Option<TaskState> {
        executor::get_task(task_id).await
    }

    /// 获取用户的所有任务
    pub async fn get_user_tasks(&self, user_id: i32) -> Vec<TaskState> {
        executor::get_user_tasks(user_id).await
    }

    /// 提取任务最终结果
    /// 改进：对于多步骤任务，合并所有相关结果
    fn extract_final_result(&self, task_state: &TaskState) -> serde_json::Value {
        // 找到所有成功的步骤结果
        let mut results: Vec<_> = task_state
            .step_results
            .values()
            .filter(|r| r.success)
            .collect();

        results.sort_by_key(|r| &r.step_id);

        // 如果只有一个结果，直接返回
        if results.len() <= 1 {
            return results
                .last()
                .and_then(|r| r.output.clone())
                .unwrap_or(json!({
                    "status": format!("{:?}", task_state.status),
                    "progress": task_state.progress
                }));
        }

        // ⭐ 关键改进：收集所有步骤中的 frontendAction 和 action
        let mut all_frontend_actions: Vec<Value> = Vec::new();
        for result in &results {
            if let Some(output) = &result.output {
                // 检查 frontendAction
                if let Some(action) = output.get("frontendAction") {
                    all_frontend_actions.push(action.clone());
                    tracing::info!(
                        step_id = %result.step_id,
                        action_type = ?action.get("type"),
                        "[Agent] Collected frontendAction from step"
                    );
                }
                // 🔴 也检查 action 字段（兼容 brew.generateReadingList 等）
                if let Some(action) = output.get("action") {
                    all_frontend_actions.push(action.clone());
                    tracing::info!(
                        step_id = %result.step_id,
                        action_type = ?action.get("type"),
                        "[Agent] Collected action from step"
                    );
                }
            }
        }

        // 多步骤结果：检查是否有分析/总结类型的最终结果
        let last_result = results.last().and_then(|r| r.output.as_ref());

        // 如果最后一步是分析/总结，检查是否有实际内容
        if let Some(last) = last_result {
            // 检查是否是 AI 分析结果
            if let Some(analysis) = last.get("analysis").and_then(|a| a.as_str()) {
                if !analysis.is_empty() {
                    // 合并搜索结果和分析结果
                    let mut combined = json!({
                        "analysis": analysis,
                        "type": last.get("type").and_then(|t| t.as_str()).unwrap_or("general")
                    });

                    // 收集所有搜索步骤的来源信息
                    let mut sources = Vec::new();
                    for result in &results {
                        if let Some(output) = &result.output {
                            // 检查是否是联网搜索结果
                            if output.get("source").is_some() {
                                if let Some(query) = output.get("query").and_then(|q| q.as_str()) {
                                    sources.push(json!({
                                        "query": query,
                                        "source": output.get("source")
                                    }));
                                }
                            }
                            // 检查是否有 aiSummary
                            if let Some(summary) = output.get("aiSummary").and_then(|s| s.as_str())
                            {
                                if !summary.is_empty() && combined.get("searchSummary").is_none() {
                                    combined["searchSummary"] = json!(summary);
                                }
                            }
                        }
                    }

                    if !sources.is_empty() {
                        combined["sources"] = json!(sources);
                    }

                    // ⭐ 添加所有收集到的 frontendActions
                    if !all_frontend_actions.is_empty() {
                        combined["frontendActions"] = json!(all_frontend_actions);
                    }

                    return combined;
                }
            }

            // 检查是否是 AI 总结结果
            if let Some(summary) = last.get("summary").and_then(|s| s.as_str()) {
                if !summary.is_empty() {
                    let mut result = last.clone();
                    // ⭐ 添加所有收集到的 frontendActions
                    if !all_frontend_actions.is_empty() {
                        result["frontendActions"] = json!(all_frontend_actions);
                        tracing::info!(
                            count = all_frontend_actions.len(),
                            "[Agent] Merged {} frontendActions into summary result",
                            all_frontend_actions.len()
                        );
                    }
                    return result;
                }
            }
        }

        // 默认返回最后一个结果
        let mut final_result = results
            .last()
            .and_then(|r| r.output.clone())
            .unwrap_or(json!({
                "status": format!("{:?}", task_state.status),
                "progress": task_state.progress
            }));

        // ⭐ 添加所有收集到的 frontendActions
        if !all_frontend_actions.is_empty() {
            final_result["frontendActions"] = json!(all_frontend_actions);
            tracing::info!(
                count = all_frontend_actions.len(),
                "[Agent] Merged {} frontendActions into default final result",
                all_frontend_actions.len()
            );
        }

        final_result
    }

    /// 从执行结果中提取前端动作
    fn extract_frontend_action(&self, result: &Value) -> Option<FrontendAction> {
        // 检查 frontendAction（单个）
        if let Some(action) = result.get("frontendAction") {
            tracing::debug!(
                action = %action,
                "[Agent] Found frontendAction in result, attempting to deserialize"
            );
            match serde_json::from_value::<FrontendAction>(action.clone()) {
                Ok(frontend_action) => {
                    tracing::info!(
                        action_type = %frontend_action.action_type,
                        "[Agent] Successfully deserialized frontendAction"
                    );
                    return Some(frontend_action);
                }
                Err(e) => {
                    tracing::error!(
                        error = %e,
                        action = %action,
                        "[Agent] Failed to deserialize frontendAction"
                    );
                }
            }
        }

        // 🔴 也检查 "action" 字段（兼容 brew.generateReadingList 等返回格式）
        if let Some(action) = result.get("action") {
            tracing::debug!(
                action = %action,
                "[Agent] Found action in result, attempting to deserialize"
            );
            match serde_json::from_value::<FrontendAction>(action.clone()) {
                Ok(frontend_action) => {
                    tracing::info!(
                        action_type = %frontend_action.action_type,
                        has_payload = frontend_action.payload.is_some(),
                        has_criteria = frontend_action.criteria.is_some(),
                        "[Agent] Successfully deserialized action as frontendAction"
                    );
                    // 如果有 criteria 在顶层，也尝试提取
                    let mut final_action = frontend_action;
                    if final_action.criteria.is_none() {
                        if let Some(criteria) = result.get("criteria").and_then(|v| v.as_str()) {
                            final_action.criteria = Some(criteria.to_string());
                        }
                    }
                    return Some(final_action);
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "[Agent] Failed to deserialize action field"
                    );
                }
            }
        }

        // 检查 frontendActions（数组）- 返回第一个
        if let Some(actions) = result.get("frontendActions").and_then(|v| v.as_array()) {
            if let Some(first_action) = actions.first() {
                if let Ok(frontend_action) =
                    serde_json::from_value::<FrontendAction>(first_action.clone())
                {
                    return Some(frontend_action);
                }
            }
        }

        // 检查 plan.steps（AI 分析生成的步骤）- 如果 autoExecute 或需要自动执行
        if let Some(plan) = result.get("plan") {
            if let (Some(true), Some(steps)) = (
                plan.get("canFulfill").and_then(|v| v.as_bool()),
                plan.get("steps").and_then(|v| v.as_array()),
            ) {
                if let Some(first_step) = steps.first() {
                    let action_type = first_step
                        .get("actionType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("click");

                    let timestamp = chrono::Utc::now().timestamp_millis();

                    return match action_type {
                        "navigate" => {
                            let path = first_step
                                .get("path")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());

                            Some(FrontendAction {
                                action_type: "navigate".to_string(),
                                target: None,
                                tapp_id: None,
                                window_id: None,
                                script: None,
                                timestamp,
                                data: None,
                                path,
                                params: None,
                                query: None,
                                full_path: None,
                                replace: None,
                                action: None,
                                scroll_options: None,
                                wait_for: None,
                                payload: None,
                                criteria: None,
                            })
                        }
                        _ => {
                            let target = first_step.get("target").and_then(|t| {
                                serde_json::from_value::<PageElementTarget>(t.clone()).ok()
                            });

                            Some(FrontendAction {
                                action_type: "page_interact".to_string(),
                                target,
                                tapp_id: None,
                                window_id: None,
                                script: None,
                                timestamp,
                                data: None,
                                path: None,
                                params: None,
                                query: None,
                                full_path: None,
                                replace: None,
                                action: Some(action_type.to_string()),
                                scroll_options: None,
                                wait_for: None,
                                payload: None,
                                criteria: None,
                            })
                        }
                    };
                }
            }
        }

        None
    }

    /// 智能推断数据展示类型
    fn infer_data_display(&self, data: &Value, intent: &ParsedIntent) -> Option<DataDisplayHint> {
        // 根据数据结构和意图类型推断最佳展示方式
        match data {
            Value::Array(arr) if !arr.is_empty() => {
                // 数组数据，检查元素结构
                if let Some(Value::Object(obj)) = arr.first() {
                    // 根据字段推断展示类型
                    let fields: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();

                    // 检测时间线数据
                    if fields
                        .iter()
                        .any(|f| f.contains("time") || f.contains("date") || f.contains("created"))
                        && fields.iter().any(|f| {
                            f.contains("title") || f.contains("content") || f.contains("message")
                        })
                    {
                        let time_field = fields
                            .iter()
                            .find(|f| {
                                f.contains("time") || f.contains("date") || f.contains("created")
                            })
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "time".to_string());
                        let content_field = fields
                            .iter()
                            .find(|f| {
                                f.contains("title") || f.contains("content") || f.contains("name")
                            })
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "content".to_string());
                        return Some(DataDisplayHint::Timeline {
                            time_field,
                            content_field,
                        });
                    }

                    // 检测卡片列表数据（有标题和可能的图片）
                    if fields
                        .iter()
                        .any(|f| f.contains("title") || f.contains("name"))
                    {
                        let title_field = fields
                            .iter()
                            .find(|f| f.contains("title") || f.contains("name"))
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "title".to_string());
                        let description_field = fields
                            .iter()
                            .find(|f| {
                                f.contains("desc") || f.contains("summary") || f.contains("content")
                            })
                            .map(|s| s.to_string());
                        let image_field = fields
                            .iter()
                            .find(|f| {
                                f.contains("image")
                                    || f.contains("cover")
                                    || f.contains("thumbnail")
                            })
                            .map(|s| s.to_string());

                        return Some(DataDisplayHint::CardList {
                            title_field,
                            description_field,
                            image_field,
                        });
                    }

                    // 默认表格展示
                    let columns: Vec<ColumnDef> = fields
                        .iter()
                        .take(6) // 最多显示6列
                        .map(|f| ColumnDef {
                            field: f.to_string(),
                            title: humanize_field_name(f),
                            width: None,
                            sortable: true,
                        })
                        .collect();

                    return Some(DataDisplayHint::Table {
                        columns,
                        data_path: None,
                    });
                }
            }
            Value::Object(obj) => {
                // 对象数据
                let fields: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();

                // 特殊处理：如果有 aiSummary，使用 Markdown 展示
                if obj.contains_key("aiSummary") {
                    if let Some(summary) = obj.get("aiSummary").and_then(|v| v.as_str()) {
                        if !summary.is_empty() {
                            return Some(DataDisplayHint::Markdown);
                        }
                    }
                }

                // 特殊处理：如果有 analysis，使用 Markdown 展示
                if obj.contains_key("analysis") {
                    if let Some(analysis) = obj.get("analysis").and_then(|v| v.as_str()) {
                        if !analysis.is_empty() {
                            return Some(DataDisplayHint::Markdown);
                        }
                    }
                }

                // 特殊处理：联网搜索结果（没有 aiSummary 时）
                if obj.contains_key("source") && obj.contains_key("results") {
                    // 如果有 aiSummary 但上面已经处理，这里处理纯搜索结果
                    if let Some(Value::Array(results)) = obj.get("results") {
                        if !results.is_empty() && results.len() > 1 {
                            // 多个搜索结果展示为卡片列表
                            return Some(DataDisplayHint::CardList {
                                title_field: "name".to_string(),
                                description_field: Some("description".to_string()),
                                image_field: None,
                            });
                        }
                    }
                }

                // 检测内嵌数组（如 { items: [...] }）
                for (key, value) in obj.iter() {
                    if let Value::Array(arr) = value {
                        if !arr.is_empty() {
                            if let Some(Value::Object(inner)) = arr.first() {
                                let inner_fields: Vec<&str> =
                                    inner.keys().map(|k| k.as_str()).collect();
                                let columns: Vec<ColumnDef> = inner_fields
                                    .iter()
                                    .take(6)
                                    .map(|f| ColumnDef {
                                        field: f.to_string(),
                                        title: humanize_field_name(f),
                                        width: None,
                                        sortable: true,
                                    })
                                    .collect();

                                return Some(DataDisplayHint::Table {
                                    columns,
                                    data_path: Some(key.clone()),
                                });
                            }
                        }
                    }
                }

                // 检测 Markdown 内容
                if obj.contains_key("markdown") || obj.contains_key("content") {
                    if let Some(Value::String(s)) =
                        obj.get("markdown").or_else(|| obj.get("content"))
                    {
                        if s.contains('#') || s.contains('*') || s.contains('`') {
                            return Some(DataDisplayHint::Markdown);
                        }
                    }
                }

                // 检测图表数据
                if obj.contains_key("chartData") || obj.contains_key("series") {
                    return Some(DataDisplayHint::Chart {
                        chart_type: ChartType::Line,
                        x_field: "x".to_string(),
                        y_field: "y".to_string(),
                    });
                }

                // 默认键值对展示
                if fields.len() <= 10 {
                    return Some(DataDisplayHint::KeyValue);
                }
            }
            Value::String(s) => {
                // 检测 Markdown
                if s.contains('#') || s.contains('*') || s.contains('`') || s.contains('\n') {
                    return Some(DataDisplayHint::Markdown);
                }
            }
            _ => {}
        }

        // 根据意图类型提供默认展示
        match intent.action {
            IntentAction::Summarize | IntentAction::Analyze => Some(DataDisplayHint::Markdown),
            _ => None,
        }
    }

    /// 生成响应消息
    fn generate_response_message(&self, intent: &ParsedIntent, task_state: &TaskState) -> String {
        if task_state.status == TaskStatus::Failed {
            return format!(
                "执行失败：{}",
                task_state.error.as_ref().unwrap_or(&"未知错误".to_string())
            );
        }

        // 提取最终结果
        let result = self.extract_final_result(task_state);

        // 1. 优先检查是否有 AI 生成的摘要/分析内容
        // 这是最重要的结果，应该直接展示给用户
        if let Some(ai_summary) = result.get("aiSummary").and_then(|v| v.as_str()) {
            if !ai_summary.is_empty() {
                // AI 摘要通常是 Markdown 格式，直接返回
                return ai_summary.to_string();
            }
        }

        // 2. 检查是否有 AI 分析结果
        if let Some(analysis) = result.get("analysis").and_then(|v| v.as_str()) {
            if !analysis.is_empty() {
                return analysis.to_string();
            }
        }

        // 3. 检查是否有 AI 总结结果
        if let Some(summary) = result.get("summary").and_then(|v| v.as_str()) {
            if !summary.is_empty() {
                return summary.to_string();
            }
        }

        // 4. 如果没有 AI 生成的内容，才显示搜索结果统计
        if let Some(source) = result.get("source").and_then(|v| v.as_str()) {
            if source == "gemini_grounding" || source == "google_search" || source == "local_cache"
            {
                if let Some(results) = result.get("results").and_then(|v| v.as_array()) {
                    if results.is_empty() {
                        return "搜索完成，但未找到相关结果。".to_string();
                    }
                    let query = result.get("query").and_then(|v| v.as_str()).unwrap_or("");
                    return format!(
                        "找到 {} 条关于「{}」的相关信息，详情请查看下方结果。",
                        results.len(),
                        query
                    );
                }
            }
        }

        // 5. 默认消息
        match &intent.action {
            IntentAction::Query => "查询完成，以下是结果".to_string(),
            IntentAction::Summarize => "以下是内容总结".to_string(),
            IntentAction::Analyze => "分析完成，以下是结果".to_string(),
            IntentAction::Recommend => "基于你的数据，我推荐以下内容".to_string(),
            IntentAction::Compare => "比较分析完成".to_string(),
            _ => "任务已完成".to_string(),
        }
    }

    /// 生成后续建议
    fn generate_suggestions(&self, intent: &ParsedIntent) -> Vec<String> {
        let mut suggestions = vec![];

        match &intent.action {
            IntentAction::Query => {
                suggestions.push("查看更多详情".to_string());
                suggestions.push("导出数据".to_string());
                suggestions.push("生成报告".to_string());
            }
            IntentAction::Summarize => {
                suggestions.push("查看详细内容".to_string());
                suggestions.push("分析趋势".to_string());
            }
            IntentAction::Analyze => {
                suggestions.push("生成可视化图表".to_string());
                suggestions.push("导出分析报告".to_string());
            }
            _ => {
                suggestions.push("继续查询".to_string());
            }
        }

        // 根据目标添加建议
        match &intent.target {
            IntentTarget::Platform(platform) => {
                suggestions.push(format!("查看 {} 的其他数据", platform));
            }
            IntentTarget::Report(_) => {
                suggestions.push("分享报告".to_string());
            }
            _ => {}
        }

        suggestions
    }

    /// 生成创建类任务的建议
    fn generate_creation_suggestions(&self, intent: &ParsedIntent) -> Vec<String> {
        match &intent.target {
            IntentTarget::Tapp(_) => vec![
                "安装此 Tapp".to_string(),
                "预览效果".to_string(),
                "修改代码".to_string(),
                "重新生成".to_string(),
            ],
            IntentTarget::Report(_) => vec![
                "下载报告".to_string(),
                "分享报告".to_string(),
                "定期生成".to_string(),
            ],
            _ => vec!["查看结果".to_string(), "继续操作".to_string()],
        }
    }

    /// 静态版本的建议生成（用于 fallback）
    /// 获取用户待确认的操作列表
    #[allow(dead_code)]
    pub async fn get_pending_confirmations(&self, user_id: i32) -> Vec<ConfirmationRequest> {
        let store = PENDING_CONFIRMATIONS.read().await;
        store
            .values()
            .filter(|p| p.user_id == user_id)
            .map(|p| p.request.clone())
            .collect()
    }
}

/// 获取系统能力摘要
pub async fn get_capabilities_summary() -> serde_json::Value {
    capability::get_capability_summary().await
}

/// 初始化任务存储的数据库连接
///
/// 应在应用启动时调用，以支持任务持久化和恢复
#[allow(dead_code)]
pub async fn init_task_store(db: DatabaseConnection) {
    executor::init_task_store_db(db).await;
}

/// 清理过期的确认请求
#[allow(dead_code)]
pub async fn cleanup_expired_confirmations() {
    let now = Utc::now();
    let mut store = PENDING_CONFIRMATIONS.write().await;

    let expired: Vec<String> = store
        .iter()
        .filter(|(_, v)| v.request.expires_at < now)
        .map(|(k, _)| k.clone())
        .collect();

    for id in expired {
        tracing::debug!(confirmation_id = %id, "[Agent] Cleaning up expired confirmation");
        store.remove(&id);
    }
}

/// 获取待确认操作的数量
#[allow(dead_code)]
pub async fn get_pending_confirmation_count() -> usize {
    PENDING_CONFIRMATIONS.read().await.len()
}

/// 将字段名转换为用户友好的标题
fn humanize_field_name(field: &str) -> String {
    // 常见字段名映射
    let mappings: &[(&str, &str)] = &[
        ("id", "ID"),
        ("title", "标题"),
        ("name", "名称"),
        ("content", "内容"),
        ("description", "描述"),
        ("desc", "描述"),
        ("summary", "摘要"),
        ("time", "时间"),
        ("date", "日期"),
        ("created_at", "创建时间"),
        ("updated_at", "更新时间"),
        ("author", "作者"),
        ("platform", "平台"),
        ("status", "状态"),
        ("progress", "进度"),
        ("count", "数量"),
        ("price", "价格"),
        ("url", "链接"),
        ("image", "图片"),
        ("cover", "封面"),
        ("thumbnail", "缩略图"),
        ("views", "浏览量"),
        ("likes", "点赞数"),
        ("comments", "评论数"),
        ("duration", "时长"),
        ("category", "分类"),
        ("tags", "标签"),
    ];

    // 查找映射
    for (key, label) in mappings {
        if field.to_lowercase() == *key || field.to_lowercase().ends_with(&format!("_{}", key)) {
            return label.to_string();
        }
    }

    // 默认处理：将 snake_case 或 camelCase 转换为空格分隔
    let mut result = String::new();
    for (i, c) in field.chars().enumerate() {
        if c == '_' {
            result.push(' ');
        } else if c.is_uppercase() && i > 0 {
            result.push(' ');
            result.push(c);
        } else if i == 0 {
            result.push(c.to_ascii_uppercase());
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_intent_action_from_verb() {
        assert!(matches!(
            IntentAction::from_verb("总结"),
            IntentAction::Summarize
        ));
        assert!(matches!(
            IntentAction::from_verb("分析"),
            IntentAction::Analyze
        ));
        assert!(matches!(
            IntentAction::from_verb("create"),
            IntentAction::Create
        ));
    }
}
