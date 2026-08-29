//! Chat Lite prompt reconstruction. Work artifacts never belong here.

use serde_json::Value;

use super::types::ConversationMessage;

const WORK_ARTIFACT_PREFIXES: &[&str] = &["[输出数据:", "[展示类型:", "[前端动作:", "[确认"];

/// Rebuild a stored session row for a model prompt.
///
/// Chat (`for_chat`) keeps only the spoken `role` / `content`. Work may still
/// append planner-facing extras from metadata.
pub fn reconstruct_conversation_message(
    role: String,
    content: String,
    created_at: Option<String>,
    metadata: Option<&Value>,
    for_chat: bool,
) -> ConversationMessage {
    let mut content = content;
    if !for_chat && role == "assistant" {
        if let Some(extras) = work_artifact_extras(metadata) {
            content.push_str(&format!("\n{extras}"));
        }
    }
    ConversationMessage {
        role,
        content: if for_chat {
            chat_safe_content(&content)
        } else {
            content
        },
        created_at,
    }
}

/// Drop Work task metadata / confirmation / frontend-action injections that
/// may already be sitting on an assistant line.
pub fn chat_safe_content(content: &str) -> String {
    content
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            !WORK_ARTIFACT_PREFIXES
                .iter()
                .any(|prefix| trimmed.starts_with(prefix))
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

pub fn build_chat_lite_prompt(
    soul: &str,
    merope_block: &str,
    history: &[ConversationMessage],
    input: &str,
) -> String {
    let merope_prefix = if merope_block.is_empty() {
        String::new()
    } else {
        format!("{merope_block}\n\n")
    };
    let history_text = chat_history_text(history);
    if history_text.is_empty() {
        format!(
            "{soul}\n\n{merope_prefix}用户对你说：{input}\n\n\
             请以你的角色自然地回复用户。使用用户的语言。保持简短、温暖、自然。\
             不要输出任何 JSON 或格式标记，只输出纯文本回复。",
        )
    } else {
        format!(
            "{soul}\n\n{merope_prefix}以下是对话历史：\n{history_text}\n\n\
             用户最新消息：{input}\n\n\
             请以你的角色自然地回复用户。使用用户的语言。保持简短、温暖、自然。\
             不要输出任何 JSON 或格式标记，只输出纯文本回复。",
        )
    }
}

fn chat_history_text(history: &[ConversationMessage]) -> String {
    let recent: Vec<&ConversationMessage> = history.iter().rev().take(10).rev().collect();
    recent
        .into_iter()
        .map(|message| format!("{}：{}", message.role, chat_safe_content(&message.content)))
        .filter(|line| line.contains('：') && !line.ends_with('：'))
        .collect::<Vec<_>>()
        .join("\n")
}

fn work_artifact_extras(metadata: Option<&Value>) -> Option<String> {
    let meta = metadata?;
    let mut extras = Vec::new();
    if let Some(data) = meta.get("data") {
        if !data.is_null() {
            let serialized = data.to_string();
            if serialized.len() > 2 && serialized != "null" {
                let truncated: String = serialized.chars().take(500).collect();
                extras.push(format!("[输出数据: {truncated}]"));
            }
        }
    }
    if let Some(display_type) = meta
        .get("dataDisplay")
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
    {
        extras.push(format!("[展示类型: {display_type}]"));
    }
    if let Some(action) = meta
        .get("frontendAction")
        .and_then(|value| value.get("action"))
        .and_then(Value::as_str)
    {
        extras.push(format!("[前端动作: {action}]"));
    }
    if let Some(confirmation_id) = meta
        .get("confirmation")
        .and_then(|value| value.get("confirmationId").or_else(|| value.get("id")))
        .and_then(Value::as_str)
    {
        extras.push(format!("[确认: {confirmation_id}]"));
    }
    if extras.is_empty() {
        None
    } else {
        Some(extras.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn work_metadata() -> Value {
        json!({
            "data": { "task": { "status": "completed", "stepHistory": [{"id": "s1"}] } },
            "dataDisplay": { "type": "table" },
            "frontendAction": { "action": "navigate", "path": "/reports" },
            "confirmation": { "confirmationId": "cnf_1" }
        })
    }

    #[test]
    fn chat_reconstruction_drops_work_metadata() {
        let chat = reconstruct_conversation_message(
            "assistant".into(),
            "天气不错。".into(),
            None,
            Some(&work_metadata()),
            true,
        );
        assert_eq!(chat.content, "天气不错。");
        assert!(!chat.content.contains("输出数据"));
        assert!(!chat.content.contains("展示类型"));
        assert!(!chat.content.contains("前端动作"));
        assert!(!chat.content.contains("确认"));

        let work = reconstruct_conversation_message(
            "assistant".into(),
            "天气不错。".into(),
            None,
            Some(&work_metadata()),
            false,
        );
        assert!(work.content.contains("[输出数据:"));
        assert!(work.content.contains("[展示类型: table]"));
        assert!(work.content.contains("[前端动作: navigate]"));
        assert!(work.content.contains("[确认: cnf_1]"));
    }

    #[test]
    fn chat_lite_prompt_omits_work_task_confirmation_and_frontend_actions() {
        let history = vec![
            ConversationMessage {
                role: "user".into(),
                content: "帮我看下报告".into(),
                created_at: None,
            },
            reconstruct_conversation_message(
                "assistant".into(),
                "已经整理好了。\n[输出数据: {\"task\":{\"status\":\"completed\"}}]\n[展示类型: table]\n[前端动作: navigate]\n[确认: cnf_1]".into(),
                None,
                Some(&work_metadata()),
                true,
            ),
        ];
        let prompt = build_chat_lite_prompt("你是 Agent。", "", &history, "再聊聊刚才");
        assert!(prompt.contains("已经整理好了。"));
        assert!(prompt.contains("再聊聊刚才"));
        assert!(!prompt.contains("输出数据"));
        assert!(!prompt.contains("展示类型"));
        assert!(!prompt.contains("前端动作"));
        assert!(!prompt.contains("navigate"));
        assert!(!prompt.contains("confirmation"));
        assert!(!prompt.contains("cnf_1"));
        assert!(!prompt.contains("stepHistory"));
        assert!(!prompt.contains("task"));
    }
}
