//! 方案生成器模块
//!
//! 根据解析后的意图生成可执行的 Recipe
//!
//! 核心功能：
//! 1. 意图 -> 能力映射：将用户意图分解为多个能力调用
//! 2. 步骤依赖管理：确保步骤按正确顺序执行
//! 3. 数据流传递：步骤间通过 inputFrom/contextFrom 传递数据

use super::capability::find_capabilities_for_intent;
use super::types::*;
use serde_json::{json, Value};
use std::collections::HashMap;

/// 方案生成器
pub struct RecipeGenerator;

impl RecipeGenerator {
    /// 创建新的方案生成器
    pub fn new() -> Self {
        Self
    }

    /// 根据意图生成执行方案
    pub async fn generate(
        &self,
        intent: &ParsedIntent,
        request: Option<&UserRequest>,
    ) -> Result<Recipe, String> {
        // 确定执行类型
        let execution_type = self.determine_execution_type(intent);

        // 创建基础方案
        let mut recipe = Recipe::new(
            &self.generate_recipe_name(intent),
            &format!("{:?}", intent.action),
            execution_type.clone(),
        );

        // 从请求上下文提取 pageContent 和 conversation_history
        if let Some(req) = request {
            tracing::debug!(
                has_context = req.context.is_some(),
                "[RecipeGenerator] Checking request for page context"
            );
            if let Some(ctx) = &req.context {
                // 提取对话历史
                if let Some(conversation_history) = &ctx.conversation_history {
                    if !conversation_history.is_empty() {
                        recipe.conversation_context = Some(conversation_history.clone());
                        tracing::info!(
                            message_count = conversation_history.len(),
                            "[RecipeGenerator] ✅ Conversation context attached to recipe ({} messages)",
                            conversation_history.len()
                        );
                    }
                }

                tracing::debug!(
                    has_custom_data = ctx.custom_data.is_some(),
                    "[RecipeGenerator] Context has custom_data: {}",
                    ctx.custom_data.is_some()
                );
                if let Some(custom_data) = &ctx.custom_data {
                    tracing::debug!(
                        custom_data_keys = ?custom_data.as_object().map(|o| o.keys().collect::<Vec<_>>()),
                        "[RecipeGenerator] Custom data keys"
                    );
                    if let Some(page_content) = custom_data.get("pageContent") {
                        recipe.page_context = Some(page_content.clone());
                        tracing::info!(
                            page_title = %page_content.get("title").and_then(|v| v.as_str()).unwrap_or("unknown"),
                            page_type = %page_content.get("type").and_then(|v| v.as_str()).unwrap_or("unknown"),
                            "[RecipeGenerator] ✅ Page context attached to recipe"
                        );
                    } else {
                        tracing::debug!("[RecipeGenerator] No pageContent in custom_data");
                    }
                }
            }
        } else {
            tracing::debug!("[RecipeGenerator] No request provided");
        }

        // 根据执行类型生成步骤
        match execution_type {
            ExecutionType::Instant => {
                self.generate_instant_steps(&mut recipe, intent).await?;
            }
            ExecutionType::Continuous => {
                self.generate_continuous_steps(&mut recipe, intent).await?;
            }
            ExecutionType::Creation => {
                self.generate_creation_steps(&mut recipe, intent).await?;
            }
            ExecutionType::Batch => {
                self.generate_batch_steps(&mut recipe, intent).await?;
            }
        }

        // 处理子意图
        if !intent.sub_intents.is_empty() {
            for (idx, sub_intent) in intent.sub_intents.iter().enumerate() {
                // 尝试为子意图生成 recipe（传递 None，子意图不需要 page_context）
                match Box::pin(self.generate(sub_intent, None)).await {
                    Ok(sub_recipe) => {
                        // 只有当子 recipe 有有效步骤时才合并
                        if !sub_recipe.steps.is_empty() {
                            for mut step in sub_recipe.steps {
                                step.id = format!("sub_{}_{}", idx, step.id);
                                step.order = recipe.steps.len() as u32;
                                recipe.add_step(step);
                            }
                        }
                    }
                    Err(e) => {
                        // 子意图生成失败，记录警告但继续处理
                        tracing::warn!(
                            sub_intent_idx = idx,
                            error = %e,
                            "[RecipeGenerator] Failed to generate sub-recipe, skipping"
                        );
                    }
                }
            }
        }

        // 设置预期输出格式
        recipe.expected_output = intent
            .constraints
            .output_format
            .clone()
            .unwrap_or(OutputFormat::Text);

        Ok(recipe)
    }

    /// 确定执行类型
    fn determine_execution_type(&self, intent: &ParsedIntent) -> ExecutionType {
        match &intent.action {
            IntentAction::Monitor => ExecutionType::Continuous,
            IntentAction::Create => {
                // 判断是创建资源还是创建监控
                match &intent.target {
                    IntentTarget::Tapp(_) | IntentTarget::Report(_) | IntentTarget::Brew(_) => {
                        ExecutionType::Creation
                    }
                    _ => ExecutionType::Instant,
                }
            }
            IntentAction::Export | IntentAction::Update | IntentAction::Delete => {
                ExecutionType::Batch
            }
            _ => ExecutionType::Instant,
        }
    }

    /// 生成方案名称
    fn generate_recipe_name(&self, intent: &ParsedIntent) -> String {
        let action_name = match &intent.action {
            IntentAction::Query => "查询",
            IntentAction::Summarize => "总结",
            IntentAction::Analyze => "分析",
            IntentAction::Monitor => "监控",
            IntentAction::Create => "创建",
            IntentAction::Update => "更新",
            IntentAction::Delete => "删除",
            IntentAction::Compare => "比较",
            IntentAction::Recommend => "推荐",
            IntentAction::Export => "导出",
            IntentAction::Execute => "执行",
            IntentAction::Navigate => "打开",
            IntentAction::Control => "控制",
            IntentAction::Unknown(s) => s.as_str(),
        };

        let target_name = match &intent.target {
            IntentTarget::Platform(p) => format!("{} 数据", p),
            IntentTarget::Report(_) => "报告".to_string(),
            IntentTarget::Tapp(_) => "Tapp".to_string(),
            IntentTarget::Brew(_) => "Brew 内容".to_string(),
            IntentTarget::Music(_) => "音乐播放器".to_string(),
            IntentTarget::Profile => "用户资料".to_string(),
            IntentTarget::Data(d) => format!("{} 数据", d),
            IntentTarget::Event(e) => format!("{} 事件", e),
            IntentTarget::CurrentPage(p) => match p.as_str() {
                "brew" => "订阅内容".to_string(),
                "tapp" => "应用内容".to_string(),
                "report" => "报告内容".to_string(),
                "dashboard" => "仪表盘内容".to_string(),
                _ => "当前页面内容".to_string(),
            },
            IntentTarget::Unspecified => "内容".to_string(),
        };

        format!("{}{}", action_name, target_name)
    }

    /// 生成即时查询步骤
    async fn generate_instant_steps(
        &self,
        recipe: &mut Recipe,
        intent: &ParsedIntent,
    ) -> Result<(), String> {
        // 查找匹配的能力
        let capabilities = find_capabilities_for_intent(intent).await;

        // 检查是否有 page_context（前端传递的页面内容）
        // 如果有，就不需要创建数据获取步骤，直接引用 __page_context__
        let has_page_context = recipe.page_context.is_some();
        tracing::info!(
            has_page_context = has_page_context,
            action = ?intent.action,
            "[RecipeGenerator] Generating instant steps, page_context: {}", has_page_context
        );
        if has_page_context {
            tracing::info!(
                "[RecipeGenerator] ✅ Will use __page_context__ instead of fetching data"
            );
        }

        // 注意：能力为空不一定是错误，可能意图本身就不需要执行能力（如模糊查询）
        // 这种情况下，步骤列表为空，让主流程直接返回友好响应

        match &intent.action {
            IntentAction::Query => {
                // 第一步：获取数据
                if !has_page_context {
                    if let Some(data_step) = self.create_data_fetch_step(intent, &capabilities) {
                        recipe.add_step(data_step);
                    }
                }
                // 如果有 page_context，不需要获取数据步骤
                // 如果没有 page_context 且没有合适的能力，步骤为空，这是预期行为
            }
            IntentAction::Summarize => {
                // 确定数据来源 ID
                let data_source_id = if has_page_context {
                    // 有 page_context，直接引用
                    "__page_context__".to_string()
                } else {
                    // 没有 page_context，需要先获取数据
                    if let Some(data_step) = self.create_data_fetch_step(intent, &capabilities) {
                        let data_step_id = data_step.id.clone();
                        recipe.add_step(data_step);
                        data_step_id
                    } else {
                        // 没有合适的能力获取数据，无法总结
                        return Ok(());
                    }
                };

                // 第二步：AI 总结
                let summarize_step = RecipeStep {
                    id: "step_summarize".to_string(),
                    order: if has_page_context { 0 } else { 1 },
                    capability_id: "ai.summarize".to_string(),
                    action: "summarize".to_string(),
                    params: HashMap::from([
                        ("inputFrom".to_string(), json!(data_source_id)),
                        (
                            "style".to_string(),
                            json!(intent
                                .constraints
                                .output_format
                                .as_ref()
                                .map(|f| format!("{:?}", f))
                                .unwrap_or_else(|| "brief".to_string())),
                        ),
                    ]),
                    depends_on: if has_page_context {
                        vec![]
                    } else {
                        vec![data_source_id.clone()]
                    },
                    on_failure: FailureStrategy::Abort,
                    retry: Some(RetryConfig {
                        max_attempts: 2,
                        delay_ms: 1000,
                        exponential_backoff: true,
                    }),
                    timeout_ms: Some(30000),
                };
                recipe.add_step(summarize_step);
            }
            IntentAction::Analyze => {
                // 确定数据来源 ID
                let data_source_id = if has_page_context {
                    // 有 page_context，直接引用
                    "__page_context__".to_string()
                } else {
                    // 没有 page_context，需要先获取数据
                    if let Some(data_step) = self.create_data_fetch_step(intent, &capabilities) {
                        let data_step_id = data_step.id.clone();
                        recipe.add_step(data_step);
                        data_step_id
                    } else {
                        // 没有合适的能力获取数据，无法分析
                        return Ok(());
                    }
                };

                // 第二步：AI 分析
                let analyze_step = RecipeStep {
                    id: "step_analyze".to_string(),
                    order: if has_page_context { 0 } else { 1 },
                    capability_id: "ai.analyze".to_string(),
                    action: "analyze".to_string(),
                    params: HashMap::from([
                        ("inputFrom".to_string(), json!(data_source_id)),
                        ("analysisType".to_string(), json!("custom")),
                    ]),
                    depends_on: if has_page_context {
                        vec![]
                    } else {
                        vec![data_source_id.clone()]
                    },
                    on_failure: FailureStrategy::Abort,
                    retry: Some(RetryConfig {
                        max_attempts: 2,
                        delay_ms: 1000,
                        exponential_backoff: true,
                    }),
                    timeout_ms: Some(60000),
                };
                recipe.add_step(analyze_step);
            }
            IntentAction::Recommend => {
                // ========================================
                // ⭐ Recommend 动作的智能路由
                // ========================================
                // 核心原则：优先信任 suggested_capabilities，其次根据 target 类型判断
                //
                // 路由规则：
                // 1. suggested_capabilities 包含 brew.generateReadingList → 文章阅读列表
                // 2. suggested_capabilities 包含 netease.searchPlaylist → 音乐推荐（由 process_additional_capabilities 处理）
                // 3. suggested_capabilities 包含 platform.* + ai.recommend → 平台数据推荐
                // 4. target 是 Music → 音乐推荐（由 process_additional_capabilities 处理）
                // 5. target 是 Brew → 文章阅读列表
                // 6. target 是 Platform → 平台数据推荐（需要明确的平台名）
                // 7. 其他情况 → 默认使用文章阅读列表

                tracing::info!(
                    target = ?intent.target,
                    suggested_capabilities = ?intent.suggested_capabilities,
                    "[RecipeGenerator] Processing Recommend action"
                );

                // 分析 suggested_capabilities
                let caps_lower: Vec<String> = intent
                    .suggested_capabilities
                    .iter()
                    .map(|c| c.to_lowercase())
                    .collect();

                let has_reading_list = caps_lower.iter().any(|c| c == "brew.generatereadinglist");
                let has_music_search = caps_lower.iter().any(|c| c == "netease.searchplaylist");
                let has_ai_recommend = caps_lower.iter().any(|c| c == "ai.recommend");
                let has_specific_platform = caps_lower.iter().any(|c| {
                    c == "platform.bilibili" || c == "platform.steam" ||
                    c == "platform.github" || c == "platform.netease" ||
                    c == "bilibili.user" || c == "steam.user" ||
                    c == "github.repos" || c == "netease.playlist"
                });

                // 判断 target 类型
                let is_music_target = matches!(intent.target, IntentTarget::Music(_));
                let is_brew_target = matches!(intent.target, IntentTarget::Brew(_));
                let is_platform_target = matches!(intent.target, IntentTarget::Platform(_));

                // 路由决策
                enum RecommendRoute {
                    ReadingList,      // 文章阅读列表
                    MusicPlaylist,    // 音乐推荐（由 process_additional_capabilities 处理）
                    PlatformData,     // 平台数据推荐
                }

                // 路由决策：优先信任 AI 返回的 suggested_capabilities
                let route = if has_reading_list {
                    // AI 明确指定了阅读列表
                    RecommendRoute::ReadingList
                } else if has_music_search || is_music_target {
                    // AI 指定音乐搜索，或 target 是音乐
                    RecommendRoute::MusicPlaylist
                } else if has_ai_recommend && has_specific_platform {
                    // AI 指定了 ai.recommend + 具体平台 → 平台数据推荐
                    RecommendRoute::PlatformData
                } else if has_ai_recommend {
                    // AI 只指定了 ai.recommend（没有具体平台）→ 仍然信任 AI，使用平台数据推荐
                    // 此时会使用 platform.read 作为通用读取
                    RecommendRoute::PlatformData
                } else if has_specific_platform {
                    // AI 只指定了具体平台（没有 ai.recommend）→ 也信任 AI
                    RecommendRoute::PlatformData
                } else if is_brew_target {
                    // target 是 Brew
                    RecommendRoute::ReadingList
                } else if is_platform_target {
                    // target 是平台（即使没有 suggested_capabilities）
                    RecommendRoute::PlatformData
                } else {
                    // AI 返回了其他能力或没有返回任何能力
                    // 都由 process_additional_capabilities 处理，这里不添加步骤
                    tracing::info!(
                        capabilities = ?caps_lower,
                        "[RecipeGenerator] Recommend → Delegating to process_additional_capabilities"
                    );
                    RecommendRoute::MusicPlaylist // 复用这个分支来跳过
                };

                match route {
                    RecommendRoute::ReadingList => {
                        tracing::info!("[RecipeGenerator] Recommend → ReadingList route");
                        let reading_list_step = RecipeStep {
                            id: "step_reading_list".to_string(),
                            order: 0,
                            capability_id: "brew.generateReadingList".to_string(),
                            action: "generateReadingList".to_string(),
                            params: self.build_data_fetch_params(intent),
                            depends_on: vec![],
                            on_failure: FailureStrategy::Abort,
                            retry: Some(RetryConfig {
                                max_attempts: 2,
                                delay_ms: 1000,
                                exponential_backoff: true,
                            }),
                            timeout_ms: Some(60000),
                        };
                        recipe.add_step(reading_list_step);
                    }
                    RecommendRoute::MusicPlaylist => {
                        tracing::info!("[RecipeGenerator] Recommend → MusicPlaylist route (handled by process_additional_capabilities)");
                        // 音乐推荐由 process_additional_capabilities 处理
                        // 这里不添加步骤，避免重复
                    }
                    RecommendRoute::PlatformData => {
                        tracing::info!("[RecipeGenerator] Recommend → PlatformData route");
                        // 找出具体的平台能力
                        let platform_cap = caps_lower.iter().find(|c| {
                            c.starts_with("platform.") ||
                            *c == "bilibili.user" || *c == "steam.user" ||
                            *c == "github.repos" || *c == "netease.playlist"
                        }).cloned().unwrap_or_else(|| "platform.read".to_string());

                        // 获取平台上下文数据
                        let context_step = RecipeStep {
                            id: "step_context".to_string(),
                            order: 0,
                            capability_id: platform_cap,
                            action: "read".to_string(),
                            params: self.build_data_fetch_params(intent),
                            depends_on: vec![],
                            on_failure: FailureStrategy::UseDefault(json!({"items": []})),
                            retry: None,
                            timeout_ms: Some(10000),
                        };
                        let context_step_id = context_step.id.clone();
                        recipe.add_step(context_step);

                        // AI 推荐步骤
                        let recommend_step = RecipeStep {
                            id: "step_recommend".to_string(),
                            order: 1,
                            capability_id: "ai.recommend".to_string(),
                            action: "recommend".to_string(),
                            params: HashMap::from([
                                ("contextFrom".to_string(), json!(context_step_id)),
                                ("count".to_string(), json!(intent.constraints.limit.unwrap_or(5))),
                            ]),
                            depends_on: vec![context_step_id],
                            on_failure: FailureStrategy::Abort,
                            retry: Some(RetryConfig {
                                max_attempts: 2,
                                delay_ms: 1000,
                                exponential_backoff: true,
                            }),
                            timeout_ms: Some(30000),
                        };
                        recipe.add_step(recommend_step);
                    }
                }
            }
            IntentAction::Compare => {
                // 比较需要获取多个数据源
                if let Some(data_step) = self.create_data_fetch_step(intent, &capabilities) {
                    let data_step_id = data_step.id.clone();
                    recipe.add_step(data_step);

                    let compare_step = RecipeStep {
                        id: "step_compare".to_string(),
                        order: 1,
                        capability_id: "ai.analyze".to_string(),
                        action: "compare".to_string(),
                        params: HashMap::from([
                            ("inputFrom".to_string(), json!(data_step_id)),
                            ("analysisType".to_string(), json!("compare")),
                        ]),
                        depends_on: vec![data_step_id],
                        on_failure: FailureStrategy::Abort,
                        retry: None,
                        timeout_ms: Some(30000),
                    };
                    recipe.add_step(compare_step);
                }
            }
            IntentAction::Navigate => {
                // 导航/打开操作
                // 1. 先获取数据列表（如文章列表）
                // 2. 然后返回导航信息让前端跳转
                tracing::info!(
                    target = ?intent.target,
                    "[RecipeGenerator] Handling Navigate action"
                );

                // 创建导航步骤
                let navigate_step = RecipeStep {
                    id: "step_navigate".to_string(),
                    order: 0,
                    capability_id: self.select_navigate_capability(intent, &capabilities),
                    action: "navigate".to_string(),
                    params: self.build_navigate_params(intent),
                    depends_on: vec![],
                    on_failure: FailureStrategy::Abort,
                    retry: None,
                    timeout_ms: Some(10000),
                };
                recipe.add_step(navigate_step);
            }
            IntentAction::Control => {
                // 控制操作（如音乐播放器控制）
                tracing::info!(
                    target = ?intent.target,
                    suggested_capabilities = ?intent.suggested_capabilities,
                    "[RecipeGenerator] Handling Control action"
                );

                // ⭐ 检查是否需要先搜索歌单
                // 如果 suggestedCapabilities 包含 netease.searchPlaylist，说明需要先搜索
                // 这种情况下不要在这里创建 music.playlist 步骤，让 process_additional_capabilities 处理
                let needs_playlist_search = intent
                    .suggested_capabilities
                    .iter()
                    .any(|c| c.to_lowercase() == "netease.searchplaylist");

                let selected_capability = self.select_control_capability(intent, &capabilities);
                let is_playlist_capability = selected_capability == "music.playlist";

                if needs_playlist_search && is_playlist_capability {
                    // 需要搜索歌单的情况，跳过这里的步骤创建
                    // process_additional_capabilities 会按正确顺序添加 searchPlaylist + playlist
                    tracing::info!(
                        "[RecipeGenerator] Skipping music.playlist in Control - will be handled by process_additional_capabilities with searchPlaylist"
                    );
                } else {
                    // 普通控制操作（播放/暂停/下一首等）
                    let control_step = RecipeStep {
                        id: "step_control".to_string(),
                        order: 0,
                        capability_id: selected_capability,
                        action: "control".to_string(),
                        params: self.build_control_params(intent),
                        depends_on: vec![],
                        on_failure: FailureStrategy::Abort,
                        retry: None,
                        timeout_ms: Some(5000),
                    };
                    recipe.add_step(control_step);
                }
            }
            _ => {
                // 默认：单步数据获取（如果有合适的能力）
                if let Some(data_step) = self.create_data_fetch_step(intent, &capabilities) {
                    recipe.add_step(data_step);
                }
            }
        }

        // ⭐ 关键：处理复合任务 - 检查 suggestedCapabilities 中是否有额外的能力需要执行
        // 这对于 AI 返回的复合任务非常重要，如 ["brew.items", "ai.summarize", "music.control"]
        self.process_additional_capabilities(recipe, intent, &capabilities)
            .await;

        Ok(())
    }

    /// 生成持续监控步骤
    async fn generate_continuous_steps(
        &self,
        recipe: &mut Recipe,
        intent: &ParsedIntent,
    ) -> Result<(), String> {
        // 第一步：设置监控配置
        let monitor_config = self.build_monitor_config(intent);

        let setup_step = RecipeStep {
            id: "step_setup_monitor".to_string(),
            order: 0,
            capability_id: "scheduler.create".to_string(),
            action: "create".to_string(),
            params: HashMap::from([
                (
                    "config".to_string(),
                    serde_json::to_value(&monitor_config).unwrap(),
                ),
                ("name".to_string(), json!(self.generate_recipe_name(intent))),
            ]),
            depends_on: vec![],
            on_failure: FailureStrategy::Abort,
            retry: Some(RetryConfig {
                max_attempts: 3,
                delay_ms: 2000,
                exponential_backoff: false,
            }),
            timeout_ms: Some(10000),
        };
        recipe.add_step(setup_step);

        // 第二步：执行首次检查（可选）
        let initial_check = RecipeStep {
            id: "step_initial_check".to_string(),
            order: 1,
            capability_id: "platform.read".to_string(),
            action: "read".to_string(),
            params: self.build_data_fetch_params(intent),
            depends_on: vec!["step_setup_monitor".to_string()],
            on_failure: FailureStrategy::Skip,
            retry: None,
            timeout_ms: Some(5000),
        };
        recipe.add_step(initial_check);

        // 添加监控元数据
        recipe.metadata.insert(
            "monitorConfig".to_string(),
            serde_json::to_value(&monitor_config).unwrap(),
        );

        Ok(())
    }

    /// 生成资源创建步骤
    async fn generate_creation_steps(
        &self,
        recipe: &mut Recipe,
        intent: &ParsedIntent,
    ) -> Result<(), String> {
        match &intent.target {
            IntentTarget::Tapp(_) => {
                // Tapp 创建流程
                // 第一步：分析需求
                let analyze_step = RecipeStep {
                    id: "step_analyze_requirements".to_string(),
                    order: 0,
                    capability_id: "ai.analyze".to_string(),
                    action: "analyze_requirements".to_string(),
                    params: HashMap::from([(
                        "description".to_string(),
                        json!(format!("{:?}", intent)),
                    )]),
                    depends_on: vec![],
                    on_failure: FailureStrategy::Abort,
                    retry: None,
                    timeout_ms: Some(15000),
                };
                recipe.add_step(analyze_step);

                // 第二步：生成代码
                let generate_step = RecipeStep {
                    id: "step_generate_code".to_string(),
                    order: 1,
                    capability_id: "tapp.generate".to_string(),
                    action: "generate".to_string(),
                    params: HashMap::from([(
                        "requirementsFrom".to_string(),
                        json!("step_analyze_requirements"),
                    )]),
                    depends_on: vec!["step_analyze_requirements".to_string()],
                    on_failure: FailureStrategy::Abort,
                    retry: Some(RetryConfig {
                        max_attempts: 2,
                        delay_ms: 2000,
                        exponential_backoff: false,
                    }),
                    timeout_ms: Some(60000),
                };
                recipe.add_step(generate_step);

                // 第三步：验证代码
                let validate_step = RecipeStep {
                    id: "step_validate".to_string(),
                    order: 2,
                    capability_id: "tapp.generate".to_string(),
                    action: "validate".to_string(),
                    params: HashMap::from([("codeFrom".to_string(), json!("step_generate_code"))]),
                    depends_on: vec!["step_generate_code".to_string()],
                    on_failure: FailureStrategy::Fallback("step_generate_code".to_string()),
                    retry: None,
                    timeout_ms: Some(10000),
                };
                recipe.add_step(validate_step);
            }
            IntentTarget::Report(_) => {
                // 报告创建流程
                // 第一步：收集数据
                let collect_step = RecipeStep {
                    id: "step_collect_data".to_string(),
                    order: 0,
                    capability_id: "platform.read".to_string(),
                    action: "read".to_string(),
                    params: self.build_data_fetch_params(intent),
                    depends_on: vec![],
                    on_failure: FailureStrategy::UseDefault(json!({"items": []})),
                    retry: None,
                    timeout_ms: Some(10000),
                };
                recipe.add_step(collect_step);

                // 第二步：分析数据
                let analyze_step = RecipeStep {
                    id: "step_analyze_data".to_string(),
                    order: 1,
                    capability_id: "ai.analyze".to_string(),
                    action: "analyze".to_string(),
                    params: HashMap::from([
                        ("inputFrom".to_string(), json!("step_collect_data")),
                        ("analysisType".to_string(), json!("comprehensive")),
                    ]),
                    depends_on: vec!["step_collect_data".to_string()],
                    on_failure: FailureStrategy::Abort,
                    retry: None,
                    timeout_ms: Some(30000),
                };
                recipe.add_step(analyze_step);

                // 第三步：生成报告
                let generate_step = RecipeStep {
                    id: "step_generate_report".to_string(),
                    order: 2,
                    capability_id: "report.create".to_string(),
                    action: "create".to_string(),
                    params: HashMap::from([
                        (
                            "title".to_string(),
                            json!(self.generate_recipe_name(intent)),
                        ),
                        ("analysisFrom".to_string(), json!("step_analyze_data")),
                        (
                            "format".to_string(),
                            json!(intent
                                .constraints
                                .output_format
                                .as_ref()
                                .map(|f| format!("{:?}", f).to_lowercase())
                                .unwrap_or_else(|| "markdown".to_string())),
                        ),
                    ]),
                    depends_on: vec!["step_analyze_data".to_string()],
                    on_failure: FailureStrategy::Abort,
                    retry: None,
                    timeout_ms: Some(15000),
                };
                recipe.add_step(generate_step);
            }
            IntentTarget::Brew(url_or_query) => {
                // Brew 订阅创建流程
                // 第一步：发现订阅源
                let mut discover_params = HashMap::new();
                if let Some(ref value) = url_or_query {
                    // 判断是 URL 还是查询词
                    let is_url = value.starts_with("http://")
                        || value.starts_with("https://")
                        || value.starts_with("www.")
                        || (value.contains('.') && !value.contains(' '));

                    if is_url {
                        discover_params.insert("url".to_string(), json!(value));
                    } else {
                        discover_params.insert("query".to_string(), json!(value));
                    }
                }
                // 如果有 filters 中的 url 或 query，也添加进来
                if let Some(url) = intent.constraints.filters.get("url") {
                    discover_params.insert("url".to_string(), url.clone());
                }
                if let Some(query) = intent.constraints.filters.get("query") {
                    discover_params.insert("query".to_string(), query.clone());
                }

                let discover_step = RecipeStep {
                    id: "step_discover".to_string(),
                    order: 0,
                    capability_id: "brew.discover".to_string(),
                    action: "discover".to_string(),
                    params: discover_params,
                    depends_on: vec![],
                    on_failure: FailureStrategy::Abort,
                    retry: Some(RetryConfig {
                        max_attempts: 2,
                        delay_ms: 1000,
                        exponential_backoff: false,
                    }),
                    timeout_ms: Some(15000),
                };
                recipe.add_step(discover_step);

                // 第二步：订阅源（如果发现成功）
                // 传递整个 feeds 列表，让订阅步骤智能选择可用的源
                let subscribe_step = RecipeStep {
                    id: "step_subscribe".to_string(),
                    order: 1,
                    capability_id: "brew.subscribe".to_string(),
                    action: "subscribe".to_string(),
                    params: HashMap::from([
                        // 传递整个 feeds 数组，订阅步骤会遍历尝试
                        ("feedsFrom".to_string(), json!("step_discover.feeds")),
                        (
                            "name".to_string(),
                            json!(url_or_query.clone().unwrap_or_default()),
                        ),
                        (
                            "category".to_string(),
                            json!(intent
                                .constraints
                                .filters
                                .get("category")
                                .and_then(|v| v.as_str())
                                .unwrap_or("默认")),
                        ),
                    ]),
                    depends_on: vec!["step_discover".to_string()],
                    on_failure: FailureStrategy::Abort,
                    retry: None,
                    timeout_ms: Some(30000), // 增加超时，因为可能需要尝试多个源
                };
                recipe.add_step(subscribe_step);
            }
            _ => {
                // 通用创建流程
                let create_step = RecipeStep {
                    id: "step_create".to_string(),
                    order: 0,
                    capability_id: "platform.write".to_string(),
                    action: "create".to_string(),
                    params: self.build_data_fetch_params(intent),
                    depends_on: vec![],
                    on_failure: FailureStrategy::Abort,
                    retry: None,
                    timeout_ms: Some(10000),
                };
                recipe.add_step(create_step);
            }
        }

        Ok(())
    }

    /// 生成批处理步骤
    async fn generate_batch_steps(
        &self,
        recipe: &mut Recipe,
        intent: &ParsedIntent,
    ) -> Result<(), String> {
        // 第一步：获取要处理的数据
        let fetch_step = RecipeStep {
            id: "step_fetch".to_string(),
            order: 0,
            capability_id: "platform.read".to_string(),
            action: "read".to_string(),
            params: self.build_data_fetch_params(intent),
            depends_on: vec![],
            on_failure: FailureStrategy::Abort,
            retry: None,
            timeout_ms: Some(10000),
        };
        recipe.add_step(fetch_step);

        // 第二步：数据转换/处理
        let transform_step = RecipeStep {
            id: "step_transform".to_string(),
            order: 1,
            capability_id: "data.transform".to_string(),
            action: match &intent.action {
                IntentAction::Export => "export",
                IntentAction::Update => "update",
                IntentAction::Delete => "delete",
                _ => "transform",
            }
            .to_string(),
            params: HashMap::from([
                ("inputFrom".to_string(), json!("step_fetch")),
                (
                    "pipeline".to_string(),
                    json!(self.build_transform_pipeline(intent)),
                ),
            ]),
            depends_on: vec!["step_fetch".to_string()],
            on_failure: FailureStrategy::Abort,
            retry: None,
            timeout_ms: Some(30000),
        };
        recipe.add_step(transform_step);

        // 如果是导出，添加导出步骤
        if matches!(intent.action, IntentAction::Export) {
            let export_step = RecipeStep {
                id: "step_export".to_string(),
                order: 2,
                capability_id: "storage.set".to_string(),
                action: "export".to_string(),
                params: HashMap::from([
                    ("inputFrom".to_string(), json!("step_transform")),
                    (
                        "format".to_string(),
                        json!(intent
                            .constraints
                            .output_format
                            .as_ref()
                            .map(|f| format!("{:?}", f).to_lowercase())
                            .unwrap_or_else(|| "json".to_string())),
                    ),
                ]),
                depends_on: vec!["step_transform".to_string()],
                on_failure: FailureStrategy::Abort,
                retry: None,
                timeout_ms: Some(10000),
            };
            recipe.add_step(export_step);
        }

        Ok(())
    }

    /// 创建数据获取步骤
    /// 返回 Option - 如果找不到合适的能力则返回 None
    fn create_data_fetch_step(
        &self,
        intent: &ParsedIntent,
        capabilities: &[Capability],
    ) -> Option<RecipeStep> {
        // 根据目标类型选择最合适的能力
        let capability_id = self.select_best_capability(intent, capabilities)?;

        Some(RecipeStep {
            id: "step_fetch_data".to_string(),
            order: 0,
            capability_id,
            action: "read".to_string(),
            params: self.build_data_fetch_params(intent),
            depends_on: vec![],
            on_failure: FailureStrategy::Abort,
            retry: Some(RetryConfig {
                max_attempts: 2,
                delay_ms: 500,
                exponential_backoff: false,
            }),
            timeout_ms: Some(10000),
        })
    }

    /// 根据意图选择最合适的能力
    /// 改进：返回 Option，找不到时返回 None 而不是强制 fallback
    /// 注意：此方法用于选择**数据获取**能力，会自动跳过 AI 处理能力
    fn select_best_capability(
        &self,
        intent: &ParsedIntent,
        capabilities: &[Capability],
    ) -> Option<String> {
        // AI 处理能力列表（这些不是数据获取能力，应该跳过）
        let ai_capabilities = [
            "ai.summarize",
            "ai.analyze",
            "ai.recommend",
            "ai.chat",
            "ai.websearch",
        ];

        // 🔴 内部能力黑名单：这些能力不应该被 AI 直接选择
        // brew.article 需要已知的文章 ID/URL，用户不可能通过语音提供
        let internal_only_capabilities = ["brew.article"];

        // 辅助函数：检查是否是 AI 能力
        let is_ai_capability = |cap: &str| -> bool {
            let cap_lower = cap.to_lowercase();
            ai_capabilities.iter().any(|ai| cap_lower == *ai)
        };

        // 辅助函数：检查是否是内部能力
        let is_internal_capability = |cap: &str| -> bool {
            let cap_lower = cap.to_lowercase();
            internal_only_capabilities
                .iter()
                .any(|internal| cap_lower == *internal)
        };

        // 1. 优先检查 AI 建议的能力（这是最重要的信号）
        if !intent.suggested_capabilities.is_empty() {
            tracing::info!(
                suggested = ?intent.suggested_capabilities,
                action = ?intent.action,
                "[RecipeGenerator] AI suggested capabilities"
            );

            // 🔴 新增：过滤掉 AI 能力和内部能力，只选择数据获取能力
            for suggested in &intent.suggested_capabilities {
                // 跳过 AI 处理能力
                if is_ai_capability(suggested) {
                    tracing::debug!(
                        capability = %suggested,
                        "[RecipeGenerator] Skipping AI capability for data fetch step"
                    );
                    continue;
                }

                // 🔴 跳过内部能力（如 brew.article）
                if is_internal_capability(suggested) {
                    tracing::warn!(
                        capability = %suggested,
                        "[RecipeGenerator] ⚠️ Skipping internal-only capability, will use fallback"
                    );
                    continue;
                }

                let suggested_lower = suggested.to_lowercase();

                // 精确匹配
                if capabilities
                    .iter()
                    .any(|c| c.id.to_lowercase() == suggested_lower)
                {
                    tracing::info!(
                        capability = %suggested,
                        "[RecipeGenerator] ✅ Using AI suggested capability (exact match)"
                    );
                    return Some(suggested.clone());
                }

                // 模糊匹配策略 1：AI 返回 "items" 而非 "brew.items"
                if let Some(matched) = capabilities.iter().find(|c| {
                    let cap_lower = c.id.to_lowercase();
                    cap_lower.ends_with(&format!(".{}", suggested_lower))
                        || cap_lower.ends_with(&suggested_lower)
                }) {
                    tracing::info!(
                        suggested = %suggested,
                        matched = %matched.id,
                        "[RecipeGenerator] ✅ Using AI suggested capability (suffix match)"
                    );
                    return Some(matched.id.clone());
                }

                // 模糊匹配策略 2：处理常见的变体
                // 如 "webSearch" -> "ai.webSearch", "summarize" -> "ai.summarize"
                let variants = vec![
                    format!("ai.{}", suggested_lower),
                    format!("brew.{}", suggested_lower),
                    format!("platform.{}", suggested_lower),
                    format!("tapp.{}", suggested_lower),
                    format!("music.{}", suggested_lower),
                    format!("report.{}", suggested_lower),
                ];

                for variant in variants {
                    if let Some(matched) =
                        capabilities.iter().find(|c| c.id.to_lowercase() == variant)
                    {
                        tracing::info!(
                            suggested = %suggested,
                            matched = %matched.id,
                            "[RecipeGenerator] ✅ Using AI suggested capability (variant match)"
                        );
                        return Some(matched.id.clone());
                    }
                }
            }

            // AI 建议的能力都不在列表中，记录警告但继续尝试规则匹配
            tracing::warn!(
                suggested = ?intent.suggested_capabilities,
                available = ?capabilities.iter().map(|c| &c.id).collect::<Vec<_>>(),
                "[RecipeGenerator] ⚠️ AI suggested capabilities not found, falling back to rule-based"
            );
        }

        // 2. 根据意图目标类型选择最合适的能力
        let selected = match &intent.target {
            IntentTarget::Platform(platform) => {
                // 按平台选择更精确的能力
                let platform_specific = capabilities.iter().find(|c| {
                    c.id.starts_with(&format!("{}.", platform)) || c.id.contains(platform)
                });
                if let Some(specific) = platform_specific {
                    Some(specific.id.clone())
                } else if capabilities.iter().any(|c| c.id == "platform.read") {
                    Some("platform.read".to_string())
                } else {
                    capabilities.first().map(|c| c.id.clone())
                }
            }
            IntentTarget::Brew(_) => {
                // Brew 相关优先使用 brew.* 能力
                // 🔴 修复优先级：获取内容时优先 brew.items，订阅操作才用 brew.subscribe
                // 按优先级查找：brew.items > brew.article > brew.read > brew.subscribe > brew.discover > brew.*
                let brew_items = capabilities.iter().find(|c| c.id == "brew.items");
                let brew_article = capabilities.iter().find(|c| c.id == "brew.article");
                let brew_read = capabilities.iter().find(|c| c.id == "brew.read");
                let brew_subscribe = capabilities.iter().find(|c| c.id == "brew.subscribe");
                let brew_discover = capabilities.iter().find(|c| c.id == "brew.discover");
                let any_brew = capabilities.iter().find(|c| c.id.starts_with("brew."));

                // 🔴 重要：根据 action 类型决定优先级
                // 如果是 Summarize/Analyze/Query，优先 brew.items（获取文章列表）
                // 如果是 Create，优先 brew.subscribe（订阅操作）
                match &intent.action {
                    IntentAction::Summarize
                    | IntentAction::Analyze
                    | IntentAction::Query
                    | IntentAction::Navigate => {
                        // 获取内容操作：优先 brew.items
                        brew_items
                            .or(brew_article)
                            .or(brew_read)
                            .or(any_brew)
                            .map(|c| c.id.clone())
                    }
                    IntentAction::Create => {
                        // 创建/订阅操作：优先 brew.subscribe
                        brew_subscribe
                            .or(brew_discover)
                            .or(any_brew)
                            .map(|c| c.id.clone())
                    }
                    _ => {
                        // 其他操作：默认优先 brew.items
                        brew_items.or(brew_read).or(any_brew).map(|c| c.id.clone())
                    }
                }
                .or_else(|| {
                    // 如果没有 brew 能力，但意图明确是 Brew，记录警告
                    tracing::warn!(
                        target = ?intent.target,
                        action = ?intent.action,
                        "[RecipeGenerator] No brew capability found for Brew intent"
                    );
                    None
                })
            }
            IntentTarget::Tapp(_) => {
                // Tapp 相关优先使用 tapp.* 能力
                capabilities
                    .iter()
                    .find(|c| c.id.starts_with("tapp."))
                    .map(|c| c.id.clone())
            }
            IntentTarget::Report(_) => {
                // 报告相关
                capabilities
                    .iter()
                    .find(|c| c.id.starts_with("report."))
                    .map(|c| c.id.clone())
            }
            IntentTarget::Music(value) => {
                // 音乐播放器相关
                match value.as_deref() {
                    Some("status") => Some("music.status".to_string()),
                    Some("playlist") => Some("music.playlist".to_string()),
                    _ => {
                        // 默认使用 music.control（播放/暂停等控制操作）
                        capabilities
                            .iter()
                            .find(|c| c.id == "music.control")
                            .or_else(|| capabilities.iter().find(|c| c.id.starts_with("music.")))
                            .map(|c| c.id.clone())
                    }
                }
            }
            IntentTarget::Profile => Some("profile.summary".to_string()),
            IntentTarget::Data(data_type) => {
                // 根据数据类型选择能力
                if data_type == "web_search" {
                    // 联网搜索使用 ai.webSearch
                    Some("ai.webSearch".to_string())
                } else {
                    // 其他数据类型使用通用搜索或读取
                    capabilities
                        .iter()
                        .find(|c| c.id == "search.global" || c.id == "platform.read")
                        .map(|c| c.id.clone())
                }
            }
            IntentTarget::CurrentPage(page_type) => {
                // 根据当前页面类型选择能力
                match page_type.as_str() {
                    "brew" => {
                        // 在 Brew 页面，获取订阅列表或内容
                        capabilities
                            .iter()
                            .find(|c| c.id == "brew.read" || c.id == "brew.list")
                            .map(|c| c.id.clone())
                    }
                    "tapp" => capabilities
                        .iter()
                        .find(|c| c.id.starts_with("tapp."))
                        .map(|c| c.id.clone()),
                    "report" => capabilities
                        .iter()
                        .find(|c| c.id.starts_with("report."))
                        .map(|c| c.id.clone()),
                    "dashboard" => {
                        // 仪表盘页面，获取概览数据
                        capabilities
                            .iter()
                            .find(|c| c.id == "platform.read" || c.id == "profile.summary")
                            .map(|c| c.id.clone())
                    }
                    _ => {
                        // 其他页面类型，尝试通用读取
                        capabilities
                            .iter()
                            .find(|c| c.id == "platform.read" || c.id == "search.global")
                            .map(|c| c.id.clone())
                    }
                }
            }
            IntentTarget::Unspecified => {
                // 对于未指定目标，使用全局搜索或信息能力
                // 检查是否有搜索相关的关键词或过滤条件
                if !intent.constraints.filters.is_empty() {
                    // 有过滤条件，使用全局搜索
                    Some("search.global".to_string())
                } else {
                    // 没有特定需求，尝试使用 AI 聊天或分析
                    capabilities
                        .iter()
                        .find(|c| c.id == "ai.chat" || c.id == "ai.analyze")
                        .map(|c| c.id.clone())
                        .or_else(|| capabilities.first().map(|c| c.id.clone()))
                }
            }
            _ => capabilities.first().map(|c| c.id.clone()),
        };

        // 3. 如果找到了合适的能力，返回
        if let Some(cap_id) = selected {
            return Some(cap_id);
        }

        // 4. 没有找到合适的能力 - 返回 None，让上层处理
        // 注意：不再 fallback 到任意能力，因为这会导致参数缺失等错误
        tracing::warn!(
            target = ?intent.target,
            action = ?intent.action,
            available = ?capabilities.iter().map(|c| &c.id).collect::<Vec<_>>(),
            "[RecipeGenerator] No suitable capability found for intent"
        );

        None
    }

    /// 构建数据获取参数
    fn build_data_fetch_params(&self, intent: &ParsedIntent) -> HashMap<String, Value> {
        let mut params = HashMap::new();

        // 尝试从各种来源提取搜索查询关键词
        let extract_query = || -> Option<String> {
            // 1. 首先检查 filters 中的关键词
            if let Some(query) = intent
                .constraints
                .filters
                .get("keyword")
                .or(intent.constraints.filters.get("query"))
                .or(intent.constraints.filters.get("search"))
                .and_then(|v| v.as_str())
            {
                if !query.is_empty() {
                    return Some(query.to_string());
                }
            }
            // 2. 检查 entities 中的主题
            if let Some(entities) = intent.constraints.filters.get("entities") {
                if let Some(arr) = entities.as_array() {
                    let topics: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
                    if !topics.is_empty() {
                        return Some(topics.join(" "));
                    }
                }
            }
            // 3. 从 target 中提取（如果是特定主题）
            if let IntentTarget::Data(data_type) = &intent.target {
                if data_type != "web_search" && data_type != "analysis_report" {
                    return Some(data_type.clone());
                }
            }
            None
        };

        // 平台参数
        match &intent.target {
            IntentTarget::Platform(platform) => {
                params.insert("platform".to_string(), json!(platform));
            }
            IntentTarget::Data(data_type) => {
                // 数据类型相关参数
                if data_type == "web_search" || data_type == "analysis_report" {
                    // 联网搜索参数
                    if let Some(query) = extract_query() {
                        params.insert("query".to_string(), json!(query));
                    }
                    // 搜索类型
                    if let Some(search_type) = intent.constraints.filters.get("searchType") {
                        params.insert("searchType".to_string(), search_type.clone());
                    } else {
                        params.insert("searchType".to_string(), json!("general"));
                    }
                    // 结果数量
                    params.insert(
                        "maxResults".to_string(),
                        json!(intent.constraints.limit.unwrap_or(5)),
                    );
                }
            }
            IntentTarget::CurrentPage(page_type) => {
                // 根据当前页面类型设置参数
                params.insert("pageType".to_string(), json!(page_type));
                match page_type.as_str() {
                    "brew" => {
                        // Brew 页面：获取订阅内容
                        params.insert("includeItems".to_string(), json!(true));
                        params.insert(
                            "limit".to_string(),
                            json!(intent.constraints.limit.unwrap_or(20)),
                        );
                    }
                    "tapp" => {
                        // Tapp 页面
                        params.insert("includeState".to_string(), json!(true));
                    }
                    "dashboard" => {
                        // 仪表盘：获取所有平台概览
                        params.insert(
                            "platforms".to_string(),
                            json!(["steam", "bilibili", "github", "netease"]),
                        );
                        params.insert("summary".to_string(), json!(true));
                    }
                    _ => {
                        // 其他页面
                        if let Some(query) = extract_query() {
                            params.insert("query".to_string(), json!(query));
                        }
                    }
                }
            }
            IntentTarget::Unspecified => {
                // 对于未指定目标，如果有过滤条件作为搜索关键词
                if let Some(query) = extract_query() {
                    params.insert("query".to_string(), json!(query));
                }
                // 设置搜索所有平台
                params.insert(
                    "platforms".to_string(),
                    json!(["steam", "bilibili", "github", "netease"]),
                );
            }
            _ => {}
        }

        // 数量限制
        if let Some(limit) = intent.constraints.limit {
            params.insert("limit".to_string(), json!(limit));
        }

        // 时间范围
        if let Some(time_range) = &intent.constraints.time_range {
            if let Some(start) = &time_range.start {
                params.insert("since".to_string(), json!(start.to_rfc3339()));
            }
            if let Some(end) = &time_range.end {
                params.insert("until".to_string(), json!(end.to_rfc3339()));
            }
        }

        // 过滤条件 - 展开到参数顶层以便执行器直接读取
        for (key, value) in &intent.constraints.filters {
            // 将 filters 中的每个字段展开到 params 顶层
            params.insert(key.clone(), value.clone());
        }
        // 同时保留完整的 filters 对象（向后兼容）
        if !intent.constraints.filters.is_empty() {
            params.insert("filters".to_string(), json!(intent.constraints.filters));
        }

        // 排序
        if let Some(sort) = &intent.constraints.sort {
            params.insert(
                "sort".to_string(),
                json!({
                    "field": sort.field,
                    "order": format!("{:?}", sort.order).to_lowercase()
                }),
            );
        }

        params
    }

    /// 为导航操作选择合适的能力
    fn select_navigate_capability(
        &self,
        intent: &ParsedIntent,
        capabilities: &[Capability],
    ) -> String {
        // 根据目标类型选择能力
        match &intent.target {
            IntentTarget::Brew(_) => {
                // Brew 相关：优先使用 brew.items 获取文章列表，然后导航
                if capabilities.iter().any(|c| c.id == "brew.items") {
                    "brew.items".to_string()
                } else if capabilities.iter().any(|c| c.id == "brew.read") {
                    "brew.read".to_string()
                } else {
                    "brew.items".to_string()
                }
            }
            IntentTarget::CurrentPage(page) if page.as_str() == "brew" => {
                // Brew 相关：优先使用 brew.items 获取文章列表，然后导航
                if capabilities.iter().any(|c| c.id == "brew.items") {
                    "brew.items".to_string()
                } else if capabilities.iter().any(|c| c.id == "brew.read") {
                    "brew.read".to_string()
                } else {
                    "brew.items".to_string()
                }
            }
            IntentTarget::Tapp(_) => "tapp.page".to_string(),
            IntentTarget::Platform(platform) => format!("platform.{}", platform),
            _ => {
                // 默认：尝试匹配可用能力中的导航相关能力
                for cap in capabilities {
                    if cap.id.contains("items")
                        || cap.id.contains("list")
                        || cap.id.contains("page")
                    {
                        return cap.id.clone();
                    }
                }
                // 最后回退到 brew.items（假设是 Brew 场景）
                "brew.items".to_string()
            }
        }
    }

    /// 构建导航参数
    fn build_navigate_params(&self, intent: &ParsedIntent) -> HashMap<String, Value> {
        let mut params = HashMap::new();

        // 标记这是导航操作
        params.insert("action".to_string(), json!("navigate"));

        // 🔴 调试日志：检查 filters 内容
        tracing::info!(
            filters = ?intent.constraints.filters,
            "[build_navigate_params] Intent filters"
        );

        // 提取目标关键词
        let keyword = self.extract_navigate_keyword(intent);
        if let Some(kw) = &keyword {
            params.insert("keyword".to_string(), json!(kw));
            params.insert("query".to_string(), json!(kw));
        }

        // 根据目标类型设置参数
        match &intent.target {
            IntentTarget::Brew(brew_name) => {
                params.insert("targetType".to_string(), json!("brew"));
                if let Some(name) = brew_name {
                    params.insert("name".to_string(), json!(name));
                }
            }
            IntentTarget::Tapp(tapp_name) => {
                params.insert("targetType".to_string(), json!("tapp"));
                if let Some(name) = tapp_name {
                    params.insert("name".to_string(), json!(name));
                }
            }
            IntentTarget::CurrentPage(page_type) => {
                params.insert("targetType".to_string(), json!(page_type));
            }
            _ => {
                params.insert("targetType".to_string(), json!("auto"));
            }
        }

        // 🔴 关键：展开 filters 到参数顶层（author, sourceName 等）
        for (key, value) in &intent.constraints.filters {
            params.insert(key.clone(), value.clone());
        }

        // 获取最新/第一项
        params.insert("limit".to_string(), json!(1));
        params.insert("selectFirst".to_string(), json!(true));

        params
    }

    /// 从意图中提取导航关键词
    fn extract_navigate_keyword(&self, intent: &ParsedIntent) -> Option<String> {
        // 1. 从过滤器中提取
        if let Some(kw) = intent
            .constraints
            .filters
            .get("keyword")
            .or(intent.constraints.filters.get("query"))
            .and_then(|v| v.as_str())
        {
            if !kw.is_empty() {
                return Some(kw.to_string());
            }
        }

        // 2. 从实体中提取
        if let Some(entities) = intent.constraints.filters.get("entities") {
            if let Some(arr) = entities.as_array() {
                let topics: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
                if !topics.is_empty() {
                    return Some(topics.join(" "));
                }
            }
        }

        // 3. 从目标中提取
        match &intent.target {
            IntentTarget::Brew(name) => name.clone(),
            IntentTarget::Tapp(name) => name.clone(),
            IntentTarget::Data(data_type) => Some(data_type.clone()),
            _ => None,
        }
    }

    /// ⭐ 处理复合任务中的额外能力
    ///
    /// 当 AI 返回的 suggestedCapabilities 包含多个能力时（如复合任务），
    /// 这个方法会检查并生成主 action 之外的额外步骤。
    ///
    /// 例如：用户说 "打开文章并播放音乐"
    /// - AI 返回 suggestedCapabilities: ["brew.items", "music.control"]
    /// - generate_instant_steps 会处理 Navigate -> brew.items
    /// - 这个方法会添加 music.control 步骤
    async fn process_additional_capabilities(
        &self,
        recipe: &mut Recipe,
        intent: &ParsedIntent,
        capabilities: &[Capability],
    ) {
        if intent.suggested_capabilities.is_empty() {
            return;
        }

        // 收集已经添加的能力 ID
        let existing_capability_ids: Vec<String> = recipe
            .steps
            .iter()
            .map(|s| s.capability_id.clone())
            .collect();

        tracing::info!(
            suggested = ?intent.suggested_capabilities,
            existing = ?existing_capability_ids,
            "[process_additional_capabilities] Checking for additional capabilities"
        );

        // 检查每个建议的能力是否已经处理
        for suggested_cap in &intent.suggested_capabilities {
            let suggested_lower = suggested_cap.to_lowercase();

            // 检查是否已经存在
            let already_exists = existing_capability_ids.iter().any(|existing| {
                let existing_lower = existing.to_lowercase();
                existing_lower == suggested_lower
                    || existing_lower.ends_with(&format!(".{}", suggested_lower))
                    || suggested_lower.ends_with(&format!(".{}", existing_lower))
            });

            if already_exists {
                tracing::debug!(
                    capability = %suggested_cap,
                    "[process_additional_capabilities] Capability already exists, skipping"
                );
                continue;
            }

            // 标准化能力 ID
            let normalized_cap = self.normalize_capability_id(suggested_cap, capabilities);
            let normalized_lower = normalized_cap.to_lowercase();

            // 🎵 处理音乐控制能力
            if normalized_lower.starts_with("music.") {
                tracing::info!(
                    capability = %normalized_cap,
                    "[process_additional_capabilities] ✅ Adding music control step"
                );

                let music_step = RecipeStep {
                    id: format!("step_music_{}", recipe.steps.len()),
                    order: recipe.steps.len() as u32,
                    capability_id: normalized_cap.clone(),
                    action: "control".to_string(),
                    params: self.build_music_control_params_default(intent),
                    depends_on: vec![], // 音乐控制通常不依赖其他步骤
                    on_failure: FailureStrategy::Skip, // 音乐控制失败不应该中断整个任务
                    retry: None,
                    timeout_ms: Some(5000),
                };
                recipe.add_step(music_step);
                continue;
            }

            // 🤖 处理 AI 能力（如果主 action 不是对应的 AI 操作）
            if normalized_lower == "ai.summarize"
                && !existing_capability_ids
                    .iter()
                    .any(|c| c.to_lowercase() == "ai.summarize")
            {
                tracing::info!("[process_additional_capabilities] ✅ Adding AI summarize step");

                // 找到数据源步骤
                let data_source = existing_capability_ids
                    .iter()
                    .find(|c| {
                        let c_lower = c.to_lowercase();
                        c_lower.starts_with("brew.")
                            || c_lower.starts_with("platform.")
                            || c_lower.starts_with("tapp.")
                    })
                    .cloned();

                let depends_on = if let Some(ref ds) = data_source {
                    recipe
                        .steps
                        .iter()
                        .find(|s| s.capability_id == *ds)
                        .map(|s| vec![s.id.clone()])
                        .unwrap_or_default()
                } else {
                    vec![]
                };

                let input_from = if let Some(ref ds) = data_source {
                    recipe
                        .steps
                        .iter()
                        .find(|s| s.capability_id == *ds)
                        .map(|s| s.id.clone())
                        .unwrap_or_else(|| "__page_context__".to_string())
                } else {
                    "__page_context__".to_string()
                };

                let summarize_step = RecipeStep {
                    id: format!("step_summarize_{}", recipe.steps.len()),
                    order: recipe.steps.len() as u32,
                    capability_id: "ai.summarize".to_string(),
                    action: "summarize".to_string(),
                    params: HashMap::from([
                        ("inputFrom".to_string(), json!(input_from)),
                        ("style".to_string(), json!("brief")),
                    ]),
                    depends_on,
                    on_failure: FailureStrategy::Abort,
                    retry: Some(RetryConfig {
                        max_attempts: 2,
                        delay_ms: 1000,
                        exponential_backoff: true,
                    }),
                    timeout_ms: Some(30000),
                };
                recipe.add_step(summarize_step);
                continue;
            }

            if normalized_lower == "ai.analyze"
                && !existing_capability_ids
                    .iter()
                    .any(|c| c.to_lowercase() == "ai.analyze")
            {
                tracing::info!("[process_additional_capabilities] ✅ Adding AI analyze step");

                let data_source = existing_capability_ids
                    .iter()
                    .find(|c| {
                        let c_lower = c.to_lowercase();
                        c_lower.starts_with("brew.")
                            || c_lower.starts_with("platform.")
                            || c_lower.starts_with("tapp.")
                    })
                    .cloned();

                let depends_on = if let Some(ref ds) = data_source {
                    recipe
                        .steps
                        .iter()
                        .find(|s| s.capability_id == *ds)
                        .map(|s| vec![s.id.clone()])
                        .unwrap_or_default()
                } else {
                    vec![]
                };

                let input_from = if let Some(ref ds) = data_source {
                    recipe
                        .steps
                        .iter()
                        .find(|s| s.capability_id == *ds)
                        .map(|s| s.id.clone())
                        .unwrap_or_else(|| "__page_context__".to_string())
                } else {
                    "__page_context__".to_string()
                };

                let analyze_step = RecipeStep {
                    id: format!("step_analyze_{}", recipe.steps.len()),
                    order: recipe.steps.len() as u32,
                    capability_id: "ai.analyze".to_string(),
                    action: "analyze".to_string(),
                    params: HashMap::from([
                        ("inputFrom".to_string(), json!(input_from)),
                        ("analysisType".to_string(), json!("custom")),
                    ]),
                    depends_on,
                    on_failure: FailureStrategy::Abort,
                    retry: Some(RetryConfig {
                        max_attempts: 2,
                        delay_ms: 1000,
                        exponential_backoff: true,
                    }),
                    timeout_ms: Some(60000),
                };
                recipe.add_step(analyze_step);
                continue;
            }

            // 🔍 处理联网搜索能力
            if normalized_lower == "ai.websearch"
                && !existing_capability_ids
                    .iter()
                    .any(|c| c.to_lowercase() == "ai.websearch")
            {
                tracing::info!("[process_additional_capabilities] ✅ Adding AI webSearch step");

                // 从 intent 中提取搜索查询
                let search_query = intent
                    .constraints
                    .filters
                    .get("query")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        // 尝试从原始输入中提取搜索关键词
                        // 移除常见的命令词，保留搜索内容
                        None
                    })
                    .unwrap_or_else(|| "推荐".to_string());

                let websearch_step = RecipeStep {
                    id: format!("step_websearch_{}", recipe.steps.len()),
                    order: recipe.steps.len() as u32,
                    capability_id: "ai.webSearch".to_string(),
                    action: "search".to_string(),
                    params: HashMap::from([
                        ("query".to_string(), json!(search_query)),
                        ("maxResults".to_string(), json!(5)),
                    ]),
                    depends_on: vec![], // 联网搜索通常不依赖其他步骤
                    on_failure: FailureStrategy::Skip, // 搜索失败不应该中断整个任务
                    retry: Some(RetryConfig {
                        max_attempts: 2,
                        delay_ms: 1000,
                        exponential_backoff: true,
                    }),
                    timeout_ms: Some(30000),
                };
                recipe.add_step(websearch_step);
                continue;
            }

            // 🎵 处理网易云歌单搜索能力
            if normalized_lower == "netease.searchplaylist"
                && !existing_capability_ids
                    .iter()
                    .any(|c| c.to_lowercase() == "netease.searchplaylist")
            {
                tracing::info!("[process_additional_capabilities] ✅ Adding netease.searchPlaylist step");

                // 从 intent 中提取音乐搜索关键词
                let music_keyword = intent
                    .constraints
                    .filters
                    .get("musicKeyword")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        intent
                            .constraints
                            .filters
                            .get("keyword")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| "轻音乐".to_string());

                let search_step = RecipeStep {
                    id: format!("step_search_playlist_{}", recipe.steps.len()),
                    order: recipe.steps.len() as u32,
                    capability_id: "netease.searchPlaylist".to_string(),
                    action: "search".to_string(),
                    params: HashMap::from([
                        ("keyword".to_string(), json!(music_keyword)),
                        ("limit".to_string(), json!(5)),
                    ]),
                    depends_on: vec![],
                    on_failure: FailureStrategy::Skip,
                    retry: Some(RetryConfig {
                        max_attempts: 2,
                        delay_ms: 1000,
                        exponential_backoff: true,
                    }),
                    timeout_ms: Some(10000),
                };
                recipe.add_step(search_step);
                continue;
            }

            // 🎵 处理歌单播放能力
            if normalized_lower == "music.playlist"
                && !existing_capability_ids
                    .iter()
                    .any(|c| c.to_lowercase() == "music.playlist")
            {
                tracing::info!("[process_additional_capabilities] ✅ Adding music.playlist step");

                // 找到搜索歌单的步骤，依赖它获取歌单ID
                let search_step = recipe
                    .steps
                    .iter()
                    .find(|s| s.capability_id.to_lowercase() == "netease.searchplaylist");

                let (depends_on, playlist_id_ref) = if let Some(step) = search_step {
                    // 使用 xxxFrom 引用语法，让 resolve_params 自动解析
                    (vec![step.id.clone()], format!("{}.recommendedPlaylistId", step.id))
                } else {
                    (vec![], String::new())
                };

                let playlist_step = RecipeStep {
                    id: format!("step_play_playlist_{}", recipe.steps.len()),
                    order: recipe.steps.len() as u32,
                    capability_id: "music.playlist".to_string(),
                    action: "play".to_string(),
                    params: HashMap::from([
                        // 使用 xxxFrom 后缀，resolve_params 会解析并转成 playlistId
                        ("playlistIdFrom".to_string(), json!(playlist_id_ref)),
                        ("source".to_string(), json!("netease")),
                        ("autoPlay".to_string(), json!(true)),
                    ]),
                    depends_on,
                    on_failure: FailureStrategy::Skip,
                    retry: None,
                    timeout_ms: Some(5000),
                };
                recipe.add_step(playlist_step);
                continue;
            }

            // 其他能力可以在这里添加处理逻辑
            tracing::debug!(
                capability = %suggested_cap,
                "[process_additional_capabilities] Unhandled additional capability"
            );
        }

        if recipe.steps.len() > existing_capability_ids.len() {
            tracing::info!(
                original_steps = existing_capability_ids.len(),
                final_steps = recipe.steps.len(),
                "[process_additional_capabilities] ✅ Added {} additional steps",
                recipe.steps.len() - existing_capability_ids.len()
            );
        }
    }

    /// 标准化能力 ID
    /// 将简写形式（如 "control"）转换为完整形式（如 "music.control"）
    fn normalize_capability_id(&self, cap_id: &str, capabilities: &[Capability]) -> String {
        let cap_lower = cap_id.to_lowercase();

        // 如果已经是完整形式，直接返回
        if cap_lower.contains('.') {
            return cap_id.to_string();
        }

        // 尝试匹配可用能力
        let prefixes = ["music.", "ai.", "brew.", "platform.", "tapp.", "report."];
        for prefix in prefixes {
            let full_id = format!("{}{}", prefix, cap_lower);
            if capabilities.iter().any(|c| c.id.to_lowercase() == full_id) {
                return full_id;
            }
        }

        // 无法匹配，返回原始值
        cap_id.to_string()
    }

    /// 构建默认的音乐控制参数
    fn build_music_control_params_default(&self, intent: &ParsedIntent) -> HashMap<String, Value> {
        let mut params = HashMap::new();

        // 从 intent 中提取控制动作，默认为 play
        let action = intent
            .constraints
            .filters
            .get("controlAction")
            .and_then(|v| v.as_str())
            .or_else(|| {
                intent
                    .constraints
                    .filters
                    .get("action")
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("play");

        params.insert("action".to_string(), json!(action));

        // 如果有音量值
        if let Some(value) = intent
            .constraints
            .filters
            .get("value")
            .and_then(|v| v.as_i64())
        {
            params.insert("value".to_string(), json!(value));
        }

        // 如果有跳转位置
        if let Some(seek) = intent
            .constraints
            .filters
            .get("seekPosition")
            .and_then(|v| v.as_i64())
        {
            params.insert("seekPosition".to_string(), json!(seek));
        }

        params
    }

    /// 为控制操作选择合适的能力
    fn select_control_capability(
        &self,
        intent: &ParsedIntent,
        capabilities: &[Capability],
    ) -> String {
        // 根据目标类型选择能力
        match &intent.target {
            IntentTarget::Music(value) => match value.as_deref() {
                Some("status") => "music.status".to_string(),
                Some("playlist") => "music.playlist".to_string(),
                _ => "music.control".to_string(),
            },
            _ => {
                // 尝试从可用能力中找到控制类能力
                for cap in capabilities {
                    if cap.id.starts_with("music.") {
                        return cap.id.clone();
                    }
                }
                // 默认使用 music.control
                "music.control".to_string()
            }
        }
    }

    /// 构建控制操作参数
    fn build_control_params(&self, intent: &ParsedIntent) -> HashMap<String, Value> {
        let mut params = HashMap::new();

        // 🔴 调试日志
        tracing::info!(
            filters = ?intent.constraints.filters,
            target = ?intent.target,
            "[build_control_params] Building control params"
        );

        // 从 filters 中提取控制动作
        // AI 可能将动作放在 controlAction 字段中
        let action = intent
            .constraints
            .filters
            .get("controlAction")
            .and_then(|v| v.as_str())
            .or_else(|| {
                intent
                    .constraints
                    .filters
                    .get("action")
                    .and_then(|v| v.as_str())
            })
            .unwrap_or_else(|| {
                // 如果没有指定动作，根据用户的原始意图推断
                // "播放音乐" -> play
                // "暂停" -> pause
                // 默认为 play
                "play"
            });

        params.insert("action".to_string(), json!(action));

        // 音量值（如果有）
        if let Some(volume) = intent
            .constraints
            .filters
            .get("volume")
            .or(intent.constraints.filters.get("value"))
        {
            params.insert("volume".to_string(), volume.clone());
        }

        // 快进/后退位置（如果有）
        if let Some(position) = intent
            .constraints
            .filters
            .get("seekPosition")
            .or(intent.constraints.filters.get("position"))
        {
            params.insert("position".to_string(), position.clone());
        }

        // 歌单名称（如果是播放歌单）
        if let Some(playlist) = intent
            .constraints
            .filters
            .get("playlistName")
            .or(intent.constraints.filters.get("playlist"))
        {
            params.insert("playlistName".to_string(), playlist.clone());
        }

        params
    }

    /// 构建监控配置
    fn build_monitor_config(&self, intent: &ParsedIntent) -> MonitorConfig {
        // 默认检查间隔：1小时
        let interval_secs = 3600;

        // 构建触发条件
        let mut trigger_conditions = vec![];

        // 根据目标类型设置默认触发条件
        match &intent.target {
            IntentTarget::Platform(platform) => {
                trigger_conditions.push(TriggerCondition {
                    condition_type: ConditionType::NewItem,
                    field: "items".to_string(),
                    operator: "count_gt".to_string(),
                    threshold: json!(0),
                });

                // 如果有过滤条件，添加关键词触发
                for (field, value) in &intent.constraints.filters {
                    if let Some(keyword) = value.as_str() {
                        trigger_conditions.push(TriggerCondition {
                            condition_type: ConditionType::KeywordMatch,
                            field: field.clone(),
                            operator: "contains".to_string(),
                            threshold: json!(keyword),
                        });
                    }
                }

                tracing::debug!(
                    platform = %platform,
                    conditions = ?trigger_conditions,
                    "[RecipeGenerator] Built monitor config for platform"
                );
            }
            _ => {
                // 默认：任何变化都触发
                trigger_conditions.push(TriggerCondition {
                    condition_type: ConditionType::ValueChange,
                    field: "*".to_string(),
                    operator: "changed".to_string(),
                    threshold: json!(true),
                });
            }
        }

        // 有效期：默认30天
        let valid_until = chrono::Utc::now() + chrono::Duration::days(30);

        MonitorConfig {
            id: uuid::Uuid::new_v4().to_string(),
            interval_secs,
            trigger_conditions,
            notify_methods: vec![NotifyMethod::SystemNotification, NotifyMethod::Toast],
            valid_until: Some(valid_until),
            enabled: true,
        }
    }

    /// 构建数据转换管道
    fn build_transform_pipeline(&self, intent: &ParsedIntent) -> Vec<Value> {
        let mut pipeline = vec![];

        // 过滤步骤
        for (field, value) in &intent.constraints.filters {
            pipeline.push(json!({
                "type": "filter",
                "field": field,
                "operator": "eq",
                "value": value
            }));
        }

        // 排序步骤
        if let Some(sort) = &intent.constraints.sort {
            pipeline.push(json!({
                "type": "sort",
                "field": sort.field,
                "order": format!("{:?}", sort.order).to_lowercase()
            }));
        }

        // 限制步骤
        if let Some(limit) = intent.constraints.limit {
            pipeline.push(json!({
                "type": "limit",
                "count": limit
            }));
        }

        pipeline
    }
}

impl Default for RecipeGenerator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_intent(action: IntentAction, target: IntentTarget) -> ParsedIntent {
        ParsedIntent {
            id: "test".to_string(),
            action,
            target,
            constraints: IntentConstraints::default(),
            confidence: 0.9,
            clarifications_needed: vec![],
            sub_intents: vec![],
            suggested_capabilities: vec![],
            unsupported_reason: None,
        }
    }

    #[test]
    fn test_determine_execution_type() {
        let generator = RecipeGenerator::new();

        // 监控 -> Continuous
        let intent = create_test_intent(
            IntentAction::Monitor,
            IntentTarget::Platform("steam".to_string()),
        );
        assert_eq!(
            generator.determine_execution_type(&intent),
            ExecutionType::Continuous
        );

        // 创建 Tapp -> Creation
        let intent = create_test_intent(IntentAction::Create, IntentTarget::Tapp(None));
        assert_eq!(
            generator.determine_execution_type(&intent),
            ExecutionType::Creation
        );

        // 查询 -> Instant
        let intent = create_test_intent(
            IntentAction::Query,
            IntentTarget::Platform("bilibili".to_string()),
        );
        assert_eq!(
            generator.determine_execution_type(&intent),
            ExecutionType::Instant
        );

        // 导出 -> Batch
        let intent = create_test_intent(
            IntentAction::Export,
            IntentTarget::Platform("github".to_string()),
        );
        assert_eq!(
            generator.determine_execution_type(&intent),
            ExecutionType::Batch
        );
    }

    #[test]
    fn test_generate_recipe_name() {
        let generator = RecipeGenerator::new();

        let intent = create_test_intent(
            IntentAction::Summarize,
            IntentTarget::Platform("bilibili".to_string()),
        );
        assert_eq!(generator.generate_recipe_name(&intent), "总结bilibili 数据");

        let intent = create_test_intent(IntentAction::Create, IntentTarget::Tapp(None));
        assert_eq!(generator.generate_recipe_name(&intent), "创建Tapp");
    }
}
