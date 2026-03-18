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

pub mod dag;
pub mod handlers;
pub mod task_store;
pub mod utils;

// 重新导出常用类型
pub use task_store::{
    cancel_task_for_user, clear_cancellation, get_task, get_task_for_user, get_user_tasks,
    init_task_store_db, is_cancelled, maybe_cleanup_tasks, persist_task_async, TASK_STORE,
};
pub use utils::{extract_image_url, summarize_output};

use crate::config::ModelTier;
use crate::services::agent::capability::get_registry;
use crate::services::agent::tier_router::{self, TierRouter};
use crate::services::agent::types::{self, *};
use crate::services::ai::create_ai_analyzer_for_tier;
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
    /// Pro 层级 AI 分析器（复杂推理、规划、创造性任务）
    pub(crate) pro_analyzer: Option<AiAnalyzer>,
    /// Standard 层级 AI 分析器（常规任务、数据处理、定式化操作）
    pub(crate) standard_analyzer: Option<AiAnalyzer>,
}

impl Executor {
    /// 创建新的执行引擎
    pub async fn new(db: DatabaseConnection) -> Self {
        let pro_analyzer = create_ai_analyzer_for_tier(ModelTier::Pro).await;
        let standard_analyzer = create_ai_analyzer_for_tier(ModelTier::Standard).await;
        Self {
            db,
            pro_analyzer,
            standard_analyzer,
        }
    }

    /// 根据 ModelTier 获取对应的 AI 分析器
    fn get_analyzer_for_tier(&self, tier: ModelTier) -> Option<&AiAnalyzer> {
        match tier {
            ModelTier::Pro => self.pro_analyzer.as_ref().or(self.standard_analyzer.as_ref()),
            ModelTier::Standard => self
                .standard_analyzer
                .as_ref()
                .or(self.pro_analyzer.as_ref()),
        }
    }

    /// 带熔断器的 tier 解析
    ///
    /// 优先使用熔断器感知的解析（自动降级），如果两个 tier 都熔断则 fallback 到普通解析。
    fn resolve_tier_with_breaker(capability_id: &str, explicit_tier: Option<ModelTier>) -> ModelTier {
        tier_router::resolve_with_circuit_breaker(capability_id, explicit_tier)
            .unwrap_or_else(|| {
                // 两个 tier 都熔断时仍然尝试（best-effort）
                tracing::warn!(
                    capability_id = capability_id,
                    "[Executor] Both tiers circuit-broken, falling back to default resolve"
                );
                TierRouter::resolve_with_override(capability_id, explicit_tier)
            })
    }

    /// 记录步骤执行结果到熔断器
    fn record_step_to_breaker(tier: ModelTier, success: bool) {
        let breaker = tier_router::get_circuit_breaker(tier);
        if success {
            breaker.record_success();
        } else {
            breaker.record_failure();
        }
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
        task_state.lane_id = recipe.lane_key.clone();

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

        // 注入角色身份上下文（从 Orchestrator 分析结果）
        if let Some(role_ctx_val) = recipe.metadata.get("role_contexts") {
            if let Some(obj) = role_ctx_val.as_object() {
                for (role_key, ctx_val) in obj {
                    if let Some(ctx_str) = ctx_val.as_str() {
                        context.role_contexts.insert(role_key.clone(), ctx_str.to_string());
                    }
                }
                tracing::info!(
                    task_id = %task_state.task_id,
                    roles = context.role_contexts.len(),
                    "[Executor] Role identity contexts loaded"
                );
            }
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

        // 对话历史已通过 ExecutionContext.conversation_context 传递到 HandlerContext
        // 不再冗余存入 step_outputs（inject_role_identity 直接从 execution_context 读取）

        // 初始化执行追踪
        let execution_start = std::time::Instant::now();
        let trace_id = format!("trace_{}", task_state.task_id);
        let mut step_traces: Vec<types::StepTrace> = Vec::new();
        let mut tier_usage: HashMap<String, u32> = HashMap::new();

        // 全局重试预算（跨所有步骤最多重试 5 次）
        let mut global_retry_budget: u32 = 5;

        // 执行步骤
        let mut step_index = 0;
        let all_steps: Vec<RecipeStep> = recipe.steps.clone();
        let total_steps = all_steps.len();

        // 构建 DAG 调度器（检测是否有并行依赖）
        let mut dag_scheduler = dag::DagScheduler::new(&all_steps).ok();
        let use_dag = dag_scheduler
            .as_ref()
            .map_or(false, |d| d.is_parallel_mode());
        if use_dag {
            tracing::info!(
                task_id = %task_state.task_id,
                "[Executor] Parallel DAG mode detected, using DAG scheduler"
            );
        }

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
                (Some(dynamic_step), true)
            } else if use_dag {
                // DAG 模式：获取所有就绪步骤
                let ready = dag_scheduler
                    .as_ref()
                    .map(|d| d.get_ready_steps())
                    .unwrap_or_default();
                if ready.is_empty() {
                    break;
                } else if ready.len() > 1 {
                    // ====== 真正的并行执行 ======
                    let current_total = total_steps + context.pending_dynamic_steps.len();
                    let wave_size = ready.len();
                    tracing::info!(
                        task_id = %task_state.task_id,
                        wave_size = wave_size,
                        "[Executor] Executing {} steps in parallel",
                        wave_size
                    );

                    // 为每个步骤发送 StepStarted 事件
                    for step in &ready {
                        if let Some(ref tx) = progress_tx {
                            let desc =
                                crate::services::agent::capability::get_step_description(step);
                            let _ = tx
                                .send(AgentProgressEvent::StepStarted {
                                    step_id: step.id.clone(),
                                    step_index: 0,
                                    total_steps: current_total as u32,
                                    capability_name: desc.clone(),
                                    description: format!("正在并行执行: {}", desc),
                                })
                                .await;
                        }
                    }

                    // 构建并行 futures（手动构建以满足借用检查）
                    // 注意：并行步骤各自使用 context 的克隆副本。步骤内部对 context 的修改
                    // （如 queue_dynamic_steps）不会合并回原始 context —— 仅最终 output 会被收集。
                    // 这是可接受的设计权衡：并行步骤应为独立的数据获取操作，不应产生动态步骤。
                    let mut futs = Vec::with_capacity(wave_size);
                    for step in &ready {
                        let step_tier = Self::resolve_tier_with_breaker(
                            &step.capability_id,
                            step.model_tier,
                        );
                        let step_analyzer = self.get_analyzer_for_tier(step_tier);
                        let ctx_snapshot = context.clone();
                        let step_clone = step.clone();
                        futs.push(async move {
                            let start = std::time::Instant::now();
                            let mut ctx = ctx_snapshot;
                            let handler_ctx = HandlerContext {
                                db: &self.db,
                                ai_analyzer: step_analyzer,
                                user_id,
                                execution_context: Some(ctx.clone()),
                            };
                            let result = self
                                .execute_step(&step_clone, &mut ctx, &handler_ctx)
                                .await;
                            let duration = start.elapsed().as_millis() as u64;
                            (step_clone, result, duration)
                        });
                    }

                    // 并行执行所有就绪步骤
                    let results = futures::future::join_all(futs).await;

                    // 顺序处理结果：更新上下文、状态、DAG、追踪
                    for (step, step_result, duration_ms) in results {
                        let par_tier = TierRouter::resolve_with_override(
                            &step.capability_id,
                            step.model_tier,
                        );
                        let par_tier_str = format!("{:?}", par_tier);
                        if let Some(idx) = all_steps.iter().position(|s| s.id == step.id) {
                            step_index = idx + 1;
                        }

                        match step_result {
                            Ok(output) => {
                                Self::record_step_to_breaker(par_tier, true);
                                context.add_output(&step.id, output.clone());

                                if let Some(ref tx) = progress_tx {
                                    let _ = tx
                                        .send(AgentProgressEvent::StepCompleted {
                                            step_id: step.id.clone(),
                                            step_index: 0,
                                            success: true,
                                            duration_ms,
                                            output_summary: summarize_output(&output),
                                            image_url: extract_image_url(&output),
                                        })
                                        .await;
                                }

                                task_state.step_results.insert(
                                    step.id.clone(),
                                    StepResult {
                                        step_id: step.id.clone(),
                                        success: true,
                                        output: Some(output),
                                        error: None,
                                        duration_ms,
                                        retry_count: 0,
                                    },
                                );

                                if let Some(ref mut dag) = dag_scheduler {
                                    dag.mark_completed(&step.id);
                                }

                                if let Some(evo) =
                                    crate::services::agent::skill_evolution::get_skill_evolution()
                                {
                                    evo.on_execution_complete(&step.capability_id, true, None)
                                        .await;
                                }

                                // 记录并行步骤追踪（成功）
                                *tier_usage.entry(par_tier_str.clone()).or_insert(0) += 1;
                                step_traces.push(types::StepTrace {
                                    step_id: step.id.clone(),
                                    capability_id: step.capability_id.clone(),
                                    tier_used: par_tier_str,
                                    duration_ms,
                                    success: true,
                                    error: None,
                                });
                            }
                            Err(e) => {
                                Self::record_step_to_breaker(par_tier, false);
                                tracing::error!(
                                    step_id = %step.id,
                                    error = %e,
                                    "[Executor] Parallel step failed"
                                );

                                if let Some(ref tx) = progress_tx {
                                    let _ = tx
                                        .send(AgentProgressEvent::StepCompleted {
                                            step_id: step.id.clone(),
                                            step_index: 0,
                                            success: false,
                                            duration_ms,
                                            output_summary: Some(e.clone()),
                                            image_url: None,
                                        })
                                        .await;
                                }

                                if let Some(evo) =
                                    crate::services::agent::skill_evolution::get_skill_evolution()
                                {
                                    evo.on_execution_complete(
                                        &step.capability_id,
                                        false,
                                        Some(&e),
                                    )
                                    .await;
                                }

                                task_state.step_results.insert(
                                    step.id.clone(),
                                    StepResult {
                                        step_id: step.id.clone(),
                                        success: false,
                                        output: None,
                                        error: Some(e.clone()),
                                        duration_ms,
                                        retry_count: 0,
                                    },
                                );

                                // DAG 模式：标记步骤失败，根据策略决定是否阻塞依赖链
                                if let Some(ref mut dag) = dag_scheduler {
                                    dag.mark_failed(&step.id, &step.on_failure);
                                }

                                // 记录并行步骤追踪（失败）
                                *tier_usage.entry(par_tier_str.clone()).or_insert(0) += 1;
                                step_traces.push(types::StepTrace {
                                    step_id: step.id.clone(),
                                    capability_id: step.capability_id.clone(),
                                    tier_used: par_tier_str,
                                    duration_ms,
                                    success: false,
                                    error: Some(e),
                                });
                            }
                        }
                    }

                    task_state.update_progress(current_total);
                    continue; // 继续下一波并行步骤
                } else {
                    // 单个就绪步骤，走顺序路径
                    let next = ready.into_iter().next().unwrap();
                    if let Some(idx) = all_steps.iter().position(|s| s.id == next.id) {
                        step_index = idx + 1;
                    }
                    (Some(next), false)
                }
            } else if step_index < all_steps.len() {
                let s = all_steps[step_index].clone();
                step_index += 1;
                (Some(s), false)
            } else {
                break;
            };

            // ====== 顺序执行路径（单步） ======
            let step = match step {
                Some(s) => s,
                None => continue,
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

            // 执行步骤（带重试）
            let max_step_retries = step
                .retry
                .as_ref()
                .map(|r| r.max_attempts.min(3))
                .unwrap_or(1);
            let mut retry_count: u32 = 0;
            // 用于追踪的 tier（最后一次使用的 tier）
            let mut step_tier;

            loop {
                // 每次重试重新解析 tier（熔断器状态可能已变化）
                step_tier =
                    Self::resolve_tier_with_breaker(&step.capability_id, step.model_tier);
                let step_analyzer = self.get_analyzer_for_tier(step_tier);

                if retry_count == 0 {
                    tracing::debug!(
                        step_id = %step.id,
                        capability = %step.capability_id,
                        tier = ?step_tier,
                        "[Executor] Using {:?} tier for step", step_tier
                    );
                }

                let handler_ctx = HandlerContext {
                    db: &self.db,
                    ai_analyzer: step_analyzer,
                    user_id,
                    execution_context: Some(context.clone()),
                };

                // 快照 context 以便重试时回滚（避免失败的副作用污染下次尝试）
                let ctx_snapshot = if max_step_retries > 1 {
                    Some(context.clone())
                } else {
                    None
                };

                let start_time = std::time::Instant::now();
                let step_result = self
                    .execute_step(&step, &mut context, &handler_ctx)
                    .await;
                let duration_ms = start_time.elapsed().as_millis() as u64;

                match step_result {
                    Ok(output) => {
                        Self::record_step_to_breaker(step_tier, true);
                        // 记录输出
                        context.add_output(&step.id, output.clone());

                        // 发送步骤完成事件
                        if let Some(ref tx) = progress_tx {
                            let output_summary = summarize_output(&output);
                            let image_url = extract_image_url(&output);
                            let _ = tx
                                .send(AgentProgressEvent::StepCompleted {
                                    step_id: step.id.clone(),
                                    step_index: (step_index.saturating_sub(1)) as u32,
                                    success: true,
                                    duration_ms,
                                    output_summary,
                                    image_url,
                                })
                                .await;
                        }

                        // 动态步骤生成器：处理 ConditionalBranch / AiGenerated（在 output move 前）
                        if let Some(ref gen) = step.generator {
                            let generated = self
                                .process_step_generator(gen, &step, &output, &mut context)
                                .await;
                            if !generated.is_empty() {
                                tracing::info!(
                                    step_id = %step.id,
                                    count = generated.len(),
                                    "[Executor] Generator produced {} dynamic steps",
                                    generated.len()
                                );
                                context.queue_dynamic_steps(generated);
                            }
                        }

                        let result = StepResult {
                            step_id: step.id.clone(),
                            success: true,
                            output: Some(output),
                            error: None,
                            duration_ms,
                            retry_count,
                        };
                        task_state.step_results.insert(step.id.clone(), result);

                        // DAG 模式：标记步骤完成，解锁后续步骤
                        if let Some(ref mut dag) = dag_scheduler {
                            dag.mark_completed(&step.id);
                        }

                        // Skill 进化：记录成功
                        if let Some(evolution) =
                            crate::services::agent::skill_evolution::get_skill_evolution()
                        {
                            evolution
                                .on_execution_complete(&step.capability_id, true, None)
                                .await;
                        }
                        break; // 成功，退出重试循环
                    }
                    Err(e) => {
                        Self::record_step_to_breaker(step_tier, false);
                        retry_count += 1;

                        // 检查是否可以重试（步骤级 + 全局预算）
                        if retry_count < max_step_retries && global_retry_budget > 0 {
                            global_retry_budget -= 1;
                            // 回滚 context 到重试前的快照，避免失败副作用污染
                            if let Some(snapshot) = ctx_snapshot {
                                context = snapshot;
                            }

                            // 重试延迟（指数退避）
                            if let Some(ref retry_cfg) = step.retry {
                                let base_delay = retry_cfg.delay_ms.max(100);
                                let delay = if retry_cfg.exponential_backoff {
                                    base_delay * 2u64.pow(retry_count - 1)
                                } else {
                                    base_delay
                                };
                                tracing::warn!(
                                    step_id = %step.id,
                                    retry = retry_count,
                                    delay_ms = delay,
                                    budget = global_retry_budget,
                                    error = %e,
                                    "[Executor] Step failed, retrying in {}ms ({}/{})",
                                    delay, retry_count, max_step_retries
                                );
                                tokio::time::sleep(
                                    std::time::Duration::from_millis(delay.min(30_000))
                                ).await;
                            } else {
                                tracing::warn!(
                                    step_id = %step.id,
                                    retry = retry_count,
                                    budget = global_retry_budget,
                                    error = %e,
                                    "[Executor] Step failed, retrying ({}/{})",
                                    retry_count, max_step_retries
                                );
                            }
                            continue; // 重试
                        }

                        tracing::error!(
                            step_id = %step.id,
                            error = %e,
                            retries = retry_count,
                            "[Executor] Step failed (no more retries)"
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
                                    image_url: None,
                                })
                                .await;
                        }

                        // Skill 进化：记录失败
                        if let Some(evolution) =
                            crate::services::agent::skill_evolution::get_skill_evolution()
                        {
                            evolution
                                .on_execution_complete(&step.capability_id, false, Some(&e))
                                .await;
                        }

                        let result = StepResult {
                            step_id: step.id.clone(),
                            success: false,
                            output: None,
                            error: Some(e),
                            duration_ms,
                            retry_count,
                        };
                        task_state.step_results.insert(step.id.clone(), result);

                        // DAG 模式：标记步骤失败，根据策略决定是否阻塞依赖链
                        if let Some(ref mut dag) = dag_scheduler {
                            dag.mark_failed(&step.id, &step.on_failure);
                        }
                        break; // 失败，退出重试循环
                    }
                }
            }

            // 记录步骤追踪
            if let Some(sr) = task_state.step_results.get(&step.id) {
                let tier_str = format!("{:?}", step_tier);
                *tier_usage.entry(tier_str.clone()).or_insert(0) += 1;
                step_traces.push(types::StepTrace {
                    step_id: step.id.clone(),
                    capability_id: step.capability_id.clone(),
                    tier_used: tier_str,
                    duration_ms: sr.duration_ms,
                    success: sr.success,
                    error: sr.error.clone(),
                });
            }
        }

        // 附加执行追踪
        task_state.execution_trace = Some(types::ExecutionTrace {
            trace_id,
            steps: step_traces,
            total_duration_ms: execution_start.elapsed().as_millis() as u64,
            tier_usage,
        });

        // 根据步骤结果决定最终状态
        let total_steps = task_state.step_results.len();
        let failed_steps = task_state.step_results.values().filter(|r| !r.success).count();
        if failed_steps > 0 && failed_steps == total_steps {
            task_state.status = TaskStatus::Failed;
            let errors: Vec<String> = task_state.step_results.values()
                .filter_map(|r| r.error.clone())
                .collect();
            task_state.error = Some(errors.join("; "));
        } else {
            task_state.status = TaskStatus::Completed;
        }
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
        // Skill 执行：以 "skill:" 开头的 capability_id 由 Skill 系统处理
        if let Some(skill_id) = step.capability_id.strip_prefix("skill:") {
            return self
                .execute_skill_step(skill_id, step, context, handler_ctx)
                .await;
        }

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
        // 注意：先乘后除避免整数截断（500ms * 3 / 1000 = 1，而不是 500/1000*3 = 0）
        let timeout_secs = capability
            .estimated_duration_ms
            .map(|ms| (ms * 3 / 1000).clamp(10, 300))
            .unwrap_or_else(|| match &capability.category {
                CapabilityCategory::AiProcess | CapabilityCategory::ResourceCreate => 120,
                CapabilityCategory::ExternalIntegration => 30,
                _ => 30,
            });
        // AI 类能力最少给 30 秒（LLM API 调用延迟不可预测）
        let timeout_secs = if capability.requires_ai && timeout_secs < 30 {
            30
        } else {
            timeout_secs
        };
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

    /// 执行 Skill 步骤
    ///
    /// Skill 的 full_instructions 包含执行策略（自然语言描述的步骤编排），
    /// 通过 AI 将其转化为具体的能力调用序列并动态注入执行上下文。
    async fn execute_skill_step(
        &self,
        skill_id: &str,
        step: &RecipeStep,
        context: &mut ExecutionContext,
        handler_ctx: &HandlerContext<'_>,
    ) -> Result<Value, String> {
        // 从注册表加载 Skill
        let registry = crate::services::agent::skill::get_skill_registry()
            .ok_or("Skill registry not initialized")?;
        let skill = registry
            .get(skill_id)
            .await
            .ok_or_else(|| format!("Unknown skill: {}", skill_id))?;

        tracing::info!(
            skill_id = skill_id,
            skill_name = %skill.name,
            "[Executor] Executing skill"
        );

        // 检查 gating（前置条件）
        if !skill.gating.capabilities.is_empty() {
            let cap_registry = get_registry().await;
            for required_cap in &skill.gating.capabilities {
                if cap_registry.get(required_cap).is_none() {
                    return Err(format!(
                        "Skill '{}' requires capability '{}' which is not available",
                        skill.name, required_cap
                    ));
                }
            }
        }

        // 用 AI 将 Skill instructions 转化为执行计划
        let analyzer = handler_ctx
            .ai_analyzer
            .ok_or("AI analyzer not available for skill execution")?;

        // 构建可用能力列表（仅 Skill gating 中声明的 + 通用 AI 能力）
        let available_caps = {
            let cap_registry = get_registry().await;
            let mut caps_desc = String::new();
            let gating_caps = &skill.gating.capabilities;
            let all_caps = cap_registry.get_all();
            for cap in &all_caps {
                if gating_caps.contains(&cap.id) || cap.id.starts_with("ai.") {
                    // 提取 required params
                    let params_hint = cap.input_schema
                        .get("required")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", "))
                        .unwrap_or_default();
                    caps_desc.push_str(&format!(
                        "- `{}`: {} (参数: {})\n",
                        cap.id, cap.description, if params_hint.is_empty() { "无必需" } else { &params_hint }
                    ));
                }
            }
            drop(cap_registry);
            caps_desc
        };

        let prompt = format!(
            "你是 Myriad 的能力编排引擎。根据 Skill 策略生成 JSON 执行计划。\n\n\
             ## Skill: {name}\n{desc}\n\n\
             ## 可用能力（只能使用这些 capability_id）\n{caps}\n\
             ## 执行策略\n{instructions}\n\n\
             ## 用户参数\n{params}\n\n\
             规则：\n\
             1. capability_id 必须从上面的可用能力列表中选择\n\
             2. 步骤按执行顺序排列，后续步骤可通过 depends_on 引用前面步骤的 id\n\
             3. 最多 10 个步骤\n\
             4. 只返回纯 JSON，不要 markdown\n\n\
             格式：{{\"steps\": [{{\"capability_id\": \"x\", \"action\": \"描述\", \"params\": {{}}, \"depends_on\": []}}]}}",
            name = skill.name,
            desc = skill.description,
            caps = available_caps,
            instructions = skill.full_instructions,
            params = serde_json::to_string_pretty(&step.params).unwrap_or_default()
        );

        let ai_result = analyzer
            .analyze(&prompt)
            .await
            .map_err(|e| format!("Skill AI planning failed: {}", e))?;

        // 解析 AI 返回的步骤计划（从文本中提取 JSON）
        let plan: Value = {
            // 尝试找到 JSON 块
            let text = ai_result.trim();
            let json_str = if let Some(start) = text.find('{') {
                if let Some(end) = text.rfind('}') {
                    &text[start..=end]
                } else {
                    text
                }
            } else {
                text
            };
            serde_json::from_str(json_str).unwrap_or_else(|_| json!({"steps": []}))
        };

        let planned_steps = plan
            .get("steps")
            .and_then(|s| s.as_array())
            .cloned()
            .unwrap_or_default();

        if planned_steps.is_empty() {
            return Err(format!(
                "Skill '{}' AI planning returned no executable steps",
                skill.name
            ));
        }

        // 步骤上限
        let planned_steps: Vec<&Value> = planned_steps.iter().take(10).collect();

        // 验证并构建动态步骤
        let cap_registry = get_registry().await;
        let mut dynamic_steps = Vec::with_capacity(planned_steps.len());
        let mut prev_step_id: Option<String> = None;

        for (i, planned) in planned_steps.iter().enumerate() {
            let cap_id = planned
                .get("capability_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            // 验证 capability_id 存在
            if cap_id.is_empty() || (!cap_id.starts_with("skill:") && !cap_id.starts_with("mcp.") && cap_registry.get(cap_id).is_none()) {
                tracing::warn!(
                    skill_id = skill_id,
                    invalid_cap = cap_id,
                    "[Executor] Skill step generated invalid capability_id, skipping"
                );
                continue;
            }

            let action = planned
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("execute");
            let params: HashMap<String, Value> = planned
                .get("params")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();

            // depends_on: 优先使用 AI 返回的，否则串联前一步
            let depends_on = planned
                .get("depends_on")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>())
                .unwrap_or_else(|| {
                    prev_step_id.iter().cloned().collect()
                });

            // 第一个数据获取步骤 abort，后续步骤 skip
            let on_failure = if i == 0 && !cap_id.starts_with("ai.") {
                types::FailureStrategy::Abort
            } else {
                types::FailureStrategy::Skip
            };

            let step_id = format!("{}_{}_step_{}", step.id, skill_id, i);
            prev_step_id = Some(step_id.clone());

            dynamic_steps.push(RecipeStep {
                id: step_id,
                order: (step.order * 100) + (i as u32),
                capability_id: cap_id.to_string(),
                action: action.to_string(),
                params,
                depends_on,
                on_failure,
                retry: None,
                timeout_ms: Some(60000),
                model_tier: skill.tier_hint.as_ref().map(|h| h.to_model_tier()),
                generator: None,
            });
        }
        drop(cap_registry);

        if dynamic_steps.is_empty() {
            return Err(format!(
                "Skill '{}' all generated steps had invalid capability_ids",
                skill.name
            ));
        }

        let steps_count = dynamic_steps.len();
        context.queue_dynamic_steps(dynamic_steps);

        tracing::info!(
            skill_id = skill_id,
            dynamic_steps = steps_count,
            "[Executor] Skill generated {} dynamic steps",
            steps_count
        );

        let last_output = json!({
            "skill": skill_id,
            "status": "planned",
            "dynamic_steps_generated": steps_count,
        });

        Ok(last_output)
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

        // 继续执行剩余步骤
        let all_steps: Vec<RecipeStep> = recipe.steps.clone();
        let mut step_index = task_state.current_step;

        // 构建 DAG 调度器（检测是否有并行依赖）
        let mut dag_scheduler = dag::DagScheduler::new(&all_steps).ok();
        let use_dag = dag_scheduler
            .as_ref()
            .map_or(false, |d| d.is_parallel_mode());

        // 已完成的步骤需要在 DAG 中标记
        if let Some(ref mut dag) = dag_scheduler {
            for step_id in task_state.step_results.keys() {
                dag.mark_completed(step_id);
            }
        }

        // ExecutionTrace 初始化
        let execution_start = std::time::Instant::now();
        let trace_id = format!("trace_{}_resume", task_state.task_id);
        let mut step_traces: Vec<types::StepTrace> = Vec::new();
        let mut tier_usage: std::collections::HashMap<String, u32> =
            std::collections::HashMap::new();

        while step_index < all_steps.len() || context.has_pending_steps() {
            let step = if let Some(dynamic_step) = context.pop_dynamic_step() {
                dynamic_step
            } else if use_dag {
                let ready = dag_scheduler
                    .as_ref()
                    .map(|d| d.get_ready_steps())
                    .unwrap_or_default();
                if let Some(next) = ready.into_iter().next() {
                    if let Some(idx) = all_steps.iter().position(|s| s.id == next.id) {
                        step_index = idx + 1;
                    }
                    next
                } else {
                    break;
                }
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

            // 根据步骤的 capability_id 和显式 model_tier 选择合适的 AI 分析器（带熔断器）
            let step_tier =
                Self::resolve_tier_with_breaker(&step.capability_id, step.model_tier);
            let step_analyzer = self.get_analyzer_for_tier(step_tier);

            let handler_ctx = HandlerContext {
                db: &self.db,
                ai_analyzer: step_analyzer,
                user_id,
                execution_context: Some(context.clone()),
            };

            // 执行步骤
            let start_time = std::time::Instant::now();
            let step_result = self
                .execute_step(&step, &mut context, &handler_ctx)
                .await;
            let duration_ms = start_time.elapsed().as_millis() as u64;

            match step_result {
                Ok(output) => {
                    Self::record_step_to_breaker(step_tier, true);
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

                    // DAG 模式：标记步骤完成，解锁后续步骤
                    if let Some(ref mut dag) = dag_scheduler {
                        dag.mark_completed(&step.id);
                    }

                    // Skill 进化：记录成功
                    if let Some(evolution) =
                        crate::services::agent::skill_evolution::get_skill_evolution()
                    {
                        evolution
                            .on_execution_complete(&step.capability_id, true, None)
                            .await;
                    }

                    // 记录步骤追踪（成功）
                    let tier_str = format!("{:?}", step_tier);
                    *tier_usage.entry(tier_str.clone()).or_insert(0) += 1;
                    step_traces.push(types::StepTrace {
                        step_id: step.id.clone(),
                        capability_id: step.capability_id.clone(),
                        tier_used: tier_str,
                        duration_ms,
                        success: true,
                        error: None,
                    });
                }
                Err(e) => {
                    Self::record_step_to_breaker(step_tier, false);
                    // Skill 进化：记录失败
                    if let Some(evolution) =
                        crate::services::agent::skill_evolution::get_skill_evolution()
                    {
                        evolution
                            .on_execution_complete(&step.capability_id, false, Some(&e))
                            .await;
                    }

                    let result = StepResult {
                        step_id: step.id.clone(),
                        success: false,
                        output: None,
                        error: Some(e.clone()),
                        duration_ms,
                        retry_count: 0,
                    };
                    task_state.step_results.insert(step.id.clone(), result);

                    // 记录步骤追踪（失败）
                    let tier_str = format!("{:?}", step_tier);
                    *tier_usage.entry(tier_str.clone()).or_insert(0) += 1;
                    step_traces.push(types::StepTrace {
                        step_id: step.id.clone(),
                        capability_id: step.capability_id.clone(),
                        tier_used: tier_str,
                        duration_ms,
                        success: false,
                        error: Some(e),
                    });
                }
            }
        }

        // 附加执行追踪
        task_state.execution_trace = Some(types::ExecutionTrace {
            trace_id,
            steps: step_traces,
            total_duration_ms: execution_start.elapsed().as_millis() as u64,
            tier_usage,
        });

        // 根据步骤结果决定最终状态
        let total_steps = task_state.step_results.len();
        let failed_steps = task_state.step_results.values().filter(|r| !r.success).count();
        if failed_steps > 0 && failed_steps == total_steps {
            task_state.status = TaskStatus::Failed;
            let errors: Vec<String> = task_state.step_results.values()
                .filter_map(|r| r.error.clone())
                .collect();
            task_state.error = Some(errors.join("; "));
        } else {
            task_state.status = TaskStatus::Completed;
        }
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
                model_tier: None,
                generator: None,
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
                    model_tier: None,
                    generator: None,
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
                        model_tier: None,
                        generator: None,
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

    // ======== 动态步骤生成器 ========

    /// 处理步骤上的 StepGenerator，返回生成的动态步骤
    async fn process_step_generator(
        &self,
        generator: &StepGenerator,
        step: &RecipeStep,
        output: &Value,
        context: &mut ExecutionContext,
    ) -> Vec<RecipeStep> {
        match generator {
            StepGenerator::ConditionalBranch {
                condition,
                if_true,
                if_false,
            } => {
                let result = self.evaluate_condition(condition, &step.id, output, context);
                let branch = if result { if_true } else { if_false };
                tracing::info!(
                    step_id = %step.id,
                    condition = %condition,
                    result = result,
                    branch_steps = branch.len(),
                    "[Generator] ConditionalBranch evaluated"
                );
                branch.clone()
            }
            StepGenerator::AiGenerated {
                context_prompt,
                capability_scope,
            } => {
                self.ai_generate_steps(context_prompt, capability_scope.as_deref(), step, context)
                    .await
            }
            StepGenerator::UiInteractionFromAnalysis {
                source_step,
                operation_intent,
            } => {
                // 从源步骤输出中提取 UI 元素，生成交互步骤
                let source_output = context.step_outputs.get(source_step.as_str());
                if let Some(output) = source_output {
                    if let Some(elements) = output.get("elements").and_then(|e| e.as_array()) {
                        elements
                            .iter()
                            .take(5)
                            .enumerate()
                            .map(|(i, el)| {
                                let mut params = HashMap::new();
                                params.insert("element".to_string(), el.clone());
                                params.insert(
                                    "intent".to_string(),
                                    Value::String(operation_intent.clone()),
                                );
                                RecipeStep {
                                    id: format!("{}_ui_{}", step.id, i),
                                    order: (step.order + 1 + i as u32),
                                    capability_id: "tapp.interact".to_string(),
                                    action: "interact".to_string(),
                                    params,
                                    depends_on: vec![step.id.clone()],
                                    on_failure: FailureStrategy::Skip,
                                    retry: None,
                                    timeout_ms: Some(15_000),
                                    model_tier: None,
                                    generator: None,
                                }
                            })
                            .collect()
                    } else {
                        vec![]
                    }
                } else {
                    vec![]
                }
            }
            StepGenerator::IterateFromList {
                source_step,
                item_capability,
            } => {
                let source_output = context.step_outputs.get(source_step.as_str());
                if let Some(output) = source_output {
                    // 尝试从输出中找到列表数据
                    let items = output
                        .get("items")
                        .or_else(|| output.get("data"))
                        .or_else(|| output.get("list"))
                        .and_then(|v| v.as_array());
                    if let Some(items) = items {
                        items
                            .iter()
                            .take(10) // 最多迭代 10 项
                            .enumerate()
                            .map(|(i, item)| {
                                let mut params = HashMap::new();
                                params.insert("item".to_string(), item.clone());
                                params.insert(
                                    "index".to_string(),
                                    Value::Number(serde_json::Number::from(i)),
                                );
                                RecipeStep {
                                    id: format!("{}_iter_{}", step.id, i),
                                    order: (step.order + 1 + i as u32),
                                    capability_id: item_capability.clone(),
                                    action: "process".to_string(),
                                    params,
                                    depends_on: vec![step.id.clone()],
                                    on_failure: FailureStrategy::Skip,
                                    retry: None,
                                    timeout_ms: Some(30_000),
                                    model_tier: None,
                                    generator: None,
                                }
                            })
                            .collect()
                    } else {
                        vec![]
                    }
                } else {
                    vec![]
                }
            }
        }
    }

    /// 评估条件表达式（支持简单的 dot-path 真值检查和比较运算）
    fn evaluate_condition(
        &self,
        condition: &str,
        current_step_id: &str,
        current_output: &Value,
        context: &ExecutionContext,
    ) -> bool {
        // 支持的格式：
        // 1. "output.field" → 检查当前步骤输出中 field 的真值
        // 2. "step_id.field" → 检查指定步骤输出中 field 的真值
        // 3. "output.field == value" → 相等比较
        // 4. "output.field > 0" → 数值比较
        // 5. "output.field != null" → 非空检查

        let condition = condition.trim();

        // 解析比较运算符
        let (path, op, expected) = if let Some(pos) = condition.find("!=") {
            let (p, v) = condition.split_at(pos);
            (p.trim(), "!=", v[2..].trim())
        } else if let Some(pos) = condition.find("==") {
            let (p, v) = condition.split_at(pos);
            (p.trim(), "==", v[2..].trim())
        } else if let Some(pos) = condition.find(">=") {
            let (p, v) = condition.split_at(pos);
            (p.trim(), ">=", v[2..].trim())
        } else if let Some(pos) = condition.find("<=") {
            let (p, v) = condition.split_at(pos);
            (p.trim(), "<=", v[2..].trim())
        } else if let Some(pos) = condition.find('>') {
            let (p, v) = condition.split_at(pos);
            (p.trim(), ">", v[1..].trim())
        } else if let Some(pos) = condition.find('<') {
            let (p, v) = condition.split_at(pos);
            (p.trim(), "<", v[1..].trim())
        } else {
            // 纯路径：检查真值
            (condition, "truthy", "")
        };

        // 解析 dot-path 取值
        let value = self.resolve_dot_path(path, current_step_id, current_output, context);

        match op {
            "truthy" => Self::is_truthy(&value),
            "==" => {
                if expected == "null" || expected == "nil" {
                    value.is_null()
                } else if let Some(expected_num) = expected.parse::<f64>().ok() {
                    value.as_f64().map_or(false, |v| (v - expected_num).abs() < f64::EPSILON)
                } else {
                    let expected_str = expected.trim_matches('"').trim_matches('\'');
                    value.as_str().map_or(false, |v| v == expected_str)
                }
            }
            "!=" => {
                if expected == "null" || expected == "nil" {
                    !value.is_null()
                } else if let Some(expected_num) = expected.parse::<f64>().ok() {
                    value.as_f64().map_or(true, |v| (v - expected_num).abs() >= f64::EPSILON)
                } else {
                    let expected_str = expected.trim_matches('"').trim_matches('\'');
                    value.as_str().map_or(true, |v| v != expected_str)
                }
            }
            ">" | ">=" | "<" | "<=" => {
                let actual = value.as_f64().unwrap_or(0.0);
                let expected_num = expected.parse::<f64>().unwrap_or(0.0);
                match op {
                    ">" => actual > expected_num,
                    ">=" => actual >= expected_num,
                    "<" => actual < expected_num,
                    "<=" => actual <= expected_num,
                    _ => false,
                }
            }
            _ => false,
        }
    }

    /// 解析 dot-path 从步骤输出中取值
    fn resolve_dot_path(
        &self,
        path: &str,
        _current_step_id: &str,
        current_output: &Value,
        context: &ExecutionContext,
    ) -> Value {
        let parts: Vec<&str> = path.split('.').collect();
        if parts.is_empty() {
            return Value::Null;
        }

        // 确定起始值
        let (root, field_start) = if parts[0] == "output" {
            // "output.xxx" → 当前步骤输出
            (current_output, 1)
        } else if context.step_outputs.contains_key(parts[0]) {
            // "step_id.xxx" → 指定步骤输出
            (context.step_outputs.get(parts[0]).unwrap(), 1)
        } else {
            // 没有前缀，尝试从当前步骤输出解析
            (current_output, 0)
        };

        // 逐层取值
        let mut current = root.clone();
        for part in &parts[field_start..] {
            current = if let Some(idx) = part.parse::<usize>().ok() {
                current
                    .as_array()
                    .and_then(|arr| arr.get(idx).cloned())
                    .unwrap_or(Value::Null)
            } else {
                current.get(part).cloned().unwrap_or(Value::Null)
            };
        }
        current
    }

    /// 判断 JSON 值的真值
    fn is_truthy(value: &Value) -> bool {
        match value {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::Number(n) => n.as_f64().map_or(false, |v| v != 0.0),
            Value::String(s) => !s.is_empty(),
            Value::Array(arr) => !arr.is_empty(),
            Value::Object(obj) => !obj.is_empty(),
        }
    }

    /// AI 动态生成步骤
    async fn ai_generate_steps(
        &self,
        context_prompt: &str,
        capability_scope: Option<&[String]>,
        parent_step: &RecipeStep,
        context: &ExecutionContext,
    ) -> Vec<RecipeStep> {
        let analyzer = match self.get_analyzer_for_tier(ModelTier::Standard) {
            Some(a) => a,
            None => {
                tracing::warn!("[Generator] No AI analyzer available for AiGenerated");
                return vec![];
            }
        };

        // 构建能力列表
        let capabilities = if let Some(scope) = capability_scope {
            scope.join(", ")
        } else {
            let registry = get_registry().await;
            registry.get_all().iter().take(30).map(|c| c.id.as_str()).collect::<Vec<_>>().join(", ")
        };

        // 构建上下文摘要
        let outputs_summary: String = context
            .step_outputs
            .iter()
            .take(5)
            .map(|(id, val)| format!("- {}: {}", id, summarize_output(val).unwrap_or_default()))
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            r#"根据以下上下文，生成接下来需要执行的步骤。

## 上下文提示
{}

## 已完成步骤的输出
{}

## 可用能力
{}

## 输出格式
返回 JSON 数组，每个元素格式：
```json
[{{"id": "gen_1", "capability_id": "...", "action": "...", "params": {{}}}}]
```

最多生成 5 个步骤。只输出 JSON 数组，不要其他文字。"#,
            context_prompt, outputs_summary, capabilities
        );

        let result = analyzer.analyze(&prompt).await;
        match result {
            Ok(response) => {
                let text = response.trim();
                // 提取 JSON 数组
                let json_str = if let Some(start) = text.find('[') {
                    if let Some(end) = text.rfind(']') {
                        &text[start..=end]
                    } else {
                        text
                    }
                } else {
                    text
                };

                match serde_json::from_str::<Vec<Value>>(json_str) {
                    Ok(items) => {
                        items
                            .into_iter()
                            .take(5)
                            .enumerate()
                            .filter_map(|(i, item)| {
                                let id = item
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let cap_id = item
                                    .get("capability_id")
                                    .and_then(|v| v.as_str())?
                                    .to_string();
                                let action = item
                                    .get("action")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("process")
                                    .to_string();
                                let params: HashMap<String, Value> = item
                                    .get("params")
                                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                                    .unwrap_or_default();

                                Some(RecipeStep {
                                    id: if id.is_empty() {
                                        format!("{}_ai_{}", parent_step.id, i)
                                    } else {
                                        id
                                    },
                                    order: parent_step.order + 1 + i as u32,
                                    capability_id: cap_id,
                                    action,
                                    params,
                                    depends_on: vec![parent_step.id.clone()],
                                    on_failure: FailureStrategy::Skip,
                                    retry: None,
                                    timeout_ms: Some(30_000),
                                    model_tier: None,
                                    generator: None,
                                })
                            })
                            .collect()
                    }
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            "[Generator] Failed to parse AI-generated steps"
                        );
                        vec![]
                    }
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, "[Generator] AI call failed");
                vec![]
            }
        }
    }
}
