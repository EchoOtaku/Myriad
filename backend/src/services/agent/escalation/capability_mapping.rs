//! 能力升级映射表
//!
//! 定义本地能力与联网能力的升级关系。
//! 当本地能力执行失败或返回空结果时，系统会查询此映射表决定如何升级。
//!
//! ## 设计原则
//!
//! 1. **同类优先**：优先升级到同类型的联网能力（如音乐 → 音乐搜索）
//! 2. **保留语义**：升级后的能力应保留原始查询的语义
//! 3. **渐进升级**：先尝试平台特定的升级，再回退到通用联网搜索

use std::collections::HashMap;
use once_cell::sync::Lazy;

/// 能力升级配置
#[derive(Debug, Clone)]
pub struct CapabilityEscalation {
    /// 升级目标能力 ID
    pub target_capability: &'static str,
    /// 升级说明
    pub description: &'static str,
    /// 是否需要保留原始参数
    pub preserve_params: bool,
    /// 参数转换规则（原参数名 → 新参数名）
    pub param_mapping: Option<&'static [(&'static str, &'static str)]>,
}

/// 全局能力升级映射表
pub static CAPABILITY_ESCALATION_MAP: Lazy<HashMap<&'static str, CapabilityEscalation>> = Lazy::new(|| {
    let mut map = HashMap::new();

    // ============ Brew 订阅系统 → Brew 阅读列表生成 ============
    // Brew 有专门的联网能力 brew.generateReadingList，优先使用

    map.insert("brew.items", CapabilityEscalation {
        target_capability: "brew.generateReadingList",  // 优先使用 Brew 内置的联网搜索
        description: "文章列表为空，升级到 Brew 阅读列表生成（内置联网搜索）",
        preserve_params: true,
        param_mapping: Some(&[
            ("keyword", "criteria"),
            ("sourceName", "criteria"),  // 源名称也可作为搜索条件
        ]),
    });

    map.insert("brew.read", CapabilityEscalation {
        target_capability: "brew.generateReadingList",  // 优先使用 Brew 内置的联网搜索
        description: "订阅内容为空，升级到 Brew 阅读列表生成（内置联网搜索）",
        preserve_params: true,
        param_mapping: Some(&[("source", "criteria"), ("keyword", "criteria")]),
    });

    // ⚠️ brew.generateReadingList 是升级能力，本身已内置联网搜索，无需再升级

    map.insert("brew.article", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "文章获取失败，升级到联网搜索",
        preserve_params: true,
        param_mapping: Some(&[("url", "query")]),
    });

    map.insert("brew.discover", CapabilityEscalation {
        target_capability: "brew.generateReadingList",  // 发现失败时尝试生成阅读列表
        description: "订阅源发现失败，升级到 Brew 阅读列表生成",
        preserve_params: true,
        param_mapping: Some(&[("query", "criteria"), ("url", "criteria")]),
    });

    // ============ 音乐系统 ============
    // 网易云有专门的搜索能力，优先使用

    map.insert("netease.playlist", CapabilityEscalation {
        target_capability: "netease.searchPlaylist",
        description: "本地歌单为空，升级到网易云搜索",
        preserve_params: true,
        param_mapping: Some(&[("keyword", "keyword")]),
    });

    map.insert("music.playlist", CapabilityEscalation {
        target_capability: "netease.searchPlaylist",
        description: "音乐列表为空，升级到网易云搜索",
        preserve_params: true,
        param_mapping: Some(&[("keyword", "keyword")]),
    });

    // ============ 平台数据 ============
    // 大多数平台 API 有限制，升级到通用联网搜索

    map.insert("platform.read", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "平台数据为空，升级到联网搜索",
        preserve_params: true,
        param_mapping: Some(&[("platform", "query"), ("keyword", "query")]),
    });

    map.insert("bilibili.user", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "B站用户数据为空，升级到联网搜索 B站相关内容",
        preserve_params: true,
        param_mapping: Some(&[("username", "query")]),
    });

    map.insert("steam.user", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "Steam 用户数据为空，升级到联网搜索游戏信息",
        preserve_params: true,
        param_mapping: Some(&[("username", "query")]),
    });

    map.insert("github.repos", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "GitHub 仓库数据为空，升级到联网搜索",
        preserve_params: true,
        param_mapping: Some(&[("username", "query"), ("repo", "query")]),
    });

    // ============ 数据库查询 ============
    // 本地数据库查不到时联网搜索

    map.insert("database.anime", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "本地动漫数据库无匹配，联网搜索动漫信息",
        preserve_params: true,
        param_mapping: Some(&[("name", "query"), ("keyword", "query")]),
    });

    map.insert("database.game", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "本地游戏数据库无匹配，联网搜索游戏信息",
        preserve_params: true,
        param_mapping: Some(&[("name", "query"), ("keyword", "query")]),
    });

    map.insert("database.artist", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "本地艺人数据库无匹配，联网搜索艺人信息",
        preserve_params: true,
        param_mapping: Some(&[("name", "query"), ("keyword", "query")]),
    });

    // ============ 搜索系统 ============
    // 本地搜索无结果时升级到联网

    map.insert("search.global", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "全局搜索无结果，升级到联网搜索",
        preserve_params: true,
        param_mapping: Some(&[("query", "query"), ("keyword", "query")]),
    });

    map.insert("search.fuzzy", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "模糊搜索无结果，升级到联网搜索",
        preserve_params: true,
        param_mapping: Some(&[("query", "query")]),
    });

    // ============ 报告系统 ============
    // 报告生成需要数据，数据不足时联网获取

    map.insert("report.create", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "报告数据不足，联网获取更多信息",
        preserve_params: true,
        param_mapping: Some(&[("topic", "query"), ("title", "query")]),
    });

    map.insert("report.comprehensive", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "综合报告数据不足，联网获取更多信息",
        preserve_params: true,
        param_mapping: Some(&[("topic", "query")]),
    });

    // ============ Tapp 系统 ============
    // Tapp 数据不足时联网搜索相关信息

    map.insert("tapp.list", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "本地 Tapp 列表为空，联网搜索相关应用",
        preserve_params: true,
        param_mapping: Some(&[("category", "query"), ("keyword", "query")]),
    });

    // ============ 外部服务 ============

    map.insert("hitokoto.get", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "一言服务失败，联网获取名言",
        preserve_params: false,
        param_mapping: None,
    });

    map.insert("weather.get", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "天气服务失败，联网搜索天气信息",
        preserve_params: true,
        param_mapping: Some(&[("location", "query"), ("city", "query")]),
    });

    map.insert("notion.query", CapabilityEscalation {
        target_capability: "ai.webSearch",
        description: "Notion 查询失败，联网搜索相关信息",
        preserve_params: true,
        param_mapping: Some(&[("query", "query")]),
    });

    map
});

/// 获取能力的升级配置
pub fn get_escalation(capability_id: &str) -> Option<&'static CapabilityEscalation> {
    CAPABILITY_ESCALATION_MAP.get(capability_id)
}

/// 检查能力是否有升级路径
#[allow(dead_code)]
pub fn has_escalation(capability_id: &str) -> bool {
    CAPABILITY_ESCALATION_MAP.contains_key(capability_id)
}

/// 获取所有可升级的能力 ID 列表
#[allow(dead_code)]
pub fn get_all_escalatable_capabilities() -> Vec<&'static str> {
    CAPABILITY_ESCALATION_MAP.keys().copied().collect()
}

/// 根据原始能力和参数，生成升级后的参数
pub fn transform_params(
    capability_id: &str,
    original_params: &serde_json::Value,
) -> Option<serde_json::Value> {
    let escalation = get_escalation(capability_id)?;

    if !escalation.preserve_params {
        return Some(serde_json::json!({}));
    }

    let Some(param_mapping) = escalation.param_mapping else {
        return Some(original_params.clone());
    };

    let mut new_params = serde_json::Map::new();

    if let serde_json::Value::Object(obj) = original_params {
        // 应用参数映射
        for (from, to) in param_mapping.iter() {
            if let Some(value) = obj.get(*from) {
                new_params.insert(to.to_string(), value.clone());
            }
        }

        // 保留未映射的参数
        for (key, value) in obj {
            if !new_params.contains_key(key) && !param_mapping.iter().any(|(from, _)| from == key) {
                new_params.insert(key.clone(), value.clone());
            }
        }
    }

    Some(serde_json::Value::Object(new_params))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_brew_escalation() {
        let escalation = get_escalation("brew.items");
        assert!(escalation.is_some());

        let esc = escalation.unwrap();
        // Brew 能力应该升级到 brew.generateReadingList（内置联网搜索）
        assert_eq!(esc.target_capability, "brew.generateReadingList");
        assert!(esc.preserve_params);
    }

    #[test]
    fn test_brew_generate_reading_list_no_escalation() {
        // brew.generateReadingList 是升级能力，本身不需要再升级
        let escalation = get_escalation("brew.generateReadingList");
        assert!(escalation.is_none(), "brew.generateReadingList should not have escalation path");
    }

    #[test]
    fn test_music_escalation() {
        let escalation = get_escalation("netease.playlist");
        assert!(escalation.is_some());

        let esc = escalation.unwrap();
        // 音乐应该升级到网易云搜索，而不是通用联网搜索
        assert_eq!(esc.target_capability, "netease.searchPlaylist");
    }

    #[test]
    fn test_param_transform() {
        let original = json!({
            "keyword": "政治新闻",
            "limit": 10
        });

        let transformed = transform_params("brew.items", &original);
        assert!(transformed.is_some());

        let params = transformed.unwrap();
        // keyword 应该映射到 criteria（brew.generateReadingList 的参数）
        assert!(params.get("criteria").is_some());
        assert_eq!(params.get("criteria").unwrap(), "政治新闻");
    }

    #[test]
    fn test_has_escalation() {
        assert!(has_escalation("brew.items"));
        assert!(has_escalation("netease.playlist"));
        assert!(!has_escalation("ai.webSearch")); // 联网能力本身不需要升级
        assert!(!has_escalation("ai.summarize")); // AI 处理能力不需要升级
    }

    #[test]
    fn test_all_escalatable() {
        let all = get_all_escalatable_capabilities();
        assert!(all.len() > 10); // 应该有足够多的可升级能力
        assert!(all.contains(&"brew.items"));
        assert!(all.contains(&"database.anime"));
    }
}
