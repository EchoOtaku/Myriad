//! 执行引擎模块
//!
//! 负责执行 Recipe 中的步骤，管理任务状态
//!
//! ## 模块结构
//!
//! - `task_store` - 任务状态存储和持久化
//! - `utils` - 工具函数（相似度计算、输出摘要等）
//! - `handlers` - 各类能力的具体执行实现
//!
//! ## 整合项目现有服务
//!
//! - `services/analyzer` - AI 分析服务
//! - `api/reports` - 报告生成系统
//! - `api/tapp` - 平台数据 API
//! - `services/brew_parser` - RSS/Atom 解析
//! - `services/tapp_api_service` - Tapp API 执行

pub mod handlers;
pub mod task_store;
pub mod utils;

// 重新导出常用类型
pub use task_store::{
    cancel_task_for_user, clear_cancellation, get_task, get_task_for_user, get_user_tasks,
    init_task_store_db, is_cancelled, maybe_cleanup_tasks, persist_task_async, TASK_STORE,
};
pub use utils::summarize_output;

use crate::services::agent::capability::get_registry;
use crate::services::agent::types::{self, *};
use crate::services::ai::create_ai_analyzer;
use crate::services::analyzer::AiAnalyzer;
use handlers::HandlerContext;
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use std::collections::HashMap;

/// 步骤分析结果
#[allow(dead_code)]
#[derive(Debug)]
enum StepAnalysisResult {
    /// 正常继续执行
    Continue,
    /// 生成新步骤
    GenerateSteps(Vec<RecipeStep>),
    /// 需要用户澄清
    NeedsClarification(Uncertainty),
    /// 发现多个选项需要用户选择
    MultipleOptions(Vec<(String, String)>),
    /// 执行出错
    Error(String),
}

/// 执行引擎
pub struct Executor {
    /// 数据库连接
    pub(crate) db: DatabaseConnection,
    /// AI 分析器
    pub(crate) ai_analyzer: Option<AiAnalyzer>,
}

impl Executor {
    /// 创建新的执行引擎
    pub async fn new(db: DatabaseConnection) -> Self {
        let ai_analyzer = create_ai_analyzer().await;
        Self { db, ai_analyzer }
    }

    /// 执行方案（不带进度回调，兼容旧代码）
    pub async fn execute(&self, recipe: &Recipe, user_id: i32) -> Result<TaskState, String> {
        self.execute_with_progress(recipe, user_id, None).await
    }

    /// 执行方案（带实时进度回调）
    pub async fn execute_with_progress(
        &self,
        recipe: &Recipe,
        user_id: i32,
        progress_tx: Option<tokio::sync::mpsc::Sender<types::AgentProgressEvent>>,
    ) -> Result<TaskState, String> {
        // 创建任务状态
        let mut task_state = TaskState::new(recipe);
        task_state.status = TaskStatus::Running;

        // 创建执行上下文（包含对话历史）
        let mut context = ExecutionContext::from_request_full(
            &recipe.original_request,
            &recipe.name,
            recipe.page_context.clone(),
            recipe.conversation_context.clone(),
        );

        // 记录对话上下文信息
        if let Some(ref history) = context.conversation_context {
            tracing::info!(
                task_id = %task_state.task_id,
                history_len = history.len(),
                "[Executor] Conversation context loaded with {} messages",
                history.len()
            );
        }

        // 如果有 page_context，存入 step_outputs
        if let Some(page_ctx) = context.page_context.clone() {
            let page_title = page_ctx
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            context.add_output("__page_context__", page_ctx);
            tracing::info!(
                task_id = %task_state.task_id,
                page_title = %page_title,
                "[Executor] Page context stored as __page_context__"
            );
        }

        // 存储任务
        {
            let mut store = TASK_STORE.write().await;
            store.store(user_id, task_state.clone());
        }

        tracing::info!(
            task_id = %task_state.task_id,
            recipe_id = %recipe.id,
            steps = recipe.steps.len(),
            "[Executor] Starting recipe execution"
        );

        // 提取对话历史（不可变引用，避免借用冲突）
        let conversation_context = context.conversation_context.clone();

        // 创建 handler 上下文
        let handler_ctx = HandlerContext {
            db: &self.db,
            ai_analyzer: self.ai_analyzer.as_ref(),
            user_id,
            execution_context: None, // 暂时不传完整上下文
        };

        // 为需要对话历史的处理器创建专用上下文
        // 将对话历史存入 step_outputs 供处理器使用
        if let Some(ref history) = conversation_context {
            context.add_output(
                "__conversation_context__",
                serde_json::to_value(history).unwrap_or_default(),
            );
        }

        // 执行步骤
        let mut step_index = 0;
        let all_steps: Vec<RecipeStep> = recipe.steps.clone();
        let total_steps = all_steps.len();

        while step_index < all_steps.len() || context.has_pending_steps() {
            // 🔴 检查任务是否被取消
            if is_cancelled(&task_state.task_id).await {
                tracing::info!(
                    task_id = %task_state.task_id,
                    "[Executor] Task cancelled by user"
                );
                task_state.status = TaskStatus::Cancelled;
                task_state.completed_at = Some(chrono::Utc::now());
                task_state.error = Some("任务已被用户取消".to_string());

                // 清除取消标记
                clear_cancellation(&task_state.task_id).await;

                // 发送取消事件
                if let Some(ref tx) = progress_tx {
                    let _ = tx
                        .send(AgentProgressEvent::Error {
                            task_id: Some(task_state.task_id.clone()),
                            message: "任务已被取消".to_string(),
                            code: "CANCELLED".to_string(),
                        })
                        .await;
                }

                // 更新存储
                {
                    let mut store = TASK_STORE.write().await;
                    if let Some(task) = store.get_mut(&task_state.task_id) {
                        *task = task_state.clone();
                    }
                }
                persist_task_async(user_id, task_state.clone());

                return Ok(task_state);
            }

            // 优先处理动态生成的步骤
            let (step, _is_dynamic) = if let Some(dynamic_step) = context.pop_dynamic_step() {
                tracing::info!(
                    step_id = %dynamic_step.id,
                    "[Executor] Executing dynamic step"
                );
                (dynamic_step, true)
            } else if step_index < all_steps.len() {
                let s = all_steps[step_index].clone();
                step_index += 1;
                (s, false)
            } else {
                break;
            };

            let current_total = total_steps + context.pending_dynamic_steps.len();
            task_state.current_step = step_index;
            task_state.update_progress(current_total);

            // 发送步骤开始事件
            if let Some(ref tx) = progress_tx {
                let step_description =
                    crate::services::agent::capability::get_step_description(&step);
                let _ = tx
                    .send(AgentProgressEvent::StepStarted {
                        step_id: step.id.clone(),
                        step_index: (step_index.saturating_sub(1)) as u32,
                        total_steps: current_total as u32,
                        capability_name: step_description.clone(),
                        description: format!("正在执行: {}", step_description),
                    })
                    .await;
            }

            // 执行步骤
            let start_time = std::time::Instant::now();
            let step_result = self
                .execute_step(&step, &mut context, &handler_ctx)
                .await;
            let duration_ms = start_time.elapsed().as_millis() as u64;

            match step_result {
                Ok(output) => {
                    // 记录输出
                    context.add_output(&step.id, output.clone());

                    // 发送步骤完成事件
                    if let Some(ref tx) = progress_tx {
                        let output_summary = summarize_output(&output);
                        let _ = tx
                            .send(AgentProgressEvent::StepCompleted {
                                step_id: step.id.clone(),
                                step_index: (step_index.saturating_sub(1)) as u32,
                                success: true,
                                duration_ms,
                                output_summary,
                            })
                            .await;
                    }

                    let result = StepResult {
                        step_id: step.id.clone(),
                        success: true,
                        output: Some(output),
                        error: None,
                        duration_ms,
                        retry_count: 0,
                    };
                    task_state.step_results.insert(step.id.clone(), result);
                }
                Err(e) => {
                    tracing::error!(
                        step_id = %step.id,
                        error = %e,
                        "[Executor] Step failed"
                    );

                    // 发送步骤失败事件
                    if let Some(ref tx) = progress_tx {
                        let _ = tx
                            .send(AgentProgressEvent::StepCompleted {
                                step_id: step.id.clone(),
                                step_index: (step_index.saturating_sub(1)) as u32,
                                success: false,
                                duration_ms,
                                output_summary: Some(e.clone()),
                            })
                            .await;
                    }

                    let result = StepResult {
                        step_id: step.id.clone(),
                        success: false,
                        output: None,
                        error: Some(e),
                        duration_ms,
                        retry_count: 0,
                    };
                    task_state.step_results.insert(step.id.clone(), result);
                }
            }
        }

        // 完成
        task_state.status = TaskStatus::Completed;
        task_state.completed_at = Some(chrono::Utc::now());
        task_state.progress = 100;

        {
            let mut store = TASK_STORE.write().await;
            if let Some(task) = store.get_mut(&task_state.task_id) {
                *task = task_state.clone();
            }
        }
        persist_task_async(user_id, task_state.clone());

        Ok(task_state)
    }

    /// 执行单个步骤
    async fn execute_step(
        &self,
        step: &RecipeStep,
        context: &mut ExecutionContext,
        handler_ctx: &HandlerContext<'_>,
    ) -> Result<Value, String> {
        // 获取能力定义
        let registry = get_registry().await;
        let capability = registry
            .get(&step.capability_id)
            .ok_or_else(|| format!("Unknown capability: {}", step.capability_id))?;

        // 解析参数
        let (mut resolved_params, unresolved) =
            self.resolve_params(&step.params, &context.step_outputs);

        if !unresolved.is_empty() {
            tracing::warn!(
                step_id = %step.id,
                unresolved = ?unresolved,
                "[Executor] Some parameters could not be resolved"
            );
        }

        // 🎵 特殊处理：music.playlist 如果没有 playlistId，尝试从前面的搜索步骤获取
        if step.capability_id == "music.playlist" {
            let has_playlist_id = resolved_params
                .get("playlistId")
                .map(|v| {
                    v.as_str().map(|s| !s.is_empty()).unwrap_or(false)
                        || v.as_i64().is_some()
                        || v.as_u64().is_some()
                })
                .unwrap_or(false);

            if !has_playlist_id {
                tracing::info!(
                    "[Executor] music.playlist missing playlistId, searching in previous outputs"
                );

                // 遍历之前的输出，找到 searchPlaylist 的结果
                for (_step_id, output) in &context.step_outputs {
                    // 查找 recommendedPlaylistId
                    if let Some(playlist_id) = output
                        .get("recommendedPlaylistId")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                    {
                        tracing::info!(
                            playlist_id = %playlist_id,
                            "[Executor] Found recommendedPlaylistId from previous step"
                        );
                        resolved_params.insert("playlistId".to_string(), json!(playlist_id));
                        break;
                    }
                    // 或者从 playlists 数组的第一个获取
                    if let Some(first_playlist) = output
                        .get("playlists")
                        .and_then(|p| p.as_array())
                        .and_then(|arr| arr.first())
                    {
                        if let Some(id) = first_playlist.get("id") {
                            let id_str = if let Some(n) = id.as_i64() {
                                n.to_string()
                            } else if let Some(s) = id.as_str() {
                                s.to_string()
                            } else {
                                continue;
                            };
                            tracing::info!(
                                playlist_id = %id_str,
                                "[Executor] Found playlistId from playlists[0]"
                            );
                            resolved_params.insert("playlistId".to_string(), json!(id_str));
                            break;
                        }
                    }
                }
            }
        }

        // 根据能力类别和预估时长确定超时（秒），预估时长取3倍作为缓冲
        let timeout_secs = capability
            .estimated_duration_ms
            .map(|ms| ((ms / 1000) * 3).clamp(10, 300))
            .unwrap_or_else(|| match &capability.category {
                CapabilityCategory::AiProcess | CapabilityCategory::ResourceCreate => 120,
                CapabilityCategory::ExternalIntegration => 30,
                _ => 30,
            });
        let capability_category = capability.category.clone();

        // 释放注册表读锁，避免锁跨越长时间的 handler await
        drop(registry);

        tracing::debug!(
            step_id = %step.id,
            capability = %step.capability_id,
            timeout_secs = timeout_secs,
            params = ?resolved_params,
            "[Executor] Executing step"
        );

        // 分发到具体 handler（带超时保护）
        tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            handlers::execute_capability(
                &step.capability_id,
                &step.action,
                &capability_category,
                &resolved_params,
                handler_ctx,
            ),
        )
        .await
        .map_err(|_| {
            tracing::error!(
                step_id = %step.id,
                capability = %step.capability_id,
                timeout_secs = timeout_secs,
                "[Executor] Step timed out"
            );
            format!("能力 '{}' 执行超时（{}秒）", step.capability_id, timeout_secs)
        })?
    }

    /// 解析参数中的引用
    fn resolve_params(
        &self,
        params: &HashMap<String, Value>,
        previous_outputs: &HashMap<String, Value>,
    ) -> (HashMap<String, Value>, Vec<String>) {
        let mut resolved = HashMap::new();
        let mut unresolved = Vec::new();

        for (key, value) in params {
            if key.ends_with("From") {
                if let Some(ref_str) = value.as_str() {
                    let resolved_value = self.resolve_path_reference(ref_str, previous_outputs);
                    if let Some(output) = resolved_value {
                        let new_key = key.trim_end_matches("From").to_string();
                        resolved.insert(new_key, output);
                        continue;
                    } else {
                        unresolved.push(format!("{}: {}", key, ref_str));
                    }
                }
            }

            resolved.insert(key.clone(), value.clone());
        }

        (resolved, unresolved)
    }

    /// 解析路径引用
    fn resolve_path_reference(
        &self,
        ref_str: &str,
        previous_outputs: &HashMap<String, Value>,
    ) -> Option<Value> {
        // 支持 "step_id" 或 "step_id.path.to.value" 或 "step_id.array[0].field"
        let parts: Vec<&str> = ref_str.splitn(2, '.').collect();
        let step_id = parts[0];

        let output = previous_outputs.get(step_id)?;

        if parts.len() == 1 {
            return Some(output.clone());
        }

        // 解析路径
        let path = parts[1];
        self.get_value_by_path(output, path)
    }

    /// 通过路径获取值
    fn get_value_by_path(&self, value: &Value, path: &str) -> Option<Value> {
        let mut current = value;

        for segment in path.split('.') {
            // 检查是否有数组索引
            if let Some(bracket_pos) = segment.find('[') {
                let field_name = &segment[..bracket_pos];
                let index_str = &segment[bracket_pos + 1..segment.len() - 1];

                if !field_name.is_empty() {
                    current = current.get(field_name)?;
                }

                let index: usize = index_str.parse().ok()?;
                current = current.get(index)?;
            } else {
                current = current.get(segment)?;
            }
        }

        Some(current.clone())
    }

    // ========================================================================
    // 动态步骤生成系统
    // ========================================================================

    /// 用户回答后恢复执行
    #[allow(dead_code)]
    pub async fn resume_with_answer(
        &self,
        task_id: &str,
        answer: UserAnswer,
        recipe: &Recipe,
        user_id: i32,
    ) -> Result<TaskState, String> {
        // 获取任务状态
        let mut task_state = {
            let store = TASK_STORE.read().await;
            store.get(task_id).cloned().ok_or("Task not found")?
        };

        // 检查状态
        if task_state.status != TaskStatus::WaitingForInput {
            return Err("Task is not waiting for input".to_string());
        }

        // 恢复执行上下文
        let mut context = task_state.execution_context.take().unwrap_or_default();

        // 记录用户回答
        context.record_answer(&answer.question_id, &answer.answer);

        // 根据回答类型处理
        if let Some(question) = &task_state.pending_question {
            self.process_user_answer(&answer, question, &mut context, recipe)
                .await;
        }

        // 清除待回答问题
        task_state.clear_pending_question();

        tracing::info!(
            task_id = %task_id,
            "[Executor] Resuming execution after user answer"
        );

        // 创建 handler 上下文
        let handler_ctx = HandlerContext {
            db: &self.db,
            ai_analyzer: self.ai_analyzer.as_ref(),
            user_id,
            execution_context: None,
        };

        // 继续执行剩余步骤
        let all_steps: Vec<RecipeStep> = recipe.steps.clone();
        let mut step_index = task_state.current_step;

        while step_index < all_steps.len() || context.has_pending_steps() {
            let step = if let Some(dynamic_step) = context.pop_dynamic_step() {
                dynamic_step
            } else if step_index < all_steps.len() {
                let s = all_steps[step_index].clone();
                step_index += 1;
                s
            } else {
                break;
            };

            // 跳过已完成的步骤
            if task_state.step_results.contains_key(&step.id) {
                continue;
            }

            task_state.current_step = step_index;
            let total_steps = all_steps.len() + context.pending_dynamic_steps.len();
            task_state.update_progress(total_steps);

            // 检查依赖
            if !self.check_dependencies(&step, &context.step_outputs) {
                continue;
            }

            // 执行步骤
            let start_time = std::time::Instant::now();
            let step_result = self
                .execute_step(&step, &mut context, &handler_ctx)
                .await;
            let duration_ms = start_time.elapsed().as_millis() as u64;

            match step_result {
                Ok(output) => {
                    context.add_output(&step.id, output.clone());

                    // 分析是否需要更多用户输入
                    if let Some(question) = self
                        .analyze_and_generate_dynamic_steps(&step, &output, &mut context, recipe)
                        .await
                    {
                        task_state.set_pending_question(question);
                        task_state.execution_context = Some(context);

                        let mut store = TASK_STORE.write().await;
                        if let Some(task) = store.get_mut(&task_state.task_id) {
                            *task = task_state.clone();
                        }
                        drop(store);
                        persist_task_async(user_id, task_state.clone());

                        return Ok(task_state);
                    }

                    let result = StepResult {
                        step_id: step.id.clone(),
                        success: true,
                        output: Some(output),
                        error: None,
                        duration_ms,
                        retry_count: 0,
                    };
                    task_state.step_results.insert(step.id.clone(), result);
                }
                Err(e) => {
                    let result = StepResult {
                        step_id: step.id.clone(),
                        success: false,
                        output: None,
                        error: Some(e),
                        duration_ms,
                        retry_count: 0,
                    };
                    task_state.step_results.insert(step.id.clone(), result);
                }
            }
        }

        // 完成
        task_state.status = TaskStatus::Completed;
        task_state.completed_at = Some(chrono::Utc::now());
        task_state.progress = 100;

        {
            let mut store = TASK_STORE.write().await;
            if let Some(task) = store.get_mut(&task_state.task_id) {
                *task = task_state.clone();
            }
        }
        persist_task_async(user_id, task_state.clone());

        Ok(task_state)
    }

    /// 处理用户回答，可能生成新的步骤
    #[allow(dead_code)]
    async fn process_user_answer(
        &self,
        answer: &UserAnswer,
        question: &UserQuestion,
        context: &mut ExecutionContext,
        _recipe: &Recipe,
    ) {
        match question.question_type {
            QuestionType::SingleChoice | QuestionType::MultipleChoice => {
                context.set_var("user_choice", json!(answer.answer.clone()));

                if let Some(options) = &question.options {
                    for option in options {
                        if option.value == answer.answer {
                            context.set_var("selected_option_label", json!(option.label.clone()));
                            break;
                        }
                    }
                }

                context.record_decision(
                    DecisionType::ModifyParams,
                    &format!("用户选择了: {}", answer.answer),
                    "根据用户选择调整执行参数",
                    None,
                );
            }
            QuestionType::FreeText => {
                context.set_var("user_input", json!(answer.answer.clone()));

                context.record_decision(
                    DecisionType::ModifyParams,
                    &format!("用户输入了: {}", answer.answer),
                    "使用用户提供的信息",
                    None,
                );
            }
            QuestionType::Confirmation => {
                if answer.answer == "yes" {
                    context.record_decision(
                        DecisionType::GenerateSteps,
                        "用户确认继续执行",
                        "用户确认了操作",
                        None,
                    );
                } else {
                    context.record_decision(
                        DecisionType::SkipStep,
                        "用户拒绝，跳过相关操作",
                        "用户选择不执行该操作",
                        None,
                    );
                }
            }
            _ => {}
        }
    }

    /// 分析步骤结果并可能生成动态步骤
    ///
    /// 这是动态任务更新的核心机制：
    /// 1. 通用分析：检查输出是否包含需要后续处理的内容
    /// 2. 不确定性检测：识别无法自动判断的情况
    /// 3. 智能决策：使用 AI 分析复杂情况并决定下一步
    /// 4. 用户询问：当无法自动判断时，生成问题询问用户
    #[allow(dead_code)]
    async fn analyze_and_generate_dynamic_steps(
        &self,
        step: &RecipeStep,
        output: &Value,
        context: &mut ExecutionContext,
        recipe: &Recipe,
    ) -> Option<UserQuestion> {
        // 限制动态生成的步骤数量，防止无限循环
        const MAX_DYNAMIC_STEPS: usize = 50;
        if context.dynamic_steps_generated >= MAX_DYNAMIC_STEPS {
            tracing::warn!(
                "[Executor] Max dynamic steps reached ({}), skipping generation",
                MAX_DYNAMIC_STEPS
            );
            return None;
        }

        // 1. 首先进行通用分析，检测输出特征
        let analysis_result = self.analyze_step_output(step, output, context).await;

        // 2. 根据分析结果决定下一步行动
        match analysis_result {
            StepAnalysisResult::Continue => {
                self.handle_capability_specific_generation(step, output, context, recipe)
                    .await;
                None
            }
            StepAnalysisResult::GenerateSteps(steps) => {
                context.record_decision(
                    DecisionType::GenerateSteps,
                    &format!("基于步骤 {} 的输出生成 {} 个新步骤", step.id, steps.len()),
                    "输出包含需要进一步处理的内容",
                    Some(&step.id),
                );
                context.queue_dynamic_steps(steps);
                None
            }
            StepAnalysisResult::NeedsClarification(uncertainty) => {
                context.add_uncertainty(uncertainty.clone());

                if uncertainty.importance == UncertaintyImportance::Critical {
                    let question = self.create_question_from_uncertainty(&uncertainty, context);
                    context.record_decision(
                        DecisionType::AskUser,
                        &format!("需要用户澄清: {}", uncertainty.description),
                        "发现关键不确定性，无法自动判断",
                        Some(&step.id),
                    );
                    Some(question)
                } else {
                    self.handle_non_critical_uncertainty(&uncertainty, context)
                        .await;
                    None
                }
            }
            StepAnalysisResult::MultipleOptions(options) => {
                let question = UserQuestion::single_choice(
                    "发现多个可能的选项，请选择你想要的：",
                    &format!("在执行「{}」时发现多个匹配项", context.user_intent),
                    options
                        .into_iter()
                        .map(|(v, l)| QuestionOption::new(&v, &l))
                        .collect(),
                    true,
                );
                context.record_decision(
                    DecisionType::AskUser,
                    "发现多个匹配选项，询问用户选择",
                    &format!("步骤 {} 的输出包含多个可能的目标", step.id),
                    Some(&step.id),
                );
                Some(question)
            }
            StepAnalysisResult::Error(error_msg) => {
                context.add_uncertainty(Uncertainty {
                    id: uuid::Uuid::new_v4().to_string(),
                    uncertainty_type: UncertaintyType::UnexpectedResult,
                    description: error_msg.clone(),
                    possible_values: vec![
                        "重试".to_string(),
                        "跳过".to_string(),
                        "取消".to_string(),
                    ],
                    importance: UncertaintyImportance::Important,
                    discovered_at_step: Some(step.id.clone()),
                });

                let question = UserQuestion::single_choice(
                    &format!("执行过程中遇到问题：{}，你希望如何处理？", error_msg),
                    "执行步骤时发生错误",
                    vec![
                        QuestionOption::new("retry", "重试").with_description("重新执行这个步骤"),
                        QuestionOption::new("skip", "跳过")
                            .with_description("跳过这个步骤继续执行"),
                        QuestionOption::new("cancel", "取消").with_description("取消整个任务"),
                    ],
                    true,
                );
                Some(question)
            }
        }
    }

    /// 分析步骤输出，返回分析结果
    #[allow(dead_code)]
    async fn analyze_step_output(
        &self,
        step: &RecipeStep,
        output: &Value,
        context: &ExecutionContext,
    ) -> StepAnalysisResult {
        // 检查输出是否包含错误
        if let Some(error) = output.get("error").and_then(|e| e.as_str()) {
            if !error.is_empty() {
                return StepAnalysisResult::Error(error.to_string());
            }
        }

        // 检查是否有建议的后续动作
        if let Some(suggest_action) = output.get("suggestAction").and_then(|a| a.as_str()) {
            let suggest_params = output
                .get("suggestActionParams")
                .cloned()
                .unwrap_or(json!({}));
            let reason = output
                .get("ambiguous_reason")
                .or(output.get("hint"))
                .and_then(|r| r.as_str())
                .unwrap_or("需要执行后续操作");

            tracing::info!(
                action = %suggest_action,
                params = ?suggest_params,
                "[analyze_step_output] Found suggested action"
            );

            let suggested_step = RecipeStep {
                id: format!(
                    "suggested_{}",
                    uuid::Uuid::new_v4()
                        .to_string()
                        .split('-')
                        .next()
                        .unwrap_or("step")
                ),
                order: step.order + 1,
                capability_id: suggest_action.to_string(),
                action: reason.to_string(),
                params: if let Some(obj) = suggest_params.as_object() {
                    obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
                } else {
                    HashMap::new()
                },
                depends_on: vec![step.id.clone()],
                on_failure: FailureStrategy::Skip,
                retry: None,
                timeout_ms: None,
            };

            return StepAnalysisResult::GenerateSteps(vec![suggested_step]);
        }

        // 检查是否有明确的"需要选择"标记
        if let Some(choices) = output.get("choices").and_then(|c| c.as_array()) {
            if choices.len() > 1 {
                let options: Vec<(String, String)> = choices
                    .iter()
                    .filter_map(|c| {
                        let value = c.get("value").or(c.get("id")).and_then(|v| v.as_str())?;
                        let label = c.get("label").or(c.get("name")).and_then(|l| l.as_str())?;
                        Some((value.to_string(), label.to_string()))
                    })
                    .collect();
                if !options.is_empty() {
                    return StepAnalysisResult::MultipleOptions(options);
                }
            }
        }

        // 检查输出中是否有"不确定"或"模糊"标记
        if let Some(ambiguous) = output.get("ambiguous").and_then(|a| a.as_bool()) {
            if ambiguous {
                let description = output
                    .get("ambiguous_reason")
                    .and_then(|r| r.as_str())
                    .unwrap_or("结果不明确")
                    .to_string();

                return StepAnalysisResult::NeedsClarification(Uncertainty {
                    id: uuid::Uuid::new_v4().to_string(),
                    uncertainty_type: UncertaintyType::AmbiguousTarget,
                    description,
                    possible_values: output
                        .get("suggestions")
                        .and_then(|s| s.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default(),
                    importance: UncertaintyImportance::Important,
                    discovered_at_step: Some(step.id.clone()),
                });
            }
        }

        // 检查列表数据，如果有多个项目可能需要用户选择
        if let Some(items) = output.get("items").and_then(|i| i.as_array()) {
            if items.len() > 1 && !self.intent_specifies_target(&context.user_intent, items) {
                let options: Vec<(String, String)> = items
                    .iter()
                    .take(10)
                    .filter_map(|item| {
                        let id = item.get("id").and_then(|i| {
                            i.as_str()
                                .map(|s| s.to_string())
                                .or_else(|| i.as_i64().map(|n| n.to_string()))
                        })?;
                        let name = item
                            .get("name")
                            .or(item.get("title"))
                            .and_then(|n| n.as_str())?;
                        Some((id, name.to_string()))
                    })
                    .collect();

                if options.len() > 1 {
                    return StepAnalysisResult::MultipleOptions(options);
                }
            }
        }

        StepAnalysisResult::Continue
    }

    /// 检查用户意图是否明确指定了目标
    #[allow(dead_code)]
    fn intent_specifies_target(&self, intent: &str, items: &[Value]) -> bool {
        let intent_lower = intent.to_lowercase();

        // 检查是否使用了"所有"、"全部"等词汇
        if intent_lower.contains("所有")
            || intent_lower.contains("全部")
            || intent_lower.contains("all")
            || intent_lower.contains("每个")
        {
            return true;
        }

        // 检查是否使用了"第一个"、"最新的"等明确指示
        if intent_lower.contains("第一")
            || intent_lower.contains("最新")
            || intent_lower.contains("最后")
            || intent_lower.contains("first")
            || intent_lower.contains("last")
            || intent_lower.contains("latest")
        {
            return true;
        }

        // 检查是否有具体名称匹配
        for item in items {
            if let Some(name) = item
                .get("name")
                .or(item.get("title"))
                .and_then(|n| n.as_str())
            {
                if intent_lower.contains(&name.to_lowercase()) {
                    return true;
                }
            }
        }

        false
    }

    /// 检查步骤依赖
    #[allow(dead_code)]
    fn check_dependencies(&self, step: &RecipeStep, outputs: &HashMap<String, Value>) -> bool {
        for dep_id in &step.depends_on {
            if !outputs.contains_key(dep_id) {
                return false;
            }
        }
        true
    }

    /// 处理能力特定的步骤生成
    #[allow(dead_code)]
    async fn handle_capability_specific_generation(
        &self,
        step: &RecipeStep,
        output: &Value,
        context: &mut ExecutionContext,
        recipe: &Recipe,
    ) {
        match step.capability_id.as_str() {
            "tapp.ui" => {
                self.generate_ui_interaction_steps(step, output, context, recipe)
                    .await;
            }
            "tapp.page" => {
                self.generate_tapp_follow_up_steps(step, output, context)
                    .await;
            }
            "brew.page" => {
                self.generate_brew_follow_up_steps(step, output, context)
                    .await;
            }
            "brew.discover" => {
                self.generate_brew_subscribe_steps(step, output, context)
                    .await;
            }
            "ai.summarize" | "ai.analyze" => {
                self.generate_ai_follow_up_steps(step, output, context)
                    .await;
            }
            _ => {}
        }

        // 通用优化
        self.optimize_pending_steps(step, output, context).await;
    }

    /// 根据执行结果优化待执行步骤
    #[allow(dead_code)]
    async fn optimize_pending_steps(
        &self,
        completed_step: &RecipeStep,
        output: &Value,
        context: &mut ExecutionContext,
    ) {
        // 1. 如果步骤执行很快，可能数据量较小
        if let Some(duration_ms) = output.get("duration_ms").and_then(|d| d.as_u64()) {
            if duration_ms < 100 && context.pending_dynamic_steps.len() > 1 {
                tracing::debug!(
                    "[Executor] Fast step execution ({}ms), considering step optimization",
                    duration_ms
                );
            }
        }

        // 2. 如果输出数据量很大，可能需要分批处理
        if let Some(items) = output.get("items").and_then(|i| i.as_array()) {
            if items.len() > 100 {
                context.set_var("needs_batching", json!(true));
                context.set_var("total_items", json!(items.len()));
                tracing::info!(
                    items_count = items.len(),
                    "[Executor] Large result set, batching may be needed"
                );
            }
        }

        // 3. 根据成功/失败状态调整后续步骤
        if output.get("success") == Some(&json!(false)) {
            let has_fallback = context.pending_dynamic_steps.iter().any(|s| {
                s.params
                    .get("is_fallback")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            });

            if !has_fallback && completed_step.on_failure != FailureStrategy::Abort {
                tracing::debug!(
                    step_id = %completed_step.id,
                    "[Executor] Step failed without fallback, may need recovery"
                );
            }
        }
    }

    /// 生成 Brew 订阅跟进步骤
    #[allow(dead_code)]
    async fn generate_brew_subscribe_steps(
        &self,
        step: &RecipeStep,
        output: &Value,
        context: &mut ExecutionContext,
    ) {
        let found = output
            .get("found")
            .and_then(|f| f.as_bool())
            .unwrap_or(false);
        if !found {
            return;
        }

        let feeds = output.get("feeds").and_then(|f| f.as_array());
        let Some(feeds) = feeds else { return };

        if feeds.is_empty() {
            return;
        }

        let verified_feeds: Vec<_> = feeds
            .iter()
            .filter(|f| f.get("verified") == Some(&json!(true)))
            .collect();

        if verified_feeds.len() == 1 {
            let feed = verified_feeds[0];
            if let Some(url) = feed.get("url").and_then(|u| u.as_str()) {
                let subscribe_step = RecipeStep {
                    id: format!("auto_subscribe_{}", context.dynamic_steps_generated),
                    order: 0,
                    capability_id: "brew.subscribe".to_string(),
                    action: "subscribe".to_string(),
                    params: HashMap::from([
                        ("url".to_string(), json!(url)),
                        (
                            "name".to_string(),
                            feed.get("name").cloned().unwrap_or(json!("")),
                        ),
                        ("autoGenerated".to_string(), json!(true)),
                    ]),
                    depends_on: vec![step.id.clone()],
                    on_failure: FailureStrategy::Abort,
                    retry: None,
                    timeout_ms: Some(10000),
                };

                context.queue_dynamic_steps(vec![subscribe_step]);
                context.record_decision(
                    DecisionType::GenerateSteps,
                    "自动生成订阅步骤",
                    &format!("发现唯一验证源: {}", url),
                    Some(&step.id),
                );
            }
        }
    }

    /// 生成 AI 分析跟进步骤
    #[allow(dead_code)]
    async fn generate_ai_follow_up_steps(
        &self,
        _step: &RecipeStep,
        output: &Value,
        context: &mut ExecutionContext,
    ) {
        if let Some(summary) = output.get("summary").and_then(|s| s.as_str()) {
            if summary.len() > 500 {
                context.set_var("has_detailed_analysis", json!(true));
            }
        }

        if let Some(suggestions) = output.get("suggestions").and_then(|s| s.as_array()) {
            if !suggestions.is_empty() {
                context.set_var("has_suggestions", json!(true));
                context.set_var("suggestion_count", json!(suggestions.len()));
            }
        }
    }

    /// 从不确定性创建用户问题
    #[allow(dead_code)]
    fn create_question_from_uncertainty(
        &self,
        uncertainty: &Uncertainty,
        context: &ExecutionContext,
    ) -> UserQuestion {
        match uncertainty.uncertainty_type {
            UncertaintyType::AmbiguousTarget => {
                if uncertainty.possible_values.is_empty() {
                    UserQuestion::free_text(
                        &format!("请明确指定目标：{}", uncertainty.description),
                        &format!("在处理「{}」时无法确定具体目标", context.user_intent),
                        true,
                    )
                } else {
                    UserQuestion::single_choice(
                        "请选择你想要操作的目标：",
                        &uncertainty.description,
                        uncertainty
                            .possible_values
                            .iter()
                            .map(|v| QuestionOption::new(v, v))
                            .collect(),
                        true,
                    )
                }
            }
            UncertaintyType::AmbiguousAction => UserQuestion::free_text(
                &format!("请说明你想要执行的具体操作：{}", uncertainty.description),
                &format!("在处理「{}」时无法确定具体操作", context.user_intent),
                true,
            ),
            UncertaintyType::AmbiguousParameter => {
                if uncertainty.possible_values.is_empty() {
                    UserQuestion::free_text(
                        &uncertainty.description,
                        "需要更多信息来完成操作",
                        true,
                    )
                } else {
                    UserQuestion::single_choice(
                        &uncertainty.description,
                        "请选择一个选项",
                        uncertainty
                            .possible_values
                            .iter()
                            .map(|v| QuestionOption::new(v, v))
                            .collect(),
                        true,
                    )
                }
            }
            UncertaintyType::MultipleMatches => UserQuestion::single_choice(
                "发现多个匹配项，请选择：",
                &uncertainty.description,
                uncertainty
                    .possible_values
                    .iter()
                    .map(|v| QuestionOption::new(v, v))
                    .collect(),
                true,
            ),
            UncertaintyType::MissingRequired => UserQuestion::free_text(
                &format!("缺少必要信息：{}", uncertainty.description),
                "需要提供这个信息才能继续",
                true,
            ),
            UncertaintyType::NeedsConfirmation => {
                UserQuestion::confirmation(&uncertainty.description, "请确认是否继续执行")
            }
            UncertaintyType::UnexpectedResult => UserQuestion::single_choice(
                &format!("遇到意外情况：{}，如何处理？", uncertainty.description),
                "执行结果与预期不符",
                vec![
                    QuestionOption::new("retry", "重试"),
                    QuestionOption::new("skip", "跳过"),
                    QuestionOption::new("cancel", "取消任务"),
                ],
                true,
            ),
        }
    }

    /// 处理非关键不确定性
    #[allow(dead_code)]
    async fn handle_non_critical_uncertainty(
        &self,
        uncertainty: &Uncertainty,
        context: &mut ExecutionContext,
    ) {
        match uncertainty.uncertainty_type {
            UncertaintyType::AmbiguousParameter => {
                if let Some(default_value) = uncertainty.possible_values.first() {
                    context.set_var(
                        &format!("inferred_{}", uncertainty.id),
                        json!(default_value),
                    );
                    context.record_decision(
                        DecisionType::UseDefault,
                        &format!("使用默认值: {}", default_value),
                        &format!(
                            "非关键参数「{}」不确定，使用第一个可能的值",
                            uncertainty.description
                        ),
                        uncertainty.discovered_at_step.as_deref(),
                    );
                }
            }
            _ => {
                context.record_decision(
                    DecisionType::SkipStep,
                    &format!("忽略非关键不确定性: {}", uncertainty.description),
                    "不确定性重要程度较低，继续执行",
                    uncertainty.discovered_at_step.as_deref(),
                );
            }
        }
    }

    /// 基于 UI 分析结果生成交互步骤
    #[allow(dead_code)]
    async fn generate_ui_interaction_steps(
        &self,
        step: &RecipeStep,
        output: &Value,
        context: &mut ExecutionContext,
        recipe: &Recipe,
    ) {
        let operation_intent = step
            .params
            .get("operation_intent")
            .and_then(|v| v.as_str())
            .or_else(|| {
                recipe
                    .metadata
                    .get("operation_intent")
                    .and_then(|v| v.as_str())
            });

        let Some(intent) = operation_intent else {
            tracing::debug!(
                "[Executor] No operation_intent specified, skipping UI interaction generation"
            );
            return;
        };

        context.discovered_ui_elements = Some(output.clone());

        let elements = output.get("elements").and_then(|e| e.as_array());
        let Some(elements) = elements else {
            return;
        };

        let intent_lower = intent.to_lowercase();
        let mut matched_steps = Vec::new();

        for element in elements {
            let element_type = element.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let element_id = element.get("id").and_then(|i| i.as_str());
            let text = element.get("text").and_then(|t| t.as_str()).unwrap_or("");
            let text_lower = text.to_lowercase();

            let is_match =
                self.match_element_to_intent(&intent_lower, element_type, &text_lower, element);

            if is_match {
                if let Some(id) = element_id {
                    let operation =
                        self.determine_operation_for_element(element_type, &intent_lower);

                    let interact_step = RecipeStep {
                        id: format!("dynamic_interact_{}", uuid::Uuid::new_v4()),
                        order: (context.dynamic_steps_generated + 1) as u32,
                        capability_id: "tapp.interact".to_string(),
                        action: "execute".to_string(),
                        params: {
                            let mut params = HashMap::new();
                            params.insert(
                                "tapp_id".to_string(),
                                step.params.get("tapp_id").cloned().unwrap_or(json!(null)),
                            );
                            params.insert("operation".to_string(), json!(operation));
                            params.insert("element_id".to_string(), json!(id));

                            if operation == "input" {
                                if let Some(value) =
                                    self.extract_input_value_from_intent(&intent_lower)
                                {
                                    params.insert("value".to_string(), json!(value));
                                }
                            }

                            params
                        },
                        depends_on: vec![step.id.clone()],
                        on_failure: FailureStrategy::Skip,
                        retry: None,
                        timeout_ms: Some(5000),
                    };

                    matched_steps.push(interact_step);

                    tracing::info!(
                        element_id = id,
                        element_type = element_type,
                        operation = operation,
                        "[Executor] Generated dynamic interaction step"
                    );
                }
            }
        }

        if !matched_steps.is_empty() {
            context.queue_dynamic_steps(matched_steps);
        }
    }

    /// 匹配元素是否符合用户意图
    #[allow(dead_code)]
    fn match_element_to_intent(
        &self,
        intent: &str,
        element_type: &str,
        text: &str,
        element: &Value,
    ) -> bool {
        // 按钮类操作
        if (intent.contains("点击") || intent.contains("click") || intent.contains("按"))
            && element_type == "button"
        {
            let intent_keywords: Vec<&str> = intent
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .filter(|s| !s.is_empty() && *s != "点击" && *s != "click" && *s != "按")
                .collect();

            for keyword in intent_keywords {
                if text.contains(keyword)
                    || element
                        .get("aria_label")
                        .and_then(|l| l.as_str())
                        .map(|l| l.to_lowercase().contains(keyword))
                        .unwrap_or(false)
                {
                    return true;
                }
            }
        }

        // 输入类操作
        if (intent.contains("输入")
            || intent.contains("填写")
            || intent.contains("input")
            || intent.contains("type"))
            && (element_type == "input" || element_type == "textarea")
        {
            if let Some(placeholder) = element.get("placeholder").and_then(|p| p.as_str()) {
                let placeholder_lower = placeholder.to_lowercase();
                let intent_keywords: Vec<&str> = intent
                    .split(|c: char| !c.is_alphanumeric() && c != '_')
                    .filter(|s| !s.is_empty())
                    .collect();

                for keyword in intent_keywords {
                    if placeholder_lower.contains(keyword) {
                        return true;
                    }
                }
            }
            return true;
        }

        // 提交类操作
        if (intent.contains("提交")
            || intent.contains("submit")
            || intent.contains("确认")
            || intent.contains("保存"))
            && (element_type == "submit"
                || (element_type == "button"
                    && (text.contains("提交")
                        || text.contains("确认")
                        || text.contains("保存")
                        || text.contains("submit"))))
        {
            return true;
        }

        // 选择类操作
        if (intent.contains("选择") || intent.contains("select"))
            && (element_type == "select" || element_type == "checkbox" || element_type == "radio")
        {
            return true;
        }

        false
    }

    /// 根据元素类型和意图确定操作
    #[allow(dead_code)]
    fn determine_operation_for_element(&self, element_type: &str, intent: &str) -> &'static str {
        match element_type {
            "button" | "submit" => "click",
            "input" | "textarea" => {
                if intent.contains("清空") || intent.contains("clear") {
                    "clear"
                } else {
                    "input"
                }
            }
            "select" => "select",
            "checkbox" | "radio" => "click",
            "link" => "click",
            _ => "click",
        }
    }

    /// 从意图中提取输入值
    #[allow(dead_code)]
    fn extract_input_value_from_intent(&self, intent: &str) -> Option<String> {
        let patterns = [
            r#"输入[:：]?\s*["']?([^"']+)["']?"#,
            r#"填写[:：]?\s*["']?([^"']+)["']?"#,
            r#"input[:：]?\s*["']?([^"']+)["']?"#,
            r#"value[:：]?\s*["']?([^"']+)["']?"#,
        ];

        for pattern in patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                if let Some(caps) = re.captures(intent) {
                    if let Some(matched) = caps.get(1) {
                        let value = matched.as_str().trim();
                        if !value.is_empty() {
                            return Some(value.to_string());
                        }
                    }
                }
            }
        }
        None
    }

    /// 基于 Tapp 页面内容生成后续步骤
    #[allow(dead_code)]
    async fn generate_tapp_follow_up_steps(
        &self,
        _step: &RecipeStep,
        _output: &Value,
        _context: &mut ExecutionContext,
    ) {
        // 预留：可以根据 tapp.page 的结果自动触发 tapp.ui 分析
    }

    /// 基于 Brew 页面内容生成后续步骤
    #[allow(dead_code)]
    async fn generate_brew_follow_up_steps(
        &self,
        _step: &RecipeStep,
        _output: &Value,
        _context: &mut ExecutionContext,
    ) {
        // 预留：可以根据 brew.page 的结果自动触发后续操作
    }
}
