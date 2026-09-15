// Work entry points. Fixed-recipe compatibility helpers remain below.
use serde_json::{Value, json};
use super::agent_footer::*;
use super::agent_header::*;
use super::motion_overlay::attach_motion_to_result;
use super::types::*;
use super::{capability, escalation, recipe, response_agent, types};

impl Agent {
    pub(super) async fn process_work(
        &self, request: UserRequest,
        mood_transition: Option<crate::services::agent::merope::MoodTransition>,
        mood_before: Option<f64>, round_motion_style: String,
    ) -> Result<AgentResponse, String> {
        if let Some(response) = self.mood_refuse_response(request.user_id,
            super::merope::refuse_new_task_message(mood_before), None).await { return Ok(response); }
        super::merope::note_chat_diary(&self.db,request.user_id,&request.raw_input).await;
        let result = self.start_work_loop(request.clone(),None).await;
        attach_motion_to_result(result,&request,mood_transition,&round_motion_style).await
    }

    pub(super) async fn process_work_with_progress(
        &self, request: UserRequest, progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
        mood_transition: Option<crate::services::agent::merope::MoodTransition>,
        mood_before: Option<f64>, round_motion_style: String,
    ) -> Result<AgentResponse, String> {
        if let Some(response) = self.mood_refuse_response(request.user_id,
            super::merope::refuse_new_task_message(mood_before),Some(&progress_tx)).await { return Ok(response); }
        super::merope::note_chat_diary(&self.db,request.user_id,&request.raw_input).await;
        let result = self.start_work_loop(request.clone(),Some(progress_tx)).await;
        attach_motion_to_result(result,&request,mood_transition,&round_motion_style).await
    }

    pub(crate) async fn execute_recipe_with_progress_v2(
        &self,
        recipe: &Recipe,
        planner_output: &PlannerOutput,
        original_request: &UserRequest,
        user_id: i32,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    ) -> Result<AgentResponse, String> {
        // 执行 Recipe
        crate::services::agent::merope::mark_activity(&self.db, user_id, "working").await;
        let task_result = self
            .executor
            .execute_with_progress(recipe, user_id, Some(progress_tx.clone()))
            .await;
        crate::services::agent::merope::mark_activity(&self.db, user_id, "idle").await;
        let mut task_state = task_result?;

        // 注入 Planner 决策到 ExecutionTrace
        if let Some(ref mut trace) = task_state.execution_trace {
            trace.planner_decision = Some(types::PlannerDecisionInfo {
                status: format!("{:?}", planner_output.status),
                reasoning: planner_output.reasoning.clone(),
                confidence: planner_output.confidence,
                planned_steps: planner_output
                    .steps
                    .iter()
                    .map(|s| types::PlannerStepSummary {
                        id: s.id.clone(),
                        capability_id: s.capability_id.clone(),
                        action: s.action.clone(),
                        params: serde_json::to_value(&s.params).ok(),
                    })
                    .collect(),
            });
        }

        // 提取结果
        let mut result = self.extract_final_result(&task_state);

        // WaitingForInput 时直接返回，不进行升级评估（结果不完整是正常的）
        if task_state.status == TaskStatus::WaitingForInput {
            if let Some(obj) = result.as_object_mut() {
                obj.insert(
                    "recipe".to_string(),
                    serde_json::to_value(recipe).unwrap_or_default(),
                );
            }
            let frontend_action = self.extract_frontend_action(&result);
            return Ok(AgentResponse {
                response_type: AgentResponseType::Answer,
                message: response_agent::need_more_info(),
                data: Some(result),
                data_display: None,
                suggestions: vec![],
                task: Some(task_state),
                confirmation: None,
                frontend_action,
                performance: None,
            });
        }

        // 评估结果是否需要升级（简化版：检查空结果）
        if self.should_escalate(&task_state, &result) {
            tracing::info!("[Agent] Result unsatisfactory, attempting replan");

            let hint = self.build_escalation_hint(&task_state, &result);
            let _ = progress_tx
                .send(AgentProgressEvent::Progress {
                    progress: 50,
                    completed_steps: 0,
                    total_steps: 0,
                    message: response_agent::escalation_status(&hint),
                })
                .await;

            let granted = crate::services::agent::get_user_permissions(&self.db, user_id).await;
            match self
                .planner
                .replan_with_progress_for(original_request, &hint, &progress_tx, &granted)
                .await
            {
                Ok(replan_output)
                    if replan_output.status == PlannerStatus::Plan
                        && !replan_output.steps.is_empty() =>
                {
                    let cap_ids: Vec<String> = replan_output
                        .steps
                        .iter()
                        .map(|s| s.capability_id.clone())
                        .collect();
                    let cap_schemas = capability::get_capabilities_by_ids(&cap_ids).await;

                    if let Ok(new_steps) = recipe::validate_and_convert_steps(
                        replan_output.steps.clone(),
                        replan_output.reasoning.clone(),
                        &cap_schemas,
                    ) {
                        let new_recipe = Self::build_recipe_from_steps(
                            new_steps,
                            replan_output
                                .reasoning
                                .clone()
                                .unwrap_or_else(response_agent::escalation_retry),
                            original_request,
                        );

                        // 执行升级后的 Recipe
                        let progress_tx_for_summary = progress_tx.clone();
                        crate::services::agent::merope::mark_activity(&self.db, user_id, "working")
                            .await;
                        let new_task_result = self
                            .executor
                            .execute_with_progress(&new_recipe, user_id, Some(progress_tx))
                            .await;
                        crate::services::agent::merope::mark_activity(&self.db, user_id, "idle")
                            .await;
                        let new_task_state = new_task_result?;
                        result = self.extract_final_result(&new_task_state);

                        let frontend_action = self.extract_frontend_action(&result);
                        let data_display = self.infer_data_display_v2(&result, &replan_output);

                        if let Some(obj) = result.as_object_mut() {
                            obj.insert(
                                "recipe".to_string(),
                                serde_json::to_value(&new_recipe).unwrap_or_default(),
                            );
                        }

                        return Ok(AgentResponse {
                            response_type: if new_task_state.status == TaskStatus::Failed {
                                AgentResponseType::Error
                            } else {
                                AgentResponseType::Answer
                            },
                            message: self
                                .generate_response_message_v2(
                                    &replan_output,
                                    &new_task_state,
                                    user_id,
                                    Some(&progress_tx_for_summary),
                                )
                                .await,
                            data: Some(result),
                            data_display,
                            suggestions: vec![],
                            task: Some(new_task_state),
                            confirmation: None,
                            frontend_action,
                            performance: None,
                        });
                    }
                }
                _ => {
                    tracing::info!(
                        "[Agent] Replan failed or returned non-plan, using original result"
                    );
                }
            }
        }

        // 返回原始结果
        let frontend_action = self.extract_frontend_action(&result);
        let data_display = self.infer_data_display_v2(&result, planner_output);

        if let Some(obj) = result.as_object_mut() {
            obj.insert(
                "recipe".to_string(),
                serde_json::to_value(recipe).unwrap_or_default(),
            );
        }

        let is_failed = task_state.status == TaskStatus::Failed;
        Ok(AgentResponse {
            response_type: if is_failed {
                AgentResponseType::Error
            } else {
                AgentResponseType::Answer
            },
            message: self
                .generate_response_message_v2(
                    planner_output,
                    &task_state,
                    user_id,
                    Some(&progress_tx),
                )
                .await,
            data: Some(result),
            data_display,
            suggestions: vec![],
            task: Some(task_state),
            confirmation: None,
            frontend_action,
            performance: None,
        })
    }

    /// 从 TaskState 提取能力 ID 列表（用于升级门控）
    pub(crate) fn capability_ids_from_task(task_state: &TaskState) -> Vec<String> {
        if let Some(recipe) = &task_state.recipe {
            let ids: Vec<String> = recipe
                .steps
                .iter()
                .map(|s| s.capability_id.clone())
                .collect();
            if !ids.is_empty() {
                return ids;
            }
        }
        if let Some(trace) = &task_state.execution_trace {
            let ids: Vec<String> = trace
                .steps
                .iter()
                .map(|s| s.capability_id.clone())
                .collect();
            if !ids.is_empty() {
                return ids;
            }
        }
        Vec::new()
    }

    /// 是否允许联网搜索升级（白名单：generateReadingList + 显式 flag，或纯外部调研链）
    pub(crate) fn allow_web_search_escalation(
        task_state: &TaskState,
        capability_ids: &[String],
    ) -> bool {
        // phantasi.generateReadingList 仅在步骤参数显式开启时允许 web
        if let Some(recipe) = &task_state.recipe {
            for step in &recipe.steps {
                if step.capability_id == "phantasi.generateReadingList" {
                    let flag = step
                        .params
                        .get("allowWebSearch")
                        .or_else(|| step.params.get("useWebSearch"))
                        .or_else(|| step.params.get("allow_web_search"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if flag {
                        return true;
                    }
                }
            }
        }
        // 本地域（phantasi / platform / search.fuzzy / config.get / library）默认禁止 web 升级。
        let has_local = capability_ids
            .iter()
            .any(|id| escalation::is_local_data_capability(id));
        if has_local {
            return false;
        }
        // 非本地域空结果可继续建议 web
        true
    }

    /// 构建评估上下文
    pub(crate) fn evaluation_context_for_task(
        task_state: &TaskState,
    ) -> escalation::EvaluationContext {
        let capability_ids = Self::capability_ids_from_task(task_state);
        let allow_web_search = Self::allow_web_search_escalation(task_state, &capability_ids);
        escalation::EvaluationContext {
            capability_ids,
            allow_web_search,
        }
    }

    /// 判断是否需要升级
    pub(crate) fn should_escalate(&self, task_state: &TaskState, result: &Value) -> bool {
        if task_state.status == TaskStatus::Failed {
            // 配置类错误（API Key 未配置）不应触发 replan 烧预算/再次选 webSearch
            if let Some(err) = &task_state.error {
                let err_lower = err.to_lowercase();
                if err.contains("API Key 未配置")
                    || err.contains("未配置")
                    || err_lower.contains("not configured")
                    || err_lower.contains("api key")
                {
                    tracing::info!(
                        error = %err,
                        "[Agent] Configuration error — skip escalation/replan"
                    );
                    return false;
                }
            }
            return true;
        }
        // Evaluate structured results with the task capability policy.
        let ctx = Self::evaluation_context_for_task(task_state);
        let eval = escalation::evaluate_with_context(result, &ctx);
        if !eval.is_satisfied {
            tracing::info!(
                score = eval.satisfaction_score,
                reason = ?eval.reason,
                patterns = ?eval.failure_patterns,
                suggests_web = eval.suggests_web_search,
                suggests_local = eval.suggests_local_alternatives,
                caps = ?ctx.capability_ids,
                "[Agent] ResultEvaluator: escalation recommended"
            );
        }
        !eval.is_satisfied
    }

    /// 构建升级提示（使用 ResultEvaluator 的失败模式分析）
    pub(crate) fn build_escalation_hint(&self, task_state: &TaskState, result: &Value) -> String {
        if task_state.status == TaskStatus::Failed {
            let err = task_state.error.as_deref().unwrap_or("Processing failed");
            let err_lower = err.to_lowercase();
            if err.contains("API Key 未配置")
                || err.contains("未配置")
                || err_lower.contains("not configured")
            {
                return format!(
                    "Previous run failed because configuration is missing: {}. Do not retry the same capability or switch to ai.webSearch; use a local capability or ask the user to configure a key.",
                    err
                );
            }
            return format!("Previous run failed: {}. Try an alternative.", err);
        }

        let ctx = Self::evaluation_context_for_task(task_state);
        let eval = escalation::evaluate_with_context(result, &ctx);

        let mut hints = Vec::new();
        if let Some(reason) = &eval.reason {
            hints.push(format!("Failure reason: {reason}"));
        }
        // notFound suggestions: replan first — retry phantasi with a suggested value, never webSearch
        if !eval.suggested_retry_values.is_empty() {
            let joined = eval.suggested_retry_values.join(" / ");
            let phantasi_cap = ctx
                .capability_ids
                .iter()
                .find(|id| id.starts_with("phantasi."))
                .map(|s| s.as_str())
                .unwrap_or("phantasi.items");
            hints.push(format!(
                "[Highest priority] Retry with {phantasi_cap}, setting sourceName/name/query/author to one of: {joined}. Do not use ai.webSearch"
            ));
        }
        for hint in &eval.improvement_hints {
            hints.push(hint.clone());
        }
        if eval.suggests_web_search {
            hints.push(
                "Try a web search capability (ai.webSearch or ai.groundingSearch)".to_string(),
            );
        } else if eval.suggests_local_alternatives {
            // Local phantasi miss: force replan onto phantasi.page / search.fuzzy / phantasi.items
            let already_forbids = eval.improvement_hints.iter().any(|h| {
                h.contains("禁止使用 ai.webSearch")
                    || h.contains("禁止改用 ai.webSearch")
                    || h.contains("Do not use ai.webSearch")
            });
            if !already_forbids {
                hints.push(
                    "Do not use ai.webSearch / ai.groundingSearch; prefer phantasi.page, search.fuzzy, or phantasi.items (relax parameters)"
                        .to_string(),
                );
            }
        }
        if hints.is_empty() {
            if eval.suggests_local_alternatives {
                "Previous local data result was empty. Use phantasi.page / search.fuzzy / phantasi.items with a broader query, or ask the user. Do not search the web."
                    .to_string()
            } else {
                "Previous result was empty or did not meet the goal. Try another capability or a web search.".to_string()
            }
        } else {
            hints.join(". ")
        }
    }

    pub(super) async fn mood_refuse_response(
        &self,
        user_id: i32,
        message: Option<String>,
        progress_tx: Option<&tokio::sync::mpsc::Sender<AgentProgressEvent>>,
    ) -> Option<AgentResponse> {
        let message = message?;
        if let Some(tx) = progress_tx {
            Self::stream_text_as_tokens(tx, &message).await;
        }
        crate::services::agent::merope::mark_activity(&self.db, user_id, "idle").await;
        Some(AgentResponse {
            response_type: AgentResponseType::Answer,
            message,
            data: Some(json!({ "type": "mood_refuse" })),
            data_display: None,
            suggestions: vec![],
            task: None,
            confirmation: None,
            frontend_action: None,
            performance: None,
        })
    }

    /// 快速路径：执行简单的单步查询（Planner 版）
    pub(crate) async fn execute_simple_query_v2(
        &self,
        recipe: &Recipe,
        planner_output: &PlannerOutput,
        user_id: i32,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
        user_input: &str,
        conversation_context: Option<&[ConversationMessage]>,
    ) -> Result<AgentResponse, String> {
        let step = &recipe.steps[0];
        let step_description = capability::get_step_description(step);

        // 发送 TaskCreated（前端思考面板依赖此事件初始化）
        let _ = progress_tx
            .send(AgentProgressEvent::TaskCreated {
                task_id: recipe.id.clone(),
                message: String::new(),
                total_steps: 1,
                step_descriptions: vec![step_description.clone()],
            })
            .await;

        // 发送开始执行进度
        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 20,
                completed_steps: 0,
                total_steps: 1,
                message: response_agent::describe_step_start(&step_description),
            })
            .await;

        // 带进度执行（Skill 可能展开为多个动态子步骤，需要把 progress_tx 传下去）
        crate::services::agent::merope::mark_activity(&self.db, user_id, "working").await;
        let task_result = self
            .executor
            .execute_with_progress(recipe, user_id, Some(progress_tx.clone()))
            .await;
        crate::services::agent::merope::mark_activity(&self.db, user_id, "idle").await;
        let task_state = task_result?;

        // 获取执行结果
        let step_result = task_state.step_results.get(&step.id);
        let success = step_result.map(|r| r.success).unwrap_or(false);

        // 发送完成进度
        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 100,
                completed_steps: 1,
                total_steps: 1,
                message: response_agent::done_status(),
            })
            .await;

        // 构建响应
        let mut result = self.extract_final_result(&task_state);
        let frontend_action = self.extract_frontend_action(&result);
        let data_display = self.infer_data_display_v2(&result, planner_output);

        if let Some(obj) = result.as_object_mut() {
            obj.insert(
                "recipe".to_string(),
                serde_json::to_value(recipe).unwrap_or_default(),
            );
        }

        // 单步查询同样走 record_execution_memory。
        {
            record_execution_memory(MemoryRecordParams {
                user_id,
                user_input,
                recipe,
                planner_steps_len: 1,
                success,
                error_msg: task_state.error.as_deref(),
                log_prefix: "",
                conversation_context,
                step_results: Some(&task_state.step_results),
            })
            .await;
        }

        let is_failed = task_state.status == TaskStatus::Failed;
        Ok(AgentResponse {
            response_type: if is_failed {
                AgentResponseType::Error
            } else {
                AgentResponseType::Answer
            },
            message: self
                .generate_response_message_v2(
                    planner_output,
                    &task_state,
                    user_id,
                    Some(&progress_tx),
                )
                .await,
            data: Some(result),
            data_display,
            suggestions: vec![],
            task: Some(task_state),
            confirmation: None,
            frontend_action,
            performance: None,
        })
    }
}
