use once_cell::sync::Lazy;

use serde_json::{json, Value};

use std::cmp::Reverse;

use std::collections::HashMap;

/// Extract a JSON array from free-form AI text (raw, markdown fences).
pub fn extract_json_array_from_ai_response(text: &str) -> Vec<Value> {
    let json_start = text.find('[');
    let json_end = text.rfind(']');

    if let (Some(start), Some(end)) = (json_start, json_end) {
        if end > start {
            let json_str = &text[start..=end];
            if let Ok(arr) = serde_json::from_str::<Vec<Value>>(json_str) {
                return arr;
            }
        }
    }

    if text.contains("```json") {
        let parts: Vec<&str> = text.split("```json").collect();
        if parts.len() > 1 {
            if let Some(json_part) = parts[1].split("```").next() {
                if let Ok(arr) = serde_json::from_str::<Vec<Value>>(json_part.trim()) {
                    return arr;
                }
            }
        }
    }

    if text.contains("```") {
        let parts: Vec<&str> = text.split("```").collect();
        for part in parts {
            let trimmed = part.trim();
            if trimmed.starts_with('[') {
                if let Ok(arr) = serde_json::from_str::<Vec<Value>>(trimmed) {
                    return arr;
                }
            }
        }
    }

    vec![]
}

/// Weekday label (zh) for a chrono weekday.
pub fn weekday_zh(weekday: chrono::Weekday) -> &'static str {
    match weekday {
        chrono::Weekday::Mon => "星期一",
        chrono::Weekday::Tue => "星期二",
        chrono::Weekday::Wed => "星期三",
        chrono::Weekday::Thu => "星期四",
        chrono::Weekday::Fri => "星期五",
        chrono::Weekday::Sat => "星期六",
        chrono::Weekday::Sun => "星期日",
    }
}

/// Project a UTC instant into the wall clock of `timezone`.
///
/// Accepts IANA names (`Asia/Shanghai`), `UTC`/`Z`, `local`, and fixed offsets
/// (`+08:00`, `UTC+8`). Unknown zones fail instead of echoing UTC fields.
pub fn project_time_info(
    now: chrono::DateTime<chrono::Utc>,
    timezone: &str,
) -> Result<Value, String> {
    use chrono::{DateTime, Datelike, Local, TimeZone, Timelike};
    use chrono_tz::Tz;
    use std::str::FromStr;

    let label = timezone.trim();
    if label.is_empty() {
        return Err("Missing timezone".to_string());
    }

    fn pack<Z: TimeZone>(now: DateTime<chrono::Utc>, zoned: DateTime<Z>, timezone: &str) -> Value
    where
        Z::Offset: std::fmt::Display,
    {
        json!({
            "datetime": zoned.to_rfc3339(),
            "timestamp": now.timestamp(),
            "timezone": timezone,
            "weekday": weekday_zh(zoned.weekday()),
            "year": zoned.year(),
            "month": zoned.month(),
            "day": zoned.day(),
            "hour": zoned.hour(),
            "minute": zoned.minute()
        })
    }

    if label.eq_ignore_ascii_case("utc") || label.eq_ignore_ascii_case("z") {
        return Ok(pack(now, now, "UTC"));
    }
    if label.eq_ignore_ascii_case("local") {
        return Ok(pack(now, now.with_timezone(&Local), "local"));
    }
    if let Ok(offset) = parse_fixed_offset(label) {
        return Ok(pack(now, now.with_timezone(&offset), label));
    }
    let tz = Tz::from_str(label).map_err(|_| {
        format!("Unknown timezone '{label}': use IANA (Asia/Shanghai), UTC, local, or +08:00")
    })?;
    Ok(pack(now, now.with_timezone(&tz), label))
}

fn parse_fixed_offset(raw: &str) -> Result<chrono::FixedOffset, String> {
    let s = raw.trim();
    let body = s
        .strip_prefix("UTC")
        .or_else(|| s.strip_prefix("utc"))
        .or_else(|| s.strip_prefix("GMT"))
        .or_else(|| s.strip_prefix("gmt"))
        .unwrap_or(s)
        .trim();
    let (sign, rest) = if let Some(r) = body.strip_prefix('+') {
        (1i32, r)
    } else if let Some(r) = body.strip_prefix('-') {
        (-1i32, r)
    } else {
        return Err(format!("not a fixed offset: {raw}"));
    };
    let rest = rest.trim();
    let (hh, mm) = if let Some((h, m)) = rest.split_once(':') {
        (
            h.parse::<i32>()
                .map_err(|_| format!("Invalid timezone hour in '{raw}'"))?,
            m.parse::<i32>()
                .map_err(|_| format!("Invalid timezone minute in '{raw}'"))?,
        )
    } else {
        let h = rest
            .parse::<i32>()
            .map_err(|_| format!("Invalid timezone hour in '{raw}'"))?;
        (h, 0)
    };
    if !(0..=14).contains(&hh) || !(0..60).contains(&mm) {
        return Err(format!("Timezone offset out of range: '{raw}'"));
    }
    let secs = sign * (hh * 3600 + mm * 60);
    chrono::FixedOffset::east_opt(secs).ok_or_else(|| format!("Invalid timezone offset: '{raw}'"))
}

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
