use axum::{extract::State, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use sea_orm::{ConnectionTrait, DatabaseConnection, FromQueryResult, Statement};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize, Deserialize)]
pub struct PersonaRequest {
    #[serde(default)]
    pub force_regenerate: bool,
    pub slot: Option<i32>, // 指定槽位（0或1），如果为None则自动选择
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PersonaResponse {
    pub success: bool,
    pub persona: Option<VirtualPersona>,
    pub from_cache: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PersonaListResponse {
    pub success: bool,
    pub personas: Vec<VirtualPersona>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateImageRequest {
    pub image_prompt: String,
    pub slot: i32, // 指定为哪个槽位生成图片
    #[serde(default)]
    pub aspect_ratio: Option<String>, // 仅用于 Midjourney，如 "1:1", "2:3", "16:9"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateImageResponse {
    pub success: bool,
    pub image_url: Option<String>,
    pub task_id: Option<String>, // Midjourney任务ID（如果使用imaginepro）
    pub provider: Option<String>, // 使用的提供商
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromQueryResult)]
pub struct VirtualPersona {
    pub slot: i32, // 槽位号（0或1）
    pub name: String,
    pub personality: String,
    pub appearance: String,
    #[sea_orm(column_type = "JsonBinary")]
    pub hobbies: Value,
    pub life_style: String,
    pub visual_style: Option<String>,
    pub image_prompt: String,
    pub image_url: Option<String>,
    pub generated_at: DateTime<Utc>,
    pub has_image: bool, // 标记是否已生成图片
}

/// 从数据库获取所有虚拟人物
async fn get_personas_from_db(db: &DatabaseConnection, user_id: &str) -> Vec<VirtualPersona> {
    let sql = r#"
        SELECT persona_slot as slot,
               persona_name as name,
               persona_personality as personality,
               persona_appearance as appearance,
               persona_hobbies as hobbies,
               persona_life_style as life_style,
               persona_visual_style as visual_style,
               persona_image_prompt as image_prompt,
               persona_image_url as image_url,
               change_date as generated_at,
               CASE WHEN persona_image_url IS NOT NULL THEN TRUE ELSE FALSE END as has_image
        FROM metadata_history
        WHERE user_id = $1 AND persona_slot IS NOT NULL
        ORDER BY persona_slot ASC, change_date DESC
    "#;

    match db
        .query_all(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            sql,
            vec![user_id.into()],
        ))
        .await
    {
        Ok(rows) => {
            // 只保留每个slot最新的一条记录
            let mut latest_personas: std::collections::HashMap<i32, VirtualPersona> =
                std::collections::HashMap::new();

            for row in rows {
                match VirtualPersona::from_query_result(&row, "") {
                    Ok(persona) => {
                        latest_personas.entry(persona.slot).or_insert(persona);
                    }
                    Err(e) => {
                        tracing::error!("Failed to parse persona from DB: {}", e);
                    }
                }
            }

            let mut result: Vec<VirtualPersona> = latest_personas.into_values().collect();
            result.sort_by_key(|p| p.slot);
            result
        }
        Err(e) => {
            tracing::error!("Failed to query personas from DB: {}", e);
            Vec::new()
        }
    }
}

/// 保存虚拟人物到数据库（支持槽位）
/// 保存为metadata_history表的新记录
async fn save_persona_to_db(
    db: &DatabaseConnection,
    user_id: &str,
    slot: i32,
    persona: &VirtualPersona,
) -> Result<(), String> {
    // 计算过期时间（30天后）
    let expires_at = chrono::Utc::now() + chrono::Duration::days(30);

    let sql = r#"
        INSERT INTO metadata_history
        (user_id, platform_name, changed_fields, new_data, change_date,
         persona_slot, persona_name, persona_personality, persona_appearance,
         persona_hobbies, persona_life_style, persona_visual_style,
         persona_image_prompt, persona_image_url, persona_expires_at,
         metadata_id)
        VALUES ($1, 'virtual_persona', '[]', '{}', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0)
    "#;

    db.execute(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        sql,
        vec![
            user_id.into(),
            persona.generated_at.into(),
            slot.into(),
            persona.name.clone().into(),
            persona.personality.clone().into(),
            persona.appearance.clone().into(),
            persona.hobbies.clone().into(),
            persona.life_style.clone().into(),
            persona.visual_style.clone().into(),
            persona.image_prompt.clone().into(),
            persona.image_url.clone().into(),
            expires_at.into(),
        ],
    ))
    .await
    .map_err(|e| format!("Failed to save persona to DB: {}", e))?;

    tracing::info!("💾 Persona saved to database (slot {})", slot);
    Ok(())
}

/// 获取人设列表
pub async fn get_persona_list(
    State(db): State<DatabaseConnection>,
) -> (StatusCode, Json<PersonaListResponse>) {
    let user_id = "default_user"; // TODO: 从认证中获取真实用户ID

    // 检查功能是否启用
    let dynamic_config = crate::GLOBAL_DYNAMIC_CONFIG.read().await.clone();
    if !dynamic_config.persona_image_enabled {
        return (
            StatusCode::OK,
            Json(PersonaListResponse {
                success: false,
                personas: Vec::new(),
                message: Some("虚拟人物功能未启用".to_string()),
            }),
        );
    }

    let personas = get_personas_from_db(&db, user_id).await;

    (
        StatusCode::OK,
        Json(PersonaListResponse {
            success: true,
            personas,
            message: None,
        }),
    )
}

/// 生成虚拟人物设定
pub async fn generate_persona(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<PersonaRequest>,
) -> (StatusCode, Json<PersonaResponse>) {
    tracing::info!(
        "🎭 Generating virtual persona (force: {}, slot: {:?})",
        payload.force_regenerate,
        payload.slot
    );

    let user_id = "default_user"; // TODO: 从认证中获取真实用户ID

    // 检查功能是否启用
    let dynamic_config = crate::GLOBAL_DYNAMIC_CONFIG.read().await.clone();
    if !dynamic_config.persona_image_enabled {
        return (
            StatusCode::OK,
            Json(PersonaResponse {
                success: false,
                persona: None,
                from_cache: false,
                message: Some("虚拟人物功能未启用".to_string()),
            }),
        );
    }

    // 获取现有人设列表
    let existing_personas = get_personas_from_db(&db, user_id).await;

    // 确定槽位
    let slot = if let Some(s) = payload.slot {
        // 用户指定了槽位
        if !(0..=1).contains(&s) {
            return (
                StatusCode::BAD_REQUEST,
                Json(PersonaResponse {
                    success: false,
                    persona: None,
                    from_cache: false,
                    message: Some("槽位必须是0或1".to_string()),
                }),
            );
        }
        s
    } else {
        // 自动选择槽位
        if existing_personas.len() >= 2 {
            return (
                StatusCode::BAD_REQUEST,
                Json(PersonaResponse {
                    success: false,
                    persona: None,
                    from_cache: false,
                    message: Some("已达到最大人设数量(2个)，请先删除一个".to_string()),
                }),
            );
        }
        // 找到第一个空槽位
        let used_slots: Vec<i32> = existing_personas.iter().map(|p| p.slot).collect();
        if !used_slots.contains(&0) {
            0
        } else {
            1
        }
    };

    // 如果不是强制重新生成，检查该槽位是否已有人设
    if !payload.force_regenerate {
        if let Some(persona) = existing_personas.iter().find(|p| p.slot == slot) {
            tracing::info!("✓ Returning persona from database (slot {})", slot);
            return (
                StatusCode::OK,
                Json(PersonaResponse {
                    success: true,
                    persona: Some(persona.clone()),
                    from_cache: true,
                    message: None,
                }),
            );
        }
    }

    // 需要生成新的虚拟人物
    tracing::info!("🔄 Generating new persona for slot {}...", slot);

    // 获取用户数据
    let profile_data = match crate::api::profile::get_cached_or_fresh_data(&db).await {
        Ok(data) => data,
        Err(e) => {
            tracing::error!("Failed to fetch profile data: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(PersonaResponse {
                    success: false,
                    persona: None,
                    from_cache: false,
                    message: Some(format!("Failed to fetch data: {}", e)),
                }),
            );
        }
    };

    // 使用AI数据过滤函数
    let filtered_data = crate::api::profile::filter_data_for_ai(&profile_data);

    let provider = crate::services::analyzer::AiProvider::from_str(&dynamic_config.ai_provider);

    let (api_key, model, base_url) = match provider {
        crate::services::analyzer::AiProvider::Gemini => match &dynamic_config.gemini_api_key {
            Some(key) if !key.is_empty() => {
                (key.clone(), dynamic_config.gemini_model.clone(), None)
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(PersonaResponse {
                        success: false,
                        persona: None,
                        from_cache: false,
                        message: Some("AI API key not configured".to_string()),
                    }),
                );
            }
        },
        crate::services::analyzer::AiProvider::OpenAI => match &dynamic_config.openai_api_key {
            Some(key) if !key.is_empty() => (
                key.clone(),
                dynamic_config.openai_model.clone(),
                Some(dynamic_config.openai_base_url.clone()),
            ),
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(PersonaResponse {
                        success: false,
                        persona: None,
                        from_cache: false,
                        message: Some("AI API key not configured".to_string()),
                    }),
                );
            }
        },
    };

    let analyzer = crate::services::analyzer::AiAnalyzer::new(provider, api_key, model, base_url);

    // 生成虚拟人物设定提示词
    let persona_prompt = format!(
        r#"你是一位富有创造力的角色设计大师和视觉艺术指导。你的任务是根据用户数据，创造一个让人眼前一亮、风格鲜明的虚拟角色。

用户数据：
{}

核心设计理念：
1. 从用户数据中捕捉最独特的特质，放大成鲜明的人格标签
2. 避免平庸和套路化描述，每个角色都应该有强烈的记忆点
3. 外貌设计要有视觉冲击力和辨识度
4. 选择与角色气质高度契合的艺术风格（非固定风格）

设计要求：
- 人物设定：挖掘数据背后的深层个性，创造有故事感的角色
- 外貌设计：抓住1-2个标志性视觉元素，让人过目不忘
- 风格定位：根据角色气质选择最合适的艺术风格（动漫/插画/赛博朋克/复古/极简等）
- image_prompt：精准传达角色的独特气场和视觉风格

JSON格式要求：
- 必须返回纯JSON，不要markdown代码块（不要```json```）
- 不要包含任何JSON之外的文字
- 确保JSON完全有效可解析

返回JSON结构：
{{
  "name": "角色名字（2-4字，要有记忆点和风格感，可以是意象化命名）",
  "personality": "核心性格（80-120字，用生动的意象和比喻，突出2-3个鲜明特质，避免平淡陈述）",
  "appearance": "标志性外貌（80-100字，聚焦最抓眼球的视觉元素，用色彩/材质/形状等具象描述）",
  "hobbies": ["爱好1", "爱好2", "爱好3"],
  "life_style": "生活方式（80-100字，用场景化描述展现独特的生活节奏和仪式感）",
  "visual_style": "艺术风格定位（20-40字，说明为什么选择这个风格，如：赛博朋克风格-契合其科技感与夜行者气质）",
  "image_prompt": "英文绘画提示词（见下方详细要求）"
}}

image_prompt 创意编写指南：

结构框架：[角色定位] → [标志性外貌特征] → [姿势/动作] → [核心道具/环境] → [色彩基调] → [光影氛围] → [艺术风格] → [情绪/气场]

创意原则：
✨ 抓住ONE BIG THING：每个角色必须有1个超级抓眼的视觉锚点
   - 可以是：特殊发色/独特配饰/标志性姿态/反差感穿搭/氛围道具
   
✨ 风格多样化：根据角色气质选择，不局限于单一风格
   - 科技宅 → cyberpunk/neon-lit digital art
   - 文艺青年 → soft watercolor/indie aesthetic  
   - 极简主义者 → minimalist line art/monochrome
   - 潮流玩家 → pop art/streetwear illustration
   - 神秘研究者 → dark academia/vintage poster art
   - 深夜创作者 → lo-fi aesthetic/warm analog film

✨ 色彩策略：用2-3个主色调定义角色
   - 例：deep purple + neon cyan（神秘科技感）
   - 例：warm amber + forest green（自然治愈系）
   - 例：monochrome with red accent（冷静锐利）

✨ 氛围营造：用具象的光影和情绪词
   - 避免：soft lighting, warm atmosphere（太笼统）
   - 推荐：neon signs reflecting on wet pavement（具体场景）
   - 推荐：golden hour light streaming through dusty bookshelves（画面感强）

必须包含的元素：
- 角色定位：1个精准的身份标签（lone coder/urban explorer/midnight composer等）
- 发型细节：长度+颜色+1个特征（messy/sleek/wind-swept等）
- 标志性单品：1-2件让人记住的物品/配饰
- 环境暗示：2-3个道具勾勒场景（但不要冗长列举）
- 主色调：明确的色彩方向
- 艺术风格：明确的风格标签（digital art/watercolor/manga style等）
- 情绪关键词：1个核心气质词（mysterious/energetic/melancholic/rebellious等）

禁止出现：
❌ 平庸的通用描述（beautiful/nice/good/pretty等无意义形容词）
❌ 风格堆砌（Studio Ghibli + cyberpunk + watercolor混搭）
❌ 技术参数堆砌（8K/masterpiece/ultra detailed/professional等）
❌ 重复氛围词（cozy warm comfortable serene选一个）
❌ 模糊的"or"选择（明确单一场景）
❌ 超过3个的道具列举（会分散注意力）

字数要求：120-150词

创意示例参考：

示例1（赛博朋克风格）：
{{
  "name": "零夜",
  "personality": "数字世界的游牧者，在代码雨中编织梦境。白天是隐形人，午夜后化身为霓虹丛林的猎手，用键盘敲击出属于暗网诗人的节奏。",
  "appearance": "银灰色短碎发，一侧剃出电路纹样，左耳三连环耳钉，深紫色高领夹克，指尖永远闪烁着机械键盘的RGB幻光。",
  "hobbies": ["深夜编程", "赛博朋克音乐", "黑客美学"],
  "life_style": "昼伏夜出的数字游民，凌晨2点是创造力巅峰，在三块显示器的包围中与代码共舞，咖啡因和电子乐是续命之源。",
  "visual_style": "赛博朋克数字艺术-强化其夜行黑客的科技神秘感与霓虹美学",
  "image_prompt": "A lone hacker with silver-grey asymmetrical hair, one side shaved with circuit patterns, triple ear piercings, wearing a deep purple high-collar jacket. Sitting before triple monitors displaying cascading code, fingers glowing on RGB mechanical keyboard. Neon cyan and magenta lights reflecting on face, dark room filled with floating digital particles. Cyberpunk digital art style, dramatic neon lighting, mysterious hacker atmosphere, sharp contrast, cinematic composition, character focus."
}}

示例2（Lo-Fi治愈风格）：
{{
  "name": "雨音",
  "personality": "收集声音的旅人，用音符和文字记录世界的温度。在爵士乐的烟雾中阅读，在雨声里写作,相信慢下来才能看见生活的纹理。",
  "appearance": "栗色齐肩微卷发,米色针织开衫慵懒地搭在肩上,复古圆框眼镜,手腕上缠着褪色的布手环,永远捧着一本泛黄的二手书。",
  "hobbies": ["黑胶唱片收藏", "手写日记", "深夜电台"],
  "life_style": "慢生活践行者,午后在二手书店流连,深夜在暖黄台灯下写字,用胶片相机记录城市角落,在模拟唱片的噪音中找到心灵栖息地。",
  "visual_style": "Lo-Fi插画美学-温暖复古质感契合其慢生活与怀旧气质",
  "image_prompt": "A gentle soul with shoulder-length wavy chestnut hair and vintage round glasses, wearing an oversized beige cardigan over casual clothes. Sitting by a rainy window with a worn paperback book, vintage record player spinning nearby, warm amber desk lamp casting soft glow. Steam rising from tea cup, handwritten journal open on wooden table. Lo-fi illustration style, warm analog color palette with film grain texture, cozy rainy day atmosphere, nostalgic and peaceful mood, soft focus background."
}}

示例3（极简主义风格）：
{{
  "name": "白",
  "personality": "减法哲学的实践者,在空白中看见无限可能。拒绝信息过载,只保留最本质的思考和创造,相信「少即是多」的力量。",
  "appearance": "利落的黑色短发,纯白色立领衬衫,简约银色细框眼镜,没有任何多余配饰,整个人像一个标点符号般精准存在。",
  "hobbies": ["极简设计", "冥想", "概念摄影"],
  "life_style": "数字极简主义者,工作台只有一台笔记本和一支笔,每天固定时段断网深度工作,在留白与专注中提炼创意的纯粹性。",
  "visual_style": "极简线条艺术-冷静克制的视觉语言呼应其极简主义哲学",
  "image_prompt": "A minimalist individual with sleek short black hair, wearing a crisp white mandarin collar shirt and thin silver-rimmed glasses. Sitting at an empty white desk with only a single laptop and fountain pen, clean lines and negative space dominating the composition. Soft natural light from large window creating subtle shadows. Minimalist line art style, monochrome palette with subtle gray gradients, zen-like tranquil atmosphere, architectural precision, emphasis on empty space and geometric simplicity."
}}

核心提醒：
🎯 每个角色必须有清晰的「视觉记忆点」- 让人看一眼就记住
🎨 大胆使用色彩和风格 - 不要害怕与众不同
💫 用意象和场景说话 - 少用形容词,多画面感
🔥 让角色的气场透过屏幕扑面而来

现在,请基于用户数据创造一个独一无二的角色！"#,
        serde_json::to_string_pretty(&filtered_data).unwrap_or_else(|_| "{}".to_string())
    );

    // 调用AI生成
    let ai_response = match analyzer
        .analyze_profile(&json!({"prompt": persona_prompt}))
        .await
    {
        Ok(response) => response,
        Err(e) => {
            tracing::error!("AI generation failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(PersonaResponse {
                    success: false,
                    persona: None,
                    from_cache: false,
                    message: Some(format!("AI generation failed: {}", e)),
                }),
            );
        }
    };

    // 清理并解析AI响应
    let cleaned = ai_response
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let persona_data: Value = match serde_json::from_str(cleaned) {
        Ok(data) => data,
        Err(e) => {
            tracing::error!("Failed to parse AI response: {}. Response: {}", e, cleaned);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(PersonaResponse {
                    success: false,
                    persona: None,
                    from_cache: false,
                    message: Some(format!("Failed to parse AI response: {}", e)),
                }),
            );
        }
    };

    // 构建虚拟人物
    let hobbies_json = persona_data["hobbies"].clone();

    let persona = VirtualPersona {
        slot,
        name: persona_data["name"]
            .as_str()
            .unwrap_or("神秘人物")
            .to_string(),
        personality: persona_data["personality"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        appearance: persona_data["appearance"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        hobbies: hobbies_json,
        life_style: persona_data["life_style"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        visual_style: persona_data["visual_style"].as_str().map(|s| s.to_string()),
        image_prompt: persona_data["image_prompt"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        image_url: None, // 不自动生成图片
        generated_at: Utc::now(),
        has_image: false, // 标记未生成图片
    };

    // 保存到数据库
    if let Err(e) = save_persona_to_db(&db, user_id, slot, &persona).await {
        tracing::error!("Failed to save persona: {}", e);
    }

    tracing::info!(
        "✓ Virtual persona generated: {} (slot {})",
        persona.name,
        slot
    );

    (
        StatusCode::OK,
        Json(PersonaResponse {
            success: true,
            persona: Some(persona),
            from_cache: false,
            message: None,
        }),
    )
}

/// 生成人物图片URL
fn generate_persona_image_url(prompt: &str, model: &str, width: i32, height: i32) -> String {
    let encoded_prompt = urlencoding::encode(prompt);
    let seed = chrono::Utc::now().timestamp() % 100000;

    format!(
        "https://image.pollinations.ai/prompt/{}?width={}&height={}&model={}&nologo=true&enhance=true&seed={}",
        encoded_prompt, width, height, model, seed
    )
}

/// 为已有的人设生成图片（管理员专用）
pub async fn generate_image(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<GenerateImageRequest>,
) -> (StatusCode, Json<GenerateImageResponse>) {
    tracing::info!("🎨 Generating image for persona (slot {})", payload.slot);

    let user_id = "default_user"; // TODO: 从认证中获取真实用户ID

    // 检查功能是否启用
    let dynamic_config = crate::GLOBAL_DYNAMIC_CONFIG.read().await.clone();
    if !dynamic_config.persona_image_enabled {
        return (
            StatusCode::OK,
            Json(GenerateImageResponse {
                success: false,
                image_url: None,
                task_id: None,
                provider: None,
                message: Some("虚拟人物功能未启用".to_string()),
            }),
        );
    }

    // 验证槽位范围
    if !(0..=1).contains(&payload.slot) {
        return (
            StatusCode::BAD_REQUEST,
            Json(GenerateImageResponse {
                success: false,
                image_url: None,
                task_id: None,
                provider: None,
                message: Some("槽位必须是0或1".to_string()),
            }),
        );
    }

    // 验证是否存在人设
    let personas = get_personas_from_db(&db, user_id).await;
    if !personas.iter().any(|p| p.slot == payload.slot) {
        return (
            StatusCode::NOT_FOUND,
            Json(GenerateImageResponse {
                success: false,
                image_url: None,
                task_id: None,
                provider: None,
                message: Some(format!("槽位{}尚无人设", payload.slot)),
            }),
        );
    }

    // 根据配置选择图片提供商
    let provider = dynamic_config.persona_image_provider.to_lowercase();

    let (image_url, task_id) = match provider.as_str() {
        "imaginepro" => {
            // 使用 ImaginePro (Midjourney)
            match &dynamic_config.imaginepro_api_key {
                Some(api_key) if !api_key.is_empty() => {
                    tracing::info!("🎨 Using ImaginePro (Midjourney) for image generation");

                    let client = crate::services::imaginepro::ImagineProClient::new(
                        api_key.clone(),
                        dynamic_config.imaginepro_callback_url.clone(),
                    );

                    // 计算 aspect_ratio（基于配置的宽高比）
                    let aspect_ratio = payload.aspect_ratio.or_else(|| {
                        let width = dynamic_config.persona_image_width;
                        let height = dynamic_config.persona_image_height;

                        // 简化比例
                        let gcd = |mut a: i32, mut b: i32| {
                            while b != 0 {
                                let temp = b;
                                b = a % b;
                                a = temp;
                            }
                            a
                        };

                        let divisor = gcd(width, height);
                        Some(format!("{}:{}", width / divisor, height / divisor))
                    });

                    match client
                        .generate_and_wait(
                            &payload.image_prompt,
                            aspect_ratio.as_deref(),
                            120, // 最长等待120秒
                        )
                        .await
                    {
                        Ok(url) => {
                            tracing::info!("✓ ImaginePro image generated: {}", url);
                            (url, None)
                        }
                        Err(e) => {
                            tracing::error!("❌ ImaginePro generation failed: {}", e);
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(GenerateImageResponse {
                                    success: false,
                                    image_url: None,
                                    task_id: None,
                                    provider: Some("imaginepro".to_string()),
                                    message: Some(format!("图片生成失败: {}", e)),
                                }),
                            );
                        }
                    }
                }
                _ => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(GenerateImageResponse {
                            success: false,
                            image_url: None,
                            task_id: None,
                            provider: Some("imaginepro".to_string()),
                            message: Some("ImaginePro API key 未配置".to_string()),
                        }),
                    );
                }
            }
        }
        "pollinations" => {
            // 使用 Pollinations AI (默认)
            tracing::info!("🎨 Using Pollinations AI for image generation");

            let url = generate_persona_image_url(
                &payload.image_prompt,
                &dynamic_config.persona_image_model,
                dynamic_config.persona_image_width,
                dynamic_config.persona_image_height,
            );

            (url, None)
        }
        _ => {
            // 未知提供商，降级到 Pollinations
            tracing::warn!(
                "Unknown provider '{}', falling back to Pollinations",
                provider
            );

            let url = generate_persona_image_url(
                &payload.image_prompt,
                &dynamic_config.persona_image_model,
                dynamic_config.persona_image_width,
                dynamic_config.persona_image_height,
            );

            (url, None)
        }
    };

    // 更新数据库中的图片URL和prompt
    let update_sql = r#"
        UPDATE virtual_personas
        SET image_url = $1, image_prompt = $2
        WHERE user_id = $3 AND slot = $4
    "#;

    if let Err(e) = db
        .execute(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            update_sql,
            vec![
                image_url.clone().into(),
                payload.image_prompt.clone().into(),
                user_id.into(),
                payload.slot.into(),
            ],
        ))
        .await
    {
        tracing::error!("Failed to update image URL: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenerateImageResponse {
                success: false,
                image_url: None,
                task_id: None,
                provider: Some(provider.clone()),
                message: Some(format!("Failed to save image: {}", e)),
            }),
        );
    }

    tracing::info!("✓ Image generated and saved: {}", image_url);

    (
        StatusCode::OK,
        Json(GenerateImageResponse {
            success: true,
            image_url: Some(image_url),
            task_id,
            provider: Some(provider),
            message: None,
        }),
    )
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeletePersonaRequest {
    pub slot: i32, // 要删除的槽位号
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeletePersonaResponse {
    pub success: bool,
    pub message: Option<String>,
}

/// 删除指定槽位的人设
pub async fn delete_persona(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<DeletePersonaRequest>,
) -> (StatusCode, Json<DeletePersonaResponse>) {
    tracing::info!("🗑️ Deleting persona (slot {})", payload.slot);

    let user_id = "default_user"; // TODO: 从认证中获取真实用户ID

    // 检查功能是否启用
    let dynamic_config = crate::GLOBAL_DYNAMIC_CONFIG.read().await.clone();
    if !dynamic_config.persona_image_enabled {
        return (
            StatusCode::OK,
            Json(DeletePersonaResponse {
                success: false,
                message: Some("虚拟人物功能未启用".to_string()),
            }),
        );
    }

    // 验证槽位范围
    if !(0..=1).contains(&payload.slot) {
        return (
            StatusCode::BAD_REQUEST,
            Json(DeletePersonaResponse {
                success: false,
                message: Some("槽位必须是0或1".to_string()),
            }),
        );
    }

    // 删除指定槽位的人设
    let delete_sql = r#"
        DELETE FROM virtual_personas
        WHERE user_id = $1 AND slot = $2
    "#;

    match db
        .execute(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            delete_sql,
            vec![user_id.into(), payload.slot.into()],
        ))
        .await
    {
        Ok(result) => {
            if result.rows_affected() > 0 {
                tracing::info!("✓ Persona deleted (slot {})", payload.slot);
                (
                    StatusCode::OK,
                    Json(DeletePersonaResponse {
                        success: true,
                        message: None,
                    }),
                )
            } else {
                (
                    StatusCode::NOT_FOUND,
                    Json(DeletePersonaResponse {
                        success: false,
                        message: Some(format!("槽位{}不存在人设", payload.slot)),
                    }),
                )
            }
        }
        Err(e) => {
            tracing::error!("Failed to delete persona: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(DeletePersonaResponse {
                    success: false,
                    message: Some(format!("删除失败: {}", e)),
                }),
            )
        }
    }
}
