//! Agent 模块
//!
//! AI 驱动的自然语言任务编排系统
//!
//! ## 架构（两层：Planner → Executor）
//!
//! ```text
//! 用户输入 ──▶ Planner (Pro AI) ──▶ PlannerOutput
//!                                        │
//!                          ┌──────────────┼──────────────┐
//!                          │              │              │
//!                       Chat          Clarify         Plan
//!                          │              │              │
//!                          ▼              ▼              ▼
//!                    直接回复        请求澄清      Recipe Steps
//!                                                       │
//!                                                       ▼
//!                                              ConfirmationCheck
//!                                                       │
//!                                                       ▼
//!                                                  Executor ──▶ Result
//!                                                       │
//!                                                       ▼
//!                                              EscalationManager
//!                                                (Planner.replan)
//! ```
//!
//! ## 模块
//!
//! - `types`: 核心类型定义
//! - `capability`: 能力注册表
//! - `planner`: 规划器（Pro AI 单次调用完成意图理解+执行规划）
//! - `recipe`: 方案验证与转换
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
pub mod heartbeat;
pub mod identity;
pub mod intent;
pub mod mcp;
pub mod memory;
pub mod notifications;
pub mod orchestrator;
pub mod planner;
pub mod queue;
pub mod recipe;
pub mod routing;
pub mod skill;
pub mod skill_evolution;
pub mod tier_router;
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

/// 全局 Lane Queue（控制并发和用户级串行）
pub static LANE_QUEUE: Lazy<Arc<queue::LaneQueue>> =
    Lazy::new(|| Arc::new(queue::LaneQueue::new(4)));

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
    /// 原始 PlannerOutput（用于升级重规划）
    pub planner_output: PlannerOutput,
}

/// Agent 主入口
///
/// 两层架构：Planner (Pro AI) → Executor
pub struct Agent {
    /// 规划器（Pro AI 单次调用）
    planner: planner::Planner,
    /// 执行引擎
    executor: executor::Executor,
}

impl Agent {
    /// 创建新的 Agent 实例
    pub async fn new(db: DatabaseConnection) -> Self {
        Self {
            planner: planner::Planner::new().await,
            executor: executor::Executor::new(db).await,
        }
    }

    /// 处理用户请求
    ///
    /// 两层流程：
    /// 1. Planner 规划（Pro AI 单次调用）
    /// 2. 根据 PlannerOutput.status 分流
    /// 3. 执行 Recipe
    /// 4. 升级重试（如需要）
    pub async fn process(&self, request: UserRequest) -> Result<AgentResponse, String> {
        let user_id = request.user_id;

        // 请求驱动的过期任务清理
        executor::maybe_cleanup_tasks().await;

        tracing::info!(
            user_id = user_id,
            input = %request.raw_input,
            "[Agent] Processing request"
        );

        // 1. Planner 规划
        let planner_output = self.planner.plan(&request).await?;

        tracing::debug!(
            status = ?planner_output.status,
            confidence = planner_output.confidence,
            steps = planner_output.steps.len(),
            "[Agent] Planner output"
        );

        // 2. 根据状态分流
        match planner_output.status {
            PlannerStatus::Chat => {
                return Ok(AgentResponse {
                    response_type: AgentResponseType::Answer,
                    message: planner_output.chat_reply.unwrap_or_else(|| "你好！有什么我可以帮你的吗？".to_string()),
                    data: Some(json!({ "type": "chat" })),
                    data_display: None,
                    suggestions: vec![],
                    task: None,
                    confirmation: None,
                    frontend_action: None,
                });
            }
            PlannerStatus::Clarify => {
                let clarification = planner_output.clarification.unwrap_or(PlannerClarification {
                    message: "我需要更多信息来理解你的请求".to_string(),
                    options: vec![],
                });
                return Ok(AgentResponse {
                    response_type: AgentResponseType::Clarification,
                    message: clarification.message.clone(),
                    data: Some(json!({
                        "confidence": planner_output.confidence,
                        "clarification": {
                            "message": clarification.message,
                            "options": clarification.options
                        }
                    })),
                    data_display: None,
                    suggestions: clarification.options,
                    task: None,
                    confirmation: None,
                    frontend_action: None,
                });
            }
            PlannerStatus::Unsupported => {
                let reason = planner_output.unsupported_reason.unwrap_or_else(|| "不支持此操作".to_string());

                // 记录能力缺口
                if let Some(evo) = skill_evolution::get_skill_evolution() {
                    evo.detect_capability_gap(&request.raw_input, &reason).await;
                }

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
            PlannerStatus::Plan => {
                // 继续执行流程
            }
        }

        // 3. 转换步骤为 Recipe
        let cap_ids: Vec<String> = planner_output.steps.iter().map(|s| s.capability_id.clone()).collect();
        let cap_schemas = capability::get_capabilities_by_ids(&cap_ids).await;
        let recipe_steps = recipe::validate_and_convert_steps(
            planner_output.steps.clone(),
            planner_output.reasoning.clone(),
            &cap_schemas,
        )?;

        let recipe = Self::build_recipe_from_steps(
            recipe_steps,
            planner_output.reasoning.clone().unwrap_or_else(|| request.raw_input.clone()),
            &request,
        );

        // 4. 检查敏感操作
        let sensitive_steps = self.check_sensitive_steps(&recipe).await;
        if !sensitive_steps.is_empty() {
            return self
                .request_confirmation_v2(&recipe, &planner_output, user_id, sensitive_steps)
                .await;
        }

        // 5. 执行方案
        let task_state = self.executor.execute(&recipe, user_id).await?;
        let result = self.extract_final_result(&task_state);

        // 6. 记录交互日志 + 会话记忆归档
        if let Some(mem) = memory::get_memory() {
            let ok = task_state.status == TaskStatus::Completed;
            let summary = format!(
                "plan/{} steps → {}",
                planner_output.steps.len(),
                if ok { "ok" } else { "err" }
            );
            mem.log_daily(user_id, &summary).await;

            if ok {
                let interaction = format!(
                    "用户请求「{}」→ 执行 {} 步骤",
                    request.raw_input, planner_output.steps.len()
                );
                mem.remember(&interaction, memory::MemoryType::Interaction)
                    .await;
            }
        }

        // 7. 构建响应
        let frontend_action = self.extract_frontend_action(&result);
        let data_display = self.infer_data_display_v2(&result, &planner_output);

        Ok(AgentResponse {
            response_type: AgentResponseType::Answer,
            message: self.generate_response_message_v2(&planner_output, &task_state, None).await,
            data: Some(result),
            data_display,
            suggestions: vec![],
            task: Some(task_state),
            confirmation: None,
            frontend_action,
        })
    }

    /// 处理用户请求（带实时进度回调）
    ///
    /// 与 process 相同的两层逻辑，但会通过 channel 发送进度更新
    pub async fn process_with_progress(
        &self,
        request: UserRequest,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    ) -> Result<AgentResponse, String> {
        let user_id = request.user_id;

        tracing::info!(
            user_id = user_id,
            input = %request.raw_input,
            has_history = request.context.as_ref().and_then(|c| c.conversation_history.as_ref()).is_some(),
            "[Agent] Processing request with progress tracking"
        );

        // 1. Planner 规划（Pro AI 单次调用）
        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 5,
                completed_steps: 0,
                total_steps: 0,
                message: "正在理解你的请求...".to_string(),
            })
            .await;

        let planner_output = self.planner.plan(&request).await?;

        tracing::debug!(
            status = ?planner_output.status,
            confidence = planner_output.confidence,
            steps = planner_output.steps.len(),
            "[Agent] Planner output"
        );

        // 2. 根据状态分流
        match planner_output.status {
            PlannerStatus::Chat => {
                let reply = planner_output.chat_reply.unwrap_or_else(|| "你好！有什么我可以帮你的吗？".to_string());
                let _ = progress_tx
                    .send(AgentProgressEvent::Progress {
                        progress: 100,
                        completed_steps: 1,
                        total_steps: 1,
                        message: "完成".to_string(),
                    })
                    .await;
                return Ok(AgentResponse {
                    response_type: AgentResponseType::Answer,
                    message: reply.clone(),
                    data: Some(json!({ "reply": reply, "type": "chat" })),
                    data_display: None,
                    suggestions: vec![],
                    task: None,
                    confirmation: None,
                    frontend_action: None,
                });
            }
            PlannerStatus::Clarify => {
                let clarification = planner_output.clarification.unwrap_or(PlannerClarification {
                    message: "我需要更多信息来理解你的请求".to_string(),
                    options: vec![],
                });
                return Ok(AgentResponse {
                    response_type: AgentResponseType::Clarification,
                    message: clarification.message.clone(),
                    data: Some(json!({
                        "confidence": planner_output.confidence,
                        "clarification": {
                            "message": clarification.message,
                            "options": clarification.options
                        }
                    })),
                    data_display: None,
                    suggestions: clarification.options,
                    task: None,
                    confirmation: None,
                    frontend_action: None,
                });
            }
            PlannerStatus::Unsupported => {
                let reason = planner_output.unsupported_reason.unwrap_or_else(|| "不支持此操作".to_string());

                // 记录能力缺口
                if let Some(evo) = skill_evolution::get_skill_evolution() {
                    evo.detect_capability_gap(&request.raw_input, &reason).await;
                }

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
            PlannerStatus::Plan => {
                // 继续执行流程
            }
        }

        // 3. 转换步骤为 Recipe
        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 15,
                completed_steps: 0,
                total_steps: 0,
                message: "正在规划执行步骤...".to_string(),
            })
            .await;

        let cap_ids: Vec<String> = planner_output.steps.iter().map(|s| s.capability_id.clone()).collect();
        let cap_schemas = capability::get_capabilities_by_ids(&cap_ids).await;
        let recipe_steps = recipe::validate_and_convert_steps(
            planner_output.steps.clone(),
            planner_output.reasoning.clone(),
            &cap_schemas,
        )?;

        let mut recipe = Self::build_recipe_from_steps(
            recipe_steps,
            planner_output.reasoning.clone().unwrap_or_else(|| request.raw_input.clone()),
            &request,
        );

        // 3.5 多 Agent 协作分析（Orchestrator）
        let (assignment, role_groups) = orchestrator::Orchestrator::analyze_recipe(&recipe);

        // 获取角色身份上下文并注入 Recipe metadata
        let role_contexts = orchestrator::Orchestrator::get_role_contexts(&recipe).await;
        if !role_contexts.is_empty() {
            let ctx_map: serde_json::Map<String, Value> = role_contexts
                .iter()
                .map(|(role, ctx)| (format!("{:?}", role), Value::String(ctx.clone())))
                .collect();
            recipe.metadata.insert(
                "role_contexts".to_string(),
                Value::Object(ctx_map),
            );
        }

        if assignment.is_multi_agent {
            tracing::info!(
                agents = assignment.total_agents,
                tier_mix = %assignment.tier_mix,
                parallel = orchestrator::Orchestrator::can_parallelize(&role_groups),
                "[Agent] Multi-agent collaboration: {} agents, {} role groups",
                assignment.total_agents,
                role_groups.len()
            );
            let _ = progress_tx
                .send(AgentProgressEvent::TaskAssigned {
                    task_id: recipe.id.clone(),
                    assignment: Box::new(assignment.clone()),
                })
                .await;
            // 发送多 Agent 协作通知
            orchestrator::Orchestrator::notify_multi_agent_start(&assignment, &recipe.id).await;
        }

        // ========== 快速路径优化 ==========
        let is_simple_query = recipe.steps.len() == 1
            && !self.is_sensitive_capability(&recipe.steps[0].capability_id);

        if is_simple_query {
            tracing::debug!(
                recipe_id = %recipe.id,
                "[Agent] Using fast path for simple query"
            );
            return self
                .execute_simple_query_v2(&recipe, &planner_output, user_id, progress_tx)
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
                .request_confirmation_v2(&recipe, &planner_output, user_id, sensitive_steps)
                .await;
        }

        // 5. 执行方案（带进度回调和升级）
        let result = self
            .execute_recipe_with_progress_v2(&recipe, &planner_output, &request, user_id, progress_tx.clone())
            .await;

        // 5.5 Orchestrator 结果摘要（多 Agent 时）
        if assignment.is_multi_agent {
            let orch_result = orchestrator::OrchestratorResult {
                total_steps: recipe.steps.len(),
                successful_steps: if result.is_ok() { recipe.steps.len() } else { 0 },
                participating_roles: role_groups.iter().map(|g| g.role.display_name().to_string()).collect(),
                used_parallel: orchestrator::Orchestrator::can_parallelize(&role_groups),
                role_summaries: role_groups.iter().map(|g| orchestrator::RoleSummary {
                    role: g.role.display_name().to_string(),
                    icon: g.role.icon().to_string(),
                    steps_count: g.step_indices.len(),
                    success_count: if result.is_ok() { g.step_indices.len() } else { 0 },
                    identity_used: true,
                }).collect(),
            };
            orchestrator::Orchestrator::notify_multi_agent_complete(&orch_result, &recipe.id).await;
        }

        // 5.7 Skill 自动创建（成功的多步骤 Recipe → 可复用 Skill）
        if result.is_ok() && recipe.steps.len() >= 2 {
            if let Some(evolution) = skill_evolution::get_skill_evolution() {
                let evo = evolution.clone();
                let request_text = request.raw_input.clone();
                let recipe_name = recipe.name.clone();
                let step_caps: Vec<String> = recipe.steps.iter()
                    .map(|s| s.capability_id.clone())
                    .collect();
                let step_descriptions: String = recipe.steps.iter()
                    .enumerate()
                    .map(|(i, s)| format!("{}. {} ({})", i + 1, s.action, s.capability_id))
                    .collect::<Vec<_>>()
                    .join("\n");

                tokio::spawn(async move {
                    let triggers: Vec<String> = request_text
                        .split_whitespace()
                        .filter(|w| w.len() >= 2)
                        .take(3)
                        .map(|s| s.to_string())
                        .collect();
                    if triggers.is_empty() { return; }

                    let instructions = format!(
                        "执行「{}」的标准流程：\n\n{}\n",
                        recipe_name, step_descriptions
                    );
                    match evo.auto_create_skill(
                        &recipe_name,
                        &format!("自动从成功任务生成: {}", request_text.chars().take(40).collect::<String>()),
                        &triggers, "auto", &instructions, &step_caps,
                    ).await {
                        Ok(skill) => tracing::info!(skill_id = %skill.id, "[Agent] Auto-created skill from recipe"),
                        Err(e) => tracing::debug!(error = %e, "[Agent] Skill auto-creation skipped"),
                    }
                });
            }
        }

        // 6. 记录交互日志 + 会话记忆归档
        if let Some(mem) = memory::get_memory() {
            let ok = result.is_ok();
            let summary = format!(
                "plan/{} steps → {}",
                planner_output.steps.len(),
                if ok { "ok" } else { "err" }
            );
            mem.log_daily(user_id, &summary).await;

            if ok {
                let interaction = format!(
                    "用户请求「{}」→ 执行 {} 步骤",
                    request.raw_input, planner_output.steps.len()
                );
                mem.remember(&interaction, memory::MemoryType::Interaction)
                    .await;
            }

            // 会话摘要归档（当对话历史足够长时）
            if let Some(ref ctx) = request.context {
                if let Some(ref history) = ctx.conversation_history {
                    if history.len() >= 4 {
                        let session_summary = format!(
                            "会话主题：{} | 执行了 {} 步骤 | 结果：{}",
                            &request.raw_input.chars().take(50).collect::<String>(),
                            planner_output.steps.len(),
                            if ok { "成功" } else { "失败" }
                        );
                        mem.consolidate_session(&session_summary).await;
                    }
                }
            }

            // 定期提升高频记忆 + 清理过期短期记忆
            mem.promote_memories().await;
            mem.cleanup_short_term().await;
        }

        result
    }

    /// 执行配方（带进度回调和升级）— v2 使用 Planner
    async fn execute_recipe_with_progress_v2(
        &self,
        recipe: &Recipe,
        planner_output: &PlannerOutput,
        original_request: &UserRequest,
        user_id: i32,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    ) -> Result<AgentResponse, String> {
        // 执行 Recipe
        let task_state = self
            .executor
            .execute_with_progress(recipe, user_id, Some(progress_tx.clone()))
            .await?;

        // 提取结果
        let mut result = self.extract_final_result(&task_state);

        // 评估结果是否需要升级（简化版：检查空结果）
        if self.should_escalate(&task_state, &result) {
            tracing::info!("[Agent] Result unsatisfactory, attempting replan");

            let hint = self.build_escalation_hint(&task_state, &result);
            let _ = progress_tx
                .send(AgentProgressEvent::Progress {
                    progress: 50,
                    completed_steps: 0,
                    total_steps: 0,
                    message: format!("正在升级策略：{}", hint),
                })
                .await;

            // 使用 Planner.replan
            match self.planner.replan(original_request, &hint).await {
                Ok(replan_output) if replan_output.status == PlannerStatus::Plan && !replan_output.steps.is_empty() => {
                    let cap_ids: Vec<String> = replan_output.steps.iter().map(|s| s.capability_id.clone()).collect();
                    let cap_schemas = capability::get_capabilities_by_ids(&cap_ids).await;

                    if let Ok(new_steps) = recipe::validate_and_convert_steps(
                        replan_output.steps.clone(),
                        replan_output.reasoning.clone(),
                        &cap_schemas,
                    ) {
                        let new_recipe = Self::build_recipe_from_steps(
                            new_steps,
                            replan_output.reasoning.clone().unwrap_or_else(|| "升级重试".to_string()),
                            original_request,
                        );

                        // 执行升级后的 Recipe
                        let progress_tx_for_summary = progress_tx.clone();
                        let new_task_state = self
                            .executor
                            .execute_with_progress(&new_recipe, user_id, Some(progress_tx))
                            .await?;
                        result = self.extract_final_result(&new_task_state);

                        let frontend_action = self.extract_frontend_action(&result);
                        let data_display = self.infer_data_display_v2(&result, &replan_output);

                        if let Some(obj) = result.as_object_mut() {
                            obj.insert("recipe".to_string(), serde_json::to_value(&new_recipe).unwrap_or_default());
                        }

                        return Ok(AgentResponse {
                            response_type: if new_task_state.status == TaskStatus::Failed { AgentResponseType::Error } else { AgentResponseType::Answer },
                            message: self.generate_response_message_v2(&replan_output, &new_task_state, Some(&progress_tx_for_summary)).await,
                            data: Some(result),
                            data_display,
                            suggestions: vec![],
                            task: Some(new_task_state),
                            confirmation: None,
                            frontend_action,
                        });
                    }
                }
                _ => {
                    tracing::info!("[Agent] Replan failed or returned non-plan, using original result");
                }
            }
        }

        // 返回原始结果
        let frontend_action = self.extract_frontend_action(&result);
        let data_display = self.infer_data_display_v2(&result, planner_output);

        if let Some(obj) = result.as_object_mut() {
            obj.insert("recipe".to_string(), serde_json::to_value(recipe).unwrap_or_default());
        }

        let is_failed = task_state.status == TaskStatus::Failed;
        Ok(AgentResponse {
            response_type: if is_failed { AgentResponseType::Error } else { AgentResponseType::Answer },
            message: self.generate_response_message_v2(planner_output, &task_state, Some(&progress_tx)).await,
            data: Some(result),
            data_display,
            suggestions: vec![],
            task: Some(task_state),
            confirmation: None,
            frontend_action,
        })
    }

    /// 判断是否需要升级
    fn should_escalate(&self, task_state: &TaskState, result: &Value) -> bool {
        if task_state.status == TaskStatus::Failed {
            return true;
        }
        // 使用 ResultEvaluator 进行深度评估（不需要 ParsedIntent，用简化路径）
        let evaluator = escalation::ResultEvaluator::new();
        let eval = evaluator.evaluate_result(result);
        if !eval.is_satisfied {
            tracing::info!(
                score = eval.satisfaction_score,
                reason = ?eval.reason,
                patterns = ?eval.failure_patterns,
                "[Agent] ResultEvaluator: escalation recommended"
            );
        }
        !eval.is_satisfied
    }

    /// 构建升级提示（使用 ResultEvaluator 的失败模式分析）
    fn build_escalation_hint(&self, task_state: &TaskState, result: &Value) -> String {
        if task_state.status == TaskStatus::Failed {
            return format!(
                "前次执行失败：{}。请尝试替代方案。",
                task_state.error.as_deref().unwrap_or("未知错误")
            );
        }

        let evaluator = escalation::ResultEvaluator::new();
        let eval = evaluator.evaluate_result(result);

        let mut hints = Vec::new();
        if let Some(reason) = &eval.reason {
            hints.push(format!("失败原因：{}", reason));
        }
        for hint in &eval.improvement_hints {
            hints.push(hint.clone());
        }
        if eval.suggests_web_search {
            hints.push("请尝试联网搜索能力（ai.webSearch 或 ai.groundingSearch）".to_string());
        }
        if hints.is_empty() {
            "前次执行结果为空或不满足目标，请尝试其他能力或联网搜索。".to_string()
        } else {
            hints.join("。")
        }
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

    /// 快速路径：执行简单的单步查询（v2 — Planner 版）
    async fn execute_simple_query_v2(
        &self,
        recipe: &Recipe,
        planner_output: &PlannerOutput,
        user_id: i32,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    ) -> Result<AgentResponse, String> {
        let step = &recipe.steps[0];
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
        let step_result = task_state.step_results.get(&step.id);
        let (success, output_summary) = step_result
            .map(|r| {
                (
                    r.success,
                    r.output.as_ref().and_then(summarize_output_simple),
                )
            })
            .unwrap_or((false, None));
        let image_url = step_result
            .and_then(|r| r.output.as_ref())
            .and_then(|o| o.as_object())
            .and_then(|obj| obj.get("imageUrl"))
            .and_then(|v| v.as_str())
            .filter(|url| !url.starts_with("pixai://"))
            .map(|s| s.to_string());

        // 发送步骤完成
        let _ = progress_tx
            .send(AgentProgressEvent::StepCompleted {
                step_id: step.id.clone(),
                step_index: 0,
                success,
                duration_ms,
                output_summary,
                image_url,
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
        let data_display = self.infer_data_display_v2(&result, planner_output);

        if let Some(obj) = result.as_object_mut() {
            obj.insert("recipe".to_string(), serde_json::to_value(recipe).unwrap_or_default());
        }

        let is_failed = task_state.status == TaskStatus::Failed;
        Ok(AgentResponse {
            response_type: if is_failed { AgentResponseType::Error } else { AgentResponseType::Answer },
            message: self.generate_response_message_v2(planner_output, &task_state, Some(&progress_tx)).await,
            data: Some(result),
            data_display,
            suggestions: vec![],
            task: Some(task_state),
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

                // 直接执行已确认的配方
                let task_state = self.executor.execute(
                    &pending_confirmation.recipe,
                    pending_confirmation.user_id,
                ).await?;

                let result = self.extract_final_result(&task_state);
                let frontend_action = self.extract_frontend_action(&result);

                Ok(AgentResponse {
                    response_type: AgentResponseType::Answer,
                    message: self.generate_response_message_v2(
                        &pending_confirmation.planner_output,
                        &task_state,
                        None,
                    ).await,
                    data: Some(result),
                    data_display: None,
                    suggestions: vec![],
                    task: Some(task_state),
                    confirmation: None,
                    frontend_action,
                })
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

    /// 请求用户确认（v2 — 使用 PlannerOutput）
    async fn request_confirmation_v2(
        &self,
        recipe: &Recipe,
        planner_output: &PlannerOutput,
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
                    planner_output: planner_output.clone(),
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

    // NOTE: Old execute_recipe / execute_with_escalation / build_response_from_result
    // removed — escalation is now handled by Planner.replan() in execute_recipe_with_progress_v2

    /// 从步骤构建 Recipe
    fn build_recipe_from_steps(
        steps: Vec<RecipeStep>,
        name: String,
        request: &UserRequest,
    ) -> Recipe {
        let estimated_duration_ms: u64 = steps
            .iter()
            .map(|s| s.timeout_ms.unwrap_or(15000))
            .sum();

        let page_context = request
            .context
            .as_ref()
            .and_then(|c| c.custom_data.as_ref())
            .and_then(|d| d.get("pageContent").cloned());

        let conversation_context = request
            .context
            .as_ref()
            .and_then(|c| c.conversation_history.clone());

        let lane_key = request
            .context
            .as_ref()
            .and_then(|c| c.lane_key.clone());

        Recipe {
            id: format!("recipe_{}", uuid::Uuid::new_v4()),
            name,
            original_request: request.raw_input.clone(),
            execution_type: ExecutionType::Instant,
            steps,
            expected_output: OutputFormat::Json,
            estimated_duration_ms,
            created_at: chrono::Utc::now(),
            metadata: HashMap::new(),
            page_context,
            conversation_context,
            lane_key,
        }
    }

    /// 生成响应消息（v2 — Planner 版）
    async fn generate_response_message_v2(
        &self,
        _planner_output: &PlannerOutput,
        task_state: &TaskState,
        progress_tx: Option<&tokio::sync::mpsc::Sender<AgentProgressEvent>>,
    ) -> String {
        if task_state.status == TaskStatus::Failed {
            return format!(
                "执行失败：{}",
                task_state.error.as_ref().unwrap_or(&"未知错误".to_string())
            );
        }

        let result = self.extract_final_result(task_state);

        // 检查 extract_final_result 返回的错误信息
        if let Some(error) = result.get("error").and_then(|v| v.as_str()) {
            if !error.is_empty() {
                return format!("执行失败：{}", error);
            }
        }

        // 优先展示 AI 生成的内容
        if let Some(ai_summary) = result.get("aiSummary").and_then(|v| v.as_str()) {
            if !ai_summary.is_empty() {
                return ai_summary.to_string();
            }
        }
        if let Some(reply) = result.get("reply").and_then(|v| v.as_str()) {
            if !reply.is_empty() {
                return reply.to_string();
            }
        }
        if let Some(analysis) = result.get("analysis").and_then(|v| v.as_str()) {
            if !analysis.is_empty() {
                return analysis.to_string();
            }
        }
        if let Some(summary) = result.get("summary").and_then(|v| v.as_str()) {
            if !summary.is_empty() {
                return summary.to_string();
            }
        }

        // ⭐ 多步骤结果汇总：交给主 Agent AI 流式生成有人格的总结
        let successful_results: Vec<_> = {
            let mut r: Vec<_> = task_state.step_results.values()
                .filter(|r| r.success)
                .collect();
            r.sort_by_key(|r| &r.step_id);
            r
        };
        if successful_results.len() > 1 {
            let summaries: Vec<String> = successful_results.iter()
                .filter_map(|r| {
                    r.output.as_ref().and_then(|o| {
                        executor::utils::summarize_output(o)
                    })
                })
                .filter(|s| !s.starts_with("返回 ") || !s.ends_with(" 个字段"))
                .collect();

            if !summaries.is_empty() {
                // 尝试用 AI 流式生成有人格的汇总消息
                if let Some(msg) = self.summarize_with_personality(&summaries, progress_tx).await {
                    return msg;
                }
                // AI 不可用时回退到拼接
                return summaries.join("\n");
            }
        }

        // 单步骤：能力执行的 message（如音乐控制、路由导航等）
        if let Some(msg) = result.get("message").and_then(|v| v.as_str()) {
            if !msg.is_empty() {
                return msg.to_string();
            }
        }

        // 搜索结果统计
        if let Some(source) = result.get("source").and_then(|v| v.as_str()) {
            if source == "gemini_grounding" || source == "google_search" || source == "local_cache" {
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

        // 图片生成结果：imageUrl 已通过 StepCompleted.image_url 实时推送，只需返回文字说明
        if result.get("imageUrl").and_then(|v| v.as_str()).is_some() {
            let provider = result.get("provider").and_then(|v| v.as_str()).unwrap_or("AI");
            return format!("已通过 {} 生成图片", provider);
        }

        // 检查是否有部分步骤失败，附加失败提示
        let total_steps = task_state.step_results.len();
        let failed_steps: Vec<_> = task_state.step_results.values().filter(|r| !r.success).collect();
        if !failed_steps.is_empty() && failed_steps.len() < total_steps {
            let success_count = total_steps - failed_steps.len();
            let fail_info: Vec<String> = failed_steps.iter()
                .filter_map(|r| r.error.clone())
                .collect();
            let mut msg = format!("部分完成（{}/{}）", success_count, total_steps);
            if !fail_info.is_empty() {
                msg.push_str(&format!("\n失败原因：{}", fail_info.join("；")));
            }
            return msg;
        }

        "任务已完成".to_string()
    }

    /// 用主 Agent 人格风格汇总多步骤执行结果（支持流式推送）
    async fn summarize_with_personality(
        &self,
        step_summaries: &[String],
        progress_tx: Option<&tokio::sync::mpsc::Sender<AgentProgressEvent>>,
    ) -> Option<String> {
        use crate::services::ai::create_ai_analyzer_for_tier;
        use crate::config::ModelTier;

        let analyzer = create_ai_analyzer_for_tier(ModelTier::Standard).await?;

        // 加载 Agent 人格（截断以避免占用过多 token）
        let soul = identity::get_identity().await
            .and_then(|id| id.soul)
            .unwrap_or_default();
        let soul: String = soul.chars().take(2000).collect();

        let steps_text = step_summaries.iter()
            .enumerate()
            .map(|(i, s)| format!("{}. {}", i + 1, s))
            .collect::<Vec<_>>()
            .join("\n");
        let steps_text: String = steps_text.chars().take(3000).collect();

        let prompt = format!(
            "{soul}\n\n\
             You just completed a multi-step task for the user. Here are the results from each step:\n\
             {steps_text}\n\n\
             Write a short, warm, conversational message (1-3 sentences) summarizing what you accomplished. \
             Match the user's language (detect from the step results). \
             Do NOT use bullet points or numbered lists. \
             Do NOT repeat raw technical details — rephrase naturally. \
             Speak as yourself (Arael), like you're talking to a friend.",
            soul = soul,
            steps_text = steps_text,
        );

        // 如果有 progress_tx，使用流式推送让用户实时看到 AI 思考过程
        if let Some(tx) = progress_tx {
            let tx = tx.clone();
            match analyzer.analyze_stream(&prompt, |token| {
                // 发送 token 到前端（阻塞式发送，在异步回调中使用 try_send）
                let _ = tx.try_send(AgentProgressEvent::SummaryToken {
                    token: token.to_string(),
                    done: false,
                });
                true
            }).await {
                Ok(full_text) if !full_text.trim().is_empty() => {
                    // 发送完成标记
                    let _ = tx.try_send(AgentProgressEvent::SummaryToken {
                        token: String::new(),
                        done: true,
                    });
                    Some(full_text.trim().to_string())
                }
                Ok(_) => None,
                Err(e) => {
                    tracing::warn!("[Agent] Streaming personality summary failed, falling back: {}", e);
                    None
                }
            }
        } else {
            // 非流式路径：直接获取完整结果
            match analyzer.analyze(&prompt).await {
                Ok(msg) if !msg.trim().is_empty() => Some(msg.trim().to_string()),
                Ok(_) => None,
                Err(e) => {
                    tracing::warn!("[Agent] Personality summary failed, falling back: {}", e);
                    None
                }
            }
        }
    }

    /// 智能推断数据展示类型（v2 — Planner 版）
    fn infer_data_display_v2(&self, data: &Value, _planner_output: &PlannerOutput) -> Option<DataDisplayHint> {
        // 复用现有的数据结构推断逻辑，但不依赖 ParsedIntent
        match data {
            Value::Array(arr) if !arr.is_empty() => {
                if let Some(Value::Object(obj)) = arr.first() {
                    let fields: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();

                    // 时间线数据
                    if fields.iter().any(|f| f.contains("time") || f.contains("date") || f.contains("created"))
                        && fields.iter().any(|f| f.contains("title") || f.contains("content") || f.contains("message"))
                    {
                        let time_field = fields.iter()
                            .find(|f| f.contains("time") || f.contains("date") || f.contains("created"))
                            .map(|s| s.to_string()).unwrap_or_else(|| "time".to_string());
                        let content_field = fields.iter()
                            .find(|f| f.contains("title") || f.contains("content") || f.contains("name"))
                            .map(|s| s.to_string()).unwrap_or_else(|| "content".to_string());
                        return Some(DataDisplayHint::Timeline { time_field, content_field });
                    }

                    // 卡片列表
                    if fields.iter().any(|f| f.contains("title") || f.contains("name")) {
                        let title_field = fields.iter()
                            .find(|f| f.contains("title") || f.contains("name"))
                            .map(|s| s.to_string()).unwrap_or_else(|| "title".to_string());
                        let description_field = fields.iter()
                            .find(|f| f.contains("desc") || f.contains("summary") || f.contains("content"))
                            .map(|s| s.to_string());
                        let image_field = fields.iter()
                            .find(|f| f.contains("image") || f.contains("cover") || f.contains("thumbnail"))
                            .map(|s| s.to_string());
                        return Some(DataDisplayHint::CardList { title_field, description_field, image_field });
                    }

                    // 默认表格
                    let columns: Vec<ColumnDef> = fields.iter().take(6)
                        .map(|f| ColumnDef {
                            field: f.to_string(),
                            title: humanize_field_name(f),
                            width: None,
                            sortable: true,
                        })
                        .collect();
                    return Some(DataDisplayHint::Table { columns, data_path: None });
                }
            }
            Value::Object(obj) => {
                if obj.contains_key("aiSummary") || obj.contains_key("analysis") || obj.contains_key("summary") {
                    return Some(DataDisplayHint::Markdown);
                }
                if obj.contains_key("source") && obj.contains_key("results") {
                    if let Some(Value::Array(results)) = obj.get("results") {
                        if !results.is_empty() && results.len() > 1 {
                            return Some(DataDisplayHint::CardList {
                                title_field: "name".to_string(),
                                description_field: Some("description".to_string()),
                                image_field: None,
                            });
                        }
                    }
                }
                // 内嵌数组
                for (key, value) in obj.iter() {
                    if let Value::Array(arr) = value {
                        if !arr.is_empty() {
                            if let Some(Value::Object(inner)) = arr.first() {
                                let inner_fields: Vec<&str> = inner.keys().map(|k| k.as_str()).collect();
                                let columns: Vec<ColumnDef> = inner_fields.iter().take(6)
                                    .map(|f| ColumnDef {
                                        field: f.to_string(),
                                        title: humanize_field_name(f),
                                        width: None,
                                        sortable: true,
                                    })
                                    .collect();
                                return Some(DataDisplayHint::Table { columns, data_path: Some(key.clone()) });
                            }
                        }
                    }
                }
                if obj.contains_key("markdown") || obj.contains_key("content") {
                    if let Some(Value::String(s)) = obj.get("markdown").or_else(|| obj.get("content")) {
                        if s.contains('#') || s.contains('*') || s.contains('`') {
                            return Some(DataDisplayHint::Markdown);
                        }
                    }
                }
                if obj.contains_key("chartData") || obj.contains_key("series") {
                    return Some(DataDisplayHint::Chart {
                        chart_type: ChartType::Line,
                        x_field: "x".to_string(),
                        y_field: "y".to_string(),
                    });
                }
                if obj.len() <= 10 {
                    return Some(DataDisplayHint::KeyValue);
                }
            }
            Value::String(s) => {
                if s.contains('#') || s.contains('*') || s.contains('`') || s.contains('\n') {
                    return Some(DataDisplayHint::Markdown);
                }
            }
            _ => {}
        }
        None
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

    /// 恢复 WaitingForInput 任务执行
    pub async fn resume_task(
        &self,
        task_id: &str,
        answer: UserAnswer,
        user_id: i32,
    ) -> Result<AgentResponse, String> {
        // 获取任务并验证所有权
        let task = executor::get_task_for_user(task_id, user_id)
            .await
            .ok_or("Task not found or access denied")?;

        if task.status != TaskStatus::WaitingForInput {
            return Err("Task is not waiting for input".to_string());
        }

        // 从 task_state 中取出保存的 recipe
        let recipe = task.recipe.as_ref().ok_or(
            "Recipe not available for resume (task may have been loaded from DB after restart)"
        )?;

        let task_state = self
            .executor
            .resume_with_answer(task_id, answer, recipe, user_id)
            .await?;

        // 提取结果
        let result = self.extract_final_result(&task_state);
        let frontend_action = self.extract_frontend_action(&result);

        Ok(AgentResponse {
            response_type: if task_state.status == TaskStatus::Failed {
                AgentResponseType::Error
            } else {
                AgentResponseType::Answer
            },
            message: if task_state.status == TaskStatus::Failed {
                format!("执行失败：{}", task_state.error.as_deref().unwrap_or("未知错误"))
            } else {
                "任务已完成".to_string()
            },
            data: Some(result),
            data_display: None,
            suggestions: vec![],
            task: Some(task_state),
            confirmation: None,
            frontend_action,
        })
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

        // 如果没有成功的步骤，返回失败信息
        if results.is_empty() {
            let errors: Vec<String> = task_state.step_results.values()
                .filter_map(|r| r.error.clone())
                .collect();
            let error_msg = if errors.is_empty() {
                "执行失败".to_string()
            } else {
                errors.join("; ")
            };
            return json!({
                "status": format!("{:?}", task_state.status),
                "error": error_msg
            });
        }

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

    /// 智能推断数据展示类型（legacy — 保留供 execute_saved_recipe 使用）
    #[allow(dead_code)]
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

    /// 生成响应消息（legacy）
    #[allow(dead_code)]
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

        // 2. 检查 AI 对话回复 (ai.chat 能力)
        if let Some(reply) = result.get("reply").and_then(|v| v.as_str()) {
            if !reply.is_empty() {
                return reply.to_string();
            }
        }

        // 3. 检查是否有 AI 分析结果
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

    /// 生成后续建议（legacy）
    #[allow(dead_code)]
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

    /// 生成创建类任务的建议（legacy）
    #[allow(dead_code)]
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
