//! 执行器工具函数
//!
//! 包含字符串相似度计算、输出摘要等通用工具

use serde_json::Value;

/// 安全截断 UTF-8 字符串到指定字节长度（不会在多字节字符中间截断）
pub fn truncate_str(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// 支持的平台名称列表
pub const VALID_PLATFORMS: &[&str] = &[
    "steam", "bilibili", "github", "netease", "bangumi", "x", "discord",
];

/// 验证平台名称是否在白名单中（含 "all"），返回 Result
pub fn validate_platform_name(platform: &str) -> Result<&str, String> {
    if platform == "all" || VALID_PLATFORMS.contains(&platform) {
        Ok(platform)
    } else {
        Err(crate::services::agent::response_agent::unsupported_platform(platform))
    }
}

/// 验证平台名称是否在白名单中（不含 "all"），返回 bool
pub fn is_valid_platform(platform: &str) -> bool {
    VALID_PLATFORMS.contains(&platform)
}

/// 简单的 Levenshtein 相似度检查（用于模糊匹配）
/// 如果两个字符串的编辑距离小于较短字符串长度的一半，认为相似
pub fn levenshtein_similar(a: &str, b: &str) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }

    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let m = a_chars.len();
    let n = b_chars.len();

    // 如果长度差距太大，直接返回不相似
    if m.abs_diff(n) > m.min(n) {
        return false;
    }

    // 防御：对超长字符串截断以防 O(m*n) 爆炸
    let m = m.min(500);
    let n = n.min(500);

    // 两行滚动 DP（O(n) 内存而非 O(m*n)）
    let mut prev = (0..=n).collect::<Vec<usize>>();
    let mut curr = vec![0usize; n + 1];

    for i in 1..=m {
        curr[0] = i;
        for j in 1..=n {
            let cost = if a_chars[i - 1] == b_chars[j - 1] {
                0
            } else {
                1
            };
            curr[j] = (prev[j] + 1).min(curr[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }

    let distance = prev[n];
    let threshold = m.min(n) / 2;

    distance <= threshold.max(2)
}

/// 从步骤输出中提取图片 URL（如果存在）
pub fn extract_image_url(output: &Value) -> Option<String> {
    output
        .as_object()
        .and_then(|obj| obj.get("imageUrl"))
        .and_then(|v| v.as_str())
        .filter(|url| !url.starts_with("pixai://")) // pixai:// 是异步任务，不是真实 URL
        .map(|s| s.to_string())
}

/// 简化输出摘要（用于实时进度显示）— 委托给 response_agent
pub fn summarize_output(output: &Value) -> Option<String> {
    crate::services::agent::response_agent::summarize_step_output(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_levenshtein_similar() {
        assert!(levenshtein_similar("hello", "hallo"));
        assert!(levenshtein_similar("test", "tset"));
        assert!(!levenshtein_similar("abc", "xyz"));
        assert!(!levenshtein_similar("", "test"));
    }

    #[test]
    fn test_summarize_output() {
        use serde_json::json;

        assert_eq!(
            summarize_output(&json!({"message": "成功"})),
            Some("成功".to_string())
        );
        assert_eq!(
            summarize_output(&json!({"total": 10})),
            Some("获取了 10 条结果".to_string())
        );
        assert_eq!(
            summarize_output(&json!([1, 2, 3])),
            Some("获取了 3 条记录".to_string())
        );
    }
}
