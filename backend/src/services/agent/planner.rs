//! Planner 模块
//!
//! 合并意图分析 + 方案生成为单次 Pro AI 调用。
//! 直接输出可执行的 Recipe 步骤。

use std::collections::HashMap;

use crate::config::ModelTier;
use crate::services::agent::capability::{
    get_capabilities_by_ids, get_compact_index,
};
use crate::services::agent::identity;
use crate::services::agent::intent::keywords::LanguageDetector;
use crate::services::agent::memory;
use crate::services::agent::recipe::validate_and_convert_steps;
use crate::services::agent::types::*;
use crate::services::ai::create_ai_analyzer_for_tier;
use crate::services::analyzer::AiAnalyzer;

/// Planner — 单次 Pro AI 调用完成意图理解 + 执行规划
pub struct Planner {
    /// Pro 层级 AI 分析器
    ai_analyzer: Option<AiAnalyzer>,
    /// 语言检测器
    language_detector: LanguageDetector,
}

impl Planner {
    /// 创建 Planner（使用 Pro 层级）
    pub async fn new() -> Self {
        let ai_analyzer = create_ai_analyzer_for_tier(ModelTier::Pro).await;
        if ai_analyzer.is_some() {
            tracing::info!("[Planner] Pro AI analyzer initialized");
        } else {
            tracing::warn!("[Planner] Pro AI analyzer NOT available — will use fallback");
        }
        Self {
            ai_analyzer,
            language_detector: LanguageDetector::new(),
        }
    }

    /// 主入口：用户请求 → PlannerOutput
    pub async fn plan(&self, request: &UserRequest) -> Result<PlannerOutput, String> {
        self.plan_internal(request, None).await
    }

    /// 升级重规划（携带前次结果上下文）
    pub async fn replan(
        &self,
        request: &UserRequest,
        escalation_hint: &str,
    ) -> Result<PlannerOutput, String> {
        self.plan_internal(request, Some(escalation_hint)).await
    }

    /// 内部规划逻辑
    async fn plan_internal(
        &self,
        request: &UserRequest,
        escalation_hint: Option<&str>,
    ) -> Result<PlannerOutput, String> {
        // 尝试获取 AI（支持热加载配置）
        let runtime_analyzer;
        let ai_ref = if self.ai_analyzer.is_some() {
            self.ai_analyzer.as_ref()
        } else {
            runtime_analyzer = create_ai_analyzer_for_tier(ModelTier::Pro).await;
            runtime_analyzer.as_ref()
        };

        let Some(ai_analyzer) = ai_ref else {
            tracing::info!("[Planner] No AI available, using fallback");
            return Ok(self.fallback_plan(request));
        };

        let input = &request.raw_input;
        let language = self.language_detector.detect(input);

        // 构建 prompt
        let system_prompt = self.build_system_prompt(request, language, escalation_hint).await;
        let user_prompt = self.build_user_prompt(request, escalation_hint);
        let full_prompt = format!("{}\n\n---\n\n{}", system_prompt, user_prompt);

        // 调用 Pro AI
        let response = ai_analyzer
            .analyze(&full_prompt)
            .await
            .map_err(|e| format!("Planner AI error: {}", e))?;

        // 解析响应
        let mut output = self.parse_response(&response)?;

        // 校验步骤（如果是 plan 状态）
        if output.status == PlannerStatus::Plan && !output.steps.is_empty() {
            if let Err(e) = self.validate_steps(&mut output).await {
                tracing::warn!(error = %e, "[Planner] Step validation failed, trying to recover");
                // 验证失败时降级为 chat
                output.status = PlannerStatus::Chat;
                output.chat_reply = Some(format!(
                    "我理解了你的请求，但生成执行计划时出现问题：{}。请尝试更具体地描述你想做什么。",
                    e
                ));
                output.steps.clear();
            }
        }

        Ok(output)
    }

    /// 构建系统 prompt
    async fn build_system_prompt(
        &self,
        request: &UserRequest,
        language: super::intent::keywords::Language,
        escalation_hint: Option<&str>,
    ) -> String {
        let mut sections: Vec<String> = Vec::new();

        // 0. 环境上下文（时间、语言）
        let now = chrono::Local::now();
        let lang_instruction = match language {
            super::intent::keywords::Language::Chinese => "请用中文回复。",
            super::intent::keywords::Language::English => "Please respond in English.",
            super::intent::keywords::Language::Japanese => "日本語で返信してください。",
        };
        sections.push(format!(
            "## 环境\n当前时间：{}\n{}",
            now.format("%Y-%m-%d %H:%M (%A)"),
            lang_instruction
        ));

        // 1. 身份（全局 SOUL.md）
        let global_identity = identity::get_identity().await;
        if let Some(ref id) = global_identity {
            if let Some(role) = id.role_prompt() {
                sections.push(format!("## 身份\n{}", role));
            }
        }
        if sections.is_empty() {
            sections.push(
                "## 身份\n你是 Arael，一个智能 AI 助手。你能理解用户的自然语言请求并规划执行步骤。"
                    .to_string(),
            );
        }

        // 1.2. 用户偏好（USER.md）
        if let Some(ref id) = global_identity {
            if let Some(user_ctx) = id.user_context() {
                sections.push(format!("## 用户偏好\n{}", user_ctx));
            }
        }

        // 1.5. 多 Agent 角色概览（注入 worker 身份摘要）
        if let Some(mgr) = identity::get_identity_manager() {
            let summaries = mgr.get_role_summaries().await;
            if !summaries.is_empty() {
                sections.push(format!(
                    "## 协作团队\n你可以调度以下专业 Agent 的能力：\n{}",
                    summaries
                ));
            }
        }

        // 2. 记忆（TF-IDF 语义搜索）
        if let Some(mem) = memory::get_memory() {
            let memories = mem
                .recall_with_params(memory::RecallQuery {
                    query: request.raw_input.clone(),
                    limit: 5,
                    tier_filter: Some(vec![
                        memory::MemoryTier::LongTerm,
                        memory::MemoryTier::MediumTerm,
                    ]),
                    ..Default::default()
                })
                .await;
            if !memories.is_empty() {
                let mem_lines: Vec<String> = memories
                    .iter()
                    .map(|m| {
                        let tier_tag = match m.tier {
                            memory::MemoryTier::LongTerm => "📌",
                            memory::MemoryTier::MediumTerm => "📝",
                            memory::MemoryTier::ShortTerm => "💬",
                        };
                        format!("- {} {}", tier_tag, m.content)
                    })
                    .collect();
                sections.push(format!("## 参考记忆\n{}", mem_lines.join("\n")));
            }
        }

        // 3. 能力索引
        let compact_index = get_compact_index().await;
        sections.push(format!(
            "## 可用能力（紧凑索引）\n```json\n{}\n```",
            serde_json::to_string_pretty(&compact_index).unwrap_or_default()
        ));

        // 4. 升级提示
        if let Some(hint) = escalation_hint {
            sections.push(format!(
                "## 升级上下文\n前次执行结果不满意。{}",
                hint
            ));
        }

        // 5. 输出格式与规则
        sections.push(PLANNER_RULES.to_string());

        sections.join("\n\n")
    }

    /// 构建用户 prompt
    fn build_user_prompt(&self, request: &UserRequest, escalation_hint: Option<&str>) -> String {
        let mut prompt = format!("用户请求：{}", request.raw_input);

        if let Some(context) = &request.context {
            if let Some(route) = &context.current_route {
                let page_desc = describe_route(route);
                prompt.push_str(&format!("\n当前页面：{} ({})", page_desc, route));
            }
            if !context.active_platforms.is_empty() {
                prompt.push_str(&format!(
                    "\n活跃平台：{}",
                    context.active_platforms.join(", ")
                ));
            }

            // 对话历史（直接从 conversation_history 读取，不再走 custom_data hack）
            if let Some(history) = &context.conversation_history {
                if !history.is_empty() {
                    prompt.push_str("\n\n最近对话历史：");
                    for msg in history.iter().rev().take(20).collect::<Vec<_>>().into_iter().rev() {
                        prompt.push_str(&format!("\n{}：{}", msg.role, msg.content));
                    }
                    prompt.push_str(
                        "\n\n请注意：用户可能在引用之前对话中提到的内容，注意理解代词和上下文指代。",
                    );
                }
            }

            // 页面上下文
            if let Some(custom_data) = &context.custom_data {
                let has_page = custom_data.get("pageContent").is_some();
                if has_page {
                    prompt.push_str("\n页面上下文可用：true（可在 params 中用 \"inputFrom\": \"__page_context__\" 引用）");
                }

                // 用户偏好
                if let Some(prefs) = custom_data.get("user_preferences") {
                    if let Some(prefs_obj) = prefs.as_object() {
                        if !prefs_obj.is_empty() {
                            prompt.push_str("\n\n用户历史偏好：");
                            if let Some(action) =
                                prefs_obj.get("preferred_action").and_then(|v| v.as_str())
                            {
                                prompt.push_str(&format!("\n- 常用操作：{}", action));
                            }
                            if let Some(platforms) = prefs_obj
                                .get("preferred_platforms")
                                .and_then(|v| v.as_array())
                            {
                                let names: Vec<&str> =
                                    platforms.iter().filter_map(|p| p.as_str()).collect();
                                if !names.is_empty() {
                                    prompt.push_str(&format!(
                                        "\n- 常用平台：{}",
                                        names.join(", ")
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(hint) = escalation_hint {
            prompt.push_str(&format!("\n\n[升级提示] {}", hint));
        }

        prompt
    }

    /// 解析 AI 响应为 PlannerOutput
    fn parse_response(&self, response: &str) -> Result<PlannerOutput, String> {
        let trimmed = response.trim();

        // 提取 JSON（处理 markdown fence）
        let json_str = if trimmed.starts_with("```") {
            let start = trimmed
                .find('{')
                .ok_or("No JSON object found in AI response")?;
            let end = trimmed
                .rfind('}')
                .ok_or("No closing brace found in AI response")?;
            &trimmed[start..=end]
        } else if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
            &trimmed[start..=end]
        } else {
            // 纯文本回复 → 作为 chat
            return Ok(PlannerOutput {
                status: PlannerStatus::Chat,
                confidence: 0.9,
                reasoning: None,
                steps: vec![],
                clarification: None,
                unsupported_reason: None,
                chat_reply: Some(trimmed.to_string()),
            });
        };

        match serde_json::from_str::<PlannerOutput>(json_str) {
            Ok(output) => Ok(output),
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    preview = &response[..response.len().min(200)],
                    "[Planner] Failed to parse response as PlannerOutput"
                );
                // 解析失败 → 作为 chat 回复
                Ok(PlannerOutput {
                    status: PlannerStatus::Chat,
                    confidence: 0.5,
                    reasoning: None,
                    steps: vec![],
                    clarification: None,
                    unsupported_reason: None,
                    chat_reply: Some(trimmed.to_string()),
                })
            }
        }
    }

    /// 校验步骤（加载完整 capability schema 验证）
    async fn validate_steps(&self, output: &mut PlannerOutput) -> Result<(), String> {
        let cap_ids: Vec<String> = output
            .steps
            .iter()
            .map(|s| s.capability_id.clone())
            .collect();
        let cap_schemas = get_capabilities_by_ids(&cap_ids).await;

        // 尝试用公共函数验证
        let test_steps = output.steps.clone();
        let reasoning = output.reasoning.clone();
        validate_and_convert_steps(test_steps, reasoning, &cap_schemas)?;

        Ok(())
    }

    /// 无 AI 时的规则兜底
    fn fallback_plan(&self, request: &UserRequest) -> PlannerOutput {
        let input = request.raw_input.to_lowercase();

        // 简单的关键词匹配
        if input.contains("你好")
            || input.contains("hello")
            || input.contains("hi")
            || input.contains("嗨")
        {
            return PlannerOutput {
                status: PlannerStatus::Chat,
                confidence: 0.9,
                reasoning: Some("Simple greeting".to_string()),
                steps: vec![],
                clarification: None,
                unsupported_reason: None,
                chat_reply: Some("你好！有什么我可以帮你的吗？".to_string()),
            };
        }

        // 默认：用 ai.chat 能力作为兜底
        PlannerOutput {
            status: PlannerStatus::Plan,
            confidence: 0.5,
            reasoning: Some("Fallback: no AI available, routing to ai.chat".to_string()),
            steps: vec![AiRecipeStep {
                id: "step_1".to_string(),
                capability_id: "ai.chat".to_string(),
                action: "chat".to_string(),
                params: {
                    let mut p = HashMap::new();
                    p.insert(
                        "message".to_string(),
                        serde_json::Value::String(request.raw_input.clone()),
                    );
                    p
                },
                depends_on: vec![],
                on_failure: "abort".to_string(),
                timeout_ms: Some(30000),
            }],
            clarification: None,
            unsupported_reason: None,
            chat_reply: None,
        }
    }
}

/// 路由描述
fn describe_route(route: &str) -> &'static str {
    match route.trim_matches('/') {
        "brew" => "Brew 订阅页面",
        "tapp" | "tapps" => "Tapp 应用页面",
        route if route.starts_with("platform/bilibili") => "B站数据页面",
        route if route.starts_with("platform/steam") => "Steam 游戏页面",
        route if route.starts_with("platform/github") => "GitHub 页面",
        route if route.starts_with("platform/netease") => "网易云音乐页面",
        route if route.starts_with("platform/") => "平台页面",
        "report" | "reports" => "报告页面",
        "" | "dashboard" => "仪表盘首页",
        _ => "未知页面",
    }
}

/// Planner 规则与输出格式（注入到系统 prompt）
const PLANNER_RULES: &str = r#"## 规则

你需要分析用户请求，判断其类型，并输出对应的 JSON 响应。

### 请求类型判断

1. **plan**: 用户需要执行某个操作（查询数据、生成内容、控制功能等）→ 输出执行步骤
2. **chat**: 用户在闲聊、问问题、不需要调用任何能力 → 直接回复
3. **clarify**: 用户请求模糊，无法确定意图 → 请求澄清
4. **unsupported**: 用户请求超出能力范围 → 解释原因

### 执行步骤规则（status=plan 时）

1. `capability_id` 必须匹配可用能力索引中的 ID。能力索引中 `"p"` 字段列出了必需参数，务必包含
2. 如果可用能力中有 `skill:xxx` 类型恰好匹配用户意图，优先使用 Skill（它封装了完整的多步骤编排）
3. `params` 根据能力描述和 `"p"` 参数列表推断合理值
4. 如果步骤 B 需要步骤 A 的输出，使用 `depends_on` 声明依赖，并在 params 中用 `"xxxFrom": "step_id"` 引用
5. 如果页面上下文可用，可用 `"inputFrom": "__page_context__"` 引用当前页面内容
6. `on_failure` 策略：
   - 数据获取步骤用 `"abort"`（后续步骤依赖数据，获取失败则无法继续）
   - AI 处理步骤可用 `"skip"`（非关键性分析/总结可跳过）
   - 如果步骤是其他步骤的 `depends_on` 数据源，必须 `"abort"`
7. `timeout_ms`: 数据获取 15000，AI 处理 30000，图片生成 60000
8. 可选字段：`"retry": {"max_attempts": 2, "delay_ms": 1000, "exponential_backoff": true}` — 对网络请求类步骤建议添加
9. 可选字段：`"model_tier": "pro"` — 需要高质量分析/创作时指定 pro，普通任务省略即可
10. **步骤数量上限 12 个**，尽量用最少步骤完成任务。超过 5 步的计划应认真检查是否有冗余

### 数量意图识别

用户请求中包含数量词时，你必须据此调整执行计划的步骤数量和参数规模：
- **明确单数**（"一张"、"一个"、"一首"）→ 生成单个步骤
- **明确复数/模糊多数**（"一些"、"几张"、"几个"、"多个"、"若干"、"一批"）→ 生成**多个并行步骤**，每个步骤使用不同的参数变体（如不同的风格、角度、配色、关键词侧重等），使结果多样化
- **指定具体数量**（"三张"、"5个"）→ 步骤数量与之对应
- **无数量词**（"帮我生成图"、"写个总结"）→ 默认为单个

多个并行步骤之间**不设 `depends_on`**，使其能被同时执行。每个步骤的参数应有**明确差异**——仅仅重复相同参数毫无意义。差异方向由能力类型决定：视觉类改变构图/风格/色调，文本类改变视角/侧重/深度，搜索类调整关键词/范围/排序等。

### 多目标与并行展开

当用户请求涉及**多个独立目标**时，必须为每个目标生成独立的步骤并行执行：
- 列举多个平台（"B站和Steam"、"所有平台"）→ 为每个平台生成独立的 `platform.read` 或 `platform.stats` 步骤
- 列举多个关键词（"搜索X和Y"）→ 多个 `search.global` 并行
- "所有"、"全部" 修饰的平台请求 → 展开为用户全部活跃平台的并行步骤
- 如果后续还有汇总/对比需求，汇总步骤应 `depends_on` 所有并行步骤

### 对比意图

用户表达对比、比较、PK 等意图时（"对比"、"比一比"、"哪个更好"、"有什么区别"），执行计划必须包含：
1. **并行数据获取**：为每个对比目标生成独立的数据获取步骤
2. **对比分析步骤**：一个 `compare.content` 或 `ai.analyze`（analysisType="custom"）步骤，`depends_on` 全部获取步骤，将获取结果作为对比输入

### 串联意图（A 然后 B）

用户在单句中表达连续操作时（"搜索并总结"、"找到后订阅"、"获取数据然后分析"、"翻译完再朗读"），必须拆解为**有依赖关系**的多步骤：
- 前置步骤执行数据获取或处理
- 后续步骤通过 `depends_on` 引用前置步骤 ID，并用 `"xxxFrom": "step_id"` 传递数据
- 不要合并为单步骤，每个动词对应一个能力调用

### 时间表达映射

用户请求包含时间修饰词时，必须转化为对应参数（`since`、`startDate`、`endDate`、`daysBack` 等）：
- "最近的"、"近期" → `daysBack: 7` 或 `limit` 设小值
- "今天"、"今天的" → `since` 设为当天零点
- "这周"、"本周" → `daysBack: 7`
- "这个月"、"本月" → `daysBack: 30`
- "去年"、"上个月" → 对应的 `startDate` + `endDate` 区间
- 无时间修饰 → 使用默认值，不额外设置

### 深度与详略控制

用户通过修饰词暗示期望的详细程度时，据此调整参数规模：
- **详细请求**（"详细分析"、"全面报告"、"深入看看"）→ `limit` 设较大值，`style` 用 "detailed"，`maxLength` 设较大值
- **简略请求**（"随便看看"、"简单说说"、"快速总结"）→ `limit` 设较小值，`style` 用 "brief"，`maxLength` 设较小值
- **无深度修饰** → 使用中等默认值

### 指代消歧与上下文引用

用户使用代词或指示词时（"这个"、"它"、"刚才那个"、"这篇文章"、"当前页面"），你必须结合以下信息解析其真实指代：
- **当前页面路由和页面上下文**：如果用户说"这篇"且当前在阅读器页面，通过 `"inputFrom": "__page_context__"` 引用
- **对话历史**：如果用户说"刚才那个"，从历史消息中找到最近提到的实体
- **不要猜测**：如果上下文不足以消歧，使用 status="clarify" 要求用户明确

### 否定与排除

用户表达排除意图时（"除了X以外"、"不要包含Y"、"不包括Z"），将排除条件传入对应参数：
- 搜索类能力：在 `query` 中加入否定词，或设置 `filters` 排除
- AI 分析类能力：在 `instruction` 或 `criteria` 中明确排除要求
- 数据读取类：通过 `keyword`、`filter` 参数设置排除条件

### 图片生成特别规则（prompt.generate + ai.image）

当用户请求生成图片时，你**必须**在 `prompt.generate` 步骤的 `description` 参数中提供**尽可能详尽的描述**：
- 如果涉及已知角色（动漫、游戏、影视等），你应利用自身知识写出角色的**完整视觉特征**：全名（含英文名）、来源作品、发型发色、瞳色（是否异色瞳）、标志性服装细节（颜色、样式、配饰如帽子/发带/披风等）、体型、标志性元素等
- 如果用户使用了昵称/简称（如"芙芙"→芙宁娜/Furina），你必须识别并在 description 中展开为完整的角色描述
- 同时包含场景、氛围、构图建议等
- `category` 应设为 "anime"（动漫角色）、"photo"（写实）等对应类型
- `description` 内容越详细，生成的图片越准确，**绝对不要偷懒只写简短标题**

### 输出格式

严格输出 JSON，不要包含 markdown 标记：

```
{
  "status": "plan" | "clarify" | "unsupported" | "chat",
  "confidence": 0.0-1.0,
  "reasoning": "简要说明你的判断思路",

  // status=plan 时:
  "steps": [
    {
      "id": "step_1",
      "capability_id": "能力ID",
      "action": "动作描述",
      "params": { "必需参数": "值" },
      "depends_on": [],
      "on_failure": "abort",
      "timeout_ms": 15000,
      "retry": { "max_attempts": 2, "delay_ms": 1000, "exponential_backoff": true },
      "model_tier": "standard"
    }
  ],

  // status=clarify 时:
  "clarification": {
    "message": "需要澄清的问题",
    "options": ["选项1", "选项2"]
  },

  // status=unsupported 时:
  "unsupported_reason": "不支持的原因",

  // status=chat 时:
  "chat_reply": "直接回复内容"
}
```"#;
