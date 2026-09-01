use once_cell::sync::Lazy;

use serde_json::{json, Value};

use std::cmp::Reverse;

use std::collections::HashMap;

pub use myriad_agent_rules::{extract_json_array_from_ai_response, project_time_info, weekday_zh};

pub fn parse_rsshub_radar_rules(content: &str) -> Value {
    let mut routes = Vec::new();

    // radar-rules.js 的格式大致为:
    // module.exports = {
    // 'zhihu.com': { _name: '知乎', daily: [{ title: '日报', ... }] },
    // ...
    // }

    // 使用正则提取域名和路由信息
    let domain_re = regex::Regex::new(r#"'([^']+\.[^']+)':\s*\{"#).unwrap();
    let name_re = regex::Regex::new(r#"_name:\s*['"]([^'"]+)['"]"#).unwrap();
    let route_re = regex::Regex::new(r#"(\w+):\s*\[\s*\{\s*title:\s*['"]([^'"]+)['"]"#).unwrap();
    let target_re = regex::Regex::new(r#"target:\s*['"]([^'"]+)['"]"#).unwrap();

    // 按域名块分割
    let blocks: Vec<&str> = content.split("': {").collect();

    for block in blocks.iter().skip(1) {
        // 提取域名
        let domain = if let Some(prev_part) = blocks.iter().find(|b| !block.starts_with(*b)) {
            // 从前一个块的末尾提取域名
            domain_re
                .captures(prev_part)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str())
                .unwrap_or("")
        } else {
            ""
        };

        // 提取名称
        let name = name_re
            .captures(block)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
            .unwrap_or("");

        // 提取路由
        for cap in route_re.captures_iter(block) {
            let _route_key = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let title = cap.get(2).map(|m| m.as_str()).unwrap_or("");

            // 提取 target（RSSHub 路径）
            if let Some(target_cap) = target_re.captures(block) {
                let target = target_cap.get(1).map(|m| m.as_str()).unwrap_or("");

                if !target.is_empty() && !name.is_empty() {
                    // 检查是否需要额外参数（路径中包含 :param 且不是可选的）
                    let requires_config = target.contains(":")
                        && !target.contains("?")
                        && target.matches(':').count() > 1;

                    routes.push(json!({
                        "name": format!("{} - {}", name, title),
                        "path": target,
                        "description": format!("{} 的 {} 订阅", name, title),
                        "domain": domain,
                        "requiresConfig": requires_config
                    }));
                }
            }
        }
    }

    json!(routes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn project_time_info_uses_supplied_clock_not_hidden_now() {
        use chrono::{TimeZone, Utc};
        let now = Utc.with_ymd_and_hms(2026, 7, 31, 12, 30, 0).unwrap();
        let out = project_time_info(now, "Asia/Shanghai").expect("valid zone");
        assert_eq!(out["timezone"], "Asia/Shanghai");
        assert_eq!(out["year"], 2026);
        assert_eq!(out["month"], 7);
        assert_eq!(out["day"], 31);
        assert_eq!(out["hour"], 20);
        assert_eq!(out["minute"], 30);
        assert_eq!(out["weekday"], "星期五"); // 2026-07-31 20:30 +08 is Friday
        assert_eq!(out["timestamp"], now.timestamp());
        assert!(out["datetime"]
            .as_str()
            .unwrap()
            .starts_with("2026-07-31T20:30:00"));
        assert!(project_time_info(now, "Not/AZone").is_err());
        let utc = project_time_info(now, "UTC").expect("utc");
        assert_eq!(utc["hour"], 12);
        let offset = project_time_info(now, "UTC+8").expect("offset");
        assert_eq!(offset["hour"], 20);
    }
}
