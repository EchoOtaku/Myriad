//! 执行器工具函数
//!
//! 包含字符串相似度计算、输出摘要等通用工具

use serde_json::Value;

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

    // 简化版：使用 DP 计算编辑距离
    let mut dp = vec![vec![0usize; n + 1]; m + 1];
    for i in 0..=m {
        dp[i][0] = i;
    }
    for j in 0..=n {
        dp[0][j] = j;
    }

    for i in 1..=m {
        for j in 1..=n {
            let cost = if a_chars[i - 1] == b_chars[j - 1] {
                0
            } else {
                1
            };
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + cost);
        }
    }

    let distance = dp[m][n];
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

/// 简化输出摘要（用于实时进度显示）
pub fn summarize_output(output: &Value) -> Option<String> {
    if let Some(obj) = output.as_object() {
        // 图片生成结果：返回人类可读摘要，不嵌入 URL（URL 通过 StepCompleted.image_url 单独传递）
        if obj.get("imageUrl").and_then(|v| v.as_str()).is_some() {
            let provider = obj.get("provider").and_then(|v| v.as_str()).unwrap_or("AI");
            return Some(format!("已通过 {} 生成图片", provider));
        }
        if let Some(msg) = obj.get("message").and_then(|v| v.as_str()) {
            return Some(msg.to_string());
        }
        if let Some(count) = obj.get("total").and_then(|v| v.as_i64()) {
            return Some(format!("返回 {} 条结果", count));
        }
        if let Some(arr) = obj.get("feeds").and_then(|v| v.as_array()) {
            return Some(format!("找到 {} 个订阅源", arr.len()));
        }
        if let Some(arr) = obj.get("items").and_then(|v| v.as_array()) {
            return Some(format!("获取 {} 条数据", arr.len()));
        }
        if let Some(summary) = obj.get("aiSummary").and_then(|v| v.as_str()) {
            let chars: Vec<char> = summary.chars().collect();
            if chars.len() > 80 {
                return Some(format!("{}...", chars[..80].iter().collect::<String>()));
            }
            return Some(summary.to_string());
        }
        return Some(format!("返回 {} 个字段", obj.len()));
    }
    if let Some(arr) = output.as_array() {
        return Some(format!("返回 {} 条记录", arr.len()));
    }
    if let Some(s) = output.as_str() {
        let chars: Vec<char> = s.chars().collect();
        if chars.len() > 80 {
            return Some(format!("{}...", chars[..80].iter().collect::<String>()));
        }
        return Some(s.to_string());
    }
    if let Some(b) = output.as_bool() {
        return Some(if b { "成功".to_string() } else { "失败".to_string() });
    }
    None
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
            Some("返回 10 条结果".to_string())
        );
        assert_eq!(
            summarize_output(&json!([1, 2, 3])),
            Some("返回 3 条记录".to_string())
        );
    }
}
