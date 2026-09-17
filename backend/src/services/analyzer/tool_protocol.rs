//! Native tool turns for Responses and Messages. Complete responses are required
//! before handing any tool call to the existing Work authorization loop.
use super::{
    AiProvider,
    tool_calling::{TokenUsage, ToolCall, ToolDefinition, ToolMessage, ToolTurn},
};
use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::collections::HashSet;

pub(super) fn request_body(
    provider: AiProvider,
    model: &str,
    system: &str,
    history: &[ToolMessage],
    tools: &[ToolDefinition],
    max_tokens: u32,
) -> Result<Value> {
    let mut messages = Vec::new();
    for message in history {
        match (provider, message) {
            (_, ToolMessage::User { content }) => {
                messages.push(json!({"role":"user", "content":content}))
            }
            (AiProvider::OpenAIResponses, ToolMessage::Assistant { turn }) => {
                messages.extend(
                    turn.native
                        .as_array()
                        .ok_or_else(|| anyhow::anyhow!("Invalid Responses continuation"))?
                        .iter()
                        .cloned(),
                );
            }
            (AiProvider::Anthropic, ToolMessage::Assistant { turn }) => {
                messages.push(turn.native.clone())
            }
            (AiProvider::OpenAIResponses, ToolMessage::Tool { call, content }) => messages
                .push(json!({"type":"function_call_output", "call_id":call.id, "output":content})),
            (AiProvider::Anthropic, ToolMessage::Tool { call, content }) => {
                let result =
                    json!({"type":"tool_result", "tool_use_id":call.id, "content":content});
                if let Some(last) = messages
                    .last_mut()
                    .filter(|last| last["role"] == "user" && last["content"].is_array())
                {
                    last["content"].as_array_mut().unwrap().push(result);
                } else {
                    messages.push(json!({"role":"user", "content":[result]}));
                }
            }
            _ => bail!("Unsupported native tool protocol"),
        }
    }
    Ok(match provider {
        AiProvider::OpenAIResponses => {
            json!({"model":model, "instructions":system, "input":messages, "store":false, "include":["reasoning.encrypted_content"], "max_output_tokens":max_tokens,
            "tools":tools.iter().map(|t| json!({"type":"function", "name":t.name, "description":t.description, "parameters":t.parameters, "strict":false})).collect::<Vec<_>>()})
        }
        AiProvider::Anthropic => {
            json!({"model":model, "system":system, "messages":messages, "max_tokens":max_tokens,
            "tools":tools.iter().map(|t| json!({"name":t.name, "description":t.description, "input_schema":t.parameters})).collect::<Vec<_>>()})
        }
        _ => bail!("Unsupported native tool protocol"),
    })
}

pub(super) fn response_turn(provider: AiProvider, model: &str, body: &Value) -> Result<ToolTurn> {
    if body.get("error").is_some_and(|error| !error.is_null()) {
        bail!("Model provider returned an error");
    }
    let (blocks, native) = match provider {
        AiProvider::OpenAIResponses if body["status"] == "completed" => {
            let blocks = body["output"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("Missing Responses output"))?;
            (blocks, body["output"].clone())
        }
        AiProvider::Anthropic
            if matches!(body["stop_reason"].as_str(), Some("end_turn" | "tool_use")) =>
        {
            let blocks = body["content"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("Missing Messages content"))?;
            (blocks, json!({"role":"assistant", "content":blocks}))
        }
        _ => bail!("Model response was incomplete; no tools were executed"),
    };
    let mut text = String::new();
    let mut calls = Vec::new();
    for block in blocks {
        match block["type"].as_str() {
            Some("function_call") if provider == AiProvider::OpenAIResponses => {
                calls.push(ToolCall {
                    id: block["call_id"].as_str().unwrap_or_default().into(),
                    name: block["name"].as_str().unwrap_or_default().into(),
                    arguments: block["arguments"].as_str().unwrap_or_default().into(),
                })
            }
            Some("tool_use") if provider == AiProvider::Anthropic => calls.push(ToolCall {
                id: block["id"].as_str().unwrap_or_default().into(),
                name: block["name"].as_str().unwrap_or_default().into(),
                arguments: block["input"].to_string(),
            }),
            Some("text") => text.push_str(block["text"].as_str().unwrap_or_default()),
            Some("message") => {
                if let Some(content) = block["content"].as_array() {
                    for part in content {
                        if part["type"] == "output_text" {
                            text.push_str(part["text"].as_str().unwrap_or_default());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let mut ids = HashSet::new();
    for call in &calls {
        if call.id.is_empty()
            || call.name.is_empty()
            || !ids.insert(&call.id)
            || !serde_json::from_str::<Value>(&call.arguments).is_ok_and(|v| v.is_object())
        {
            bail!("Model returned invalid tool calls");
        }
    }
    if calls.is_empty() && text.trim().is_empty() {
        bail!("Model returned no answer or tool calls");
    }
    let usage = body["usage"]["input_tokens"]
        .as_u64()
        .zip(body["usage"]["output_tokens"].as_u64())
        .map(|(input_tokens, output_tokens)| TokenUsage {
            input_tokens,
            output_tokens,
        });
    Ok(ToolTurn {
        text,
        calls,
        native,
        provider: provider.as_str().into(),
        model: Some(model.into()),
        usage,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn responses_preserve_reasoning_and_correlate_tool_results() {
        let body = json!({"status":"completed", "error":null, "output":[{"type":"reasoning","id":"r1","encrypted_content":"opaque"},{"type":"function_call","call_id":"c1","name":"lookup","arguments":"{}"}]});
        let turn = response_turn(AiProvider::OpenAIResponses, "model", &body).unwrap();
        let call = turn.calls[0].clone();
        let request = request_body(
            AiProvider::OpenAIResponses,
            "model",
            "system",
            &[
                ToolMessage::Assistant { turn },
                ToolMessage::Tool {
                    call,
                    content: "result".into(),
                },
            ],
            &[],
            100,
        )
        .unwrap();
        assert_eq!(request["input"][0]["encrypted_content"], "opaque");
        assert_eq!(request["input"][2]["call_id"], "c1");
        assert_eq!(request["input"][2]["type"], "function_call_output");
        assert!(
            response_turn(
                AiProvider::OpenAIResponses,
                "model",
                &json!({"status":"incomplete","output":body["output"]})
            )
            .is_err()
        );
    }
    #[test]
    fn anthropic_preserves_signatures_and_groups_parallel_tool_results() {
        let body = json!({"stop_reason":"tool_use", "content":[{"type":"thinking","thinking":"private","signature":"sig"},{"type":"tool_use","id":"c1","name":"lookup","input":{}},{"type":"tool_use","id":"c2","name":"lookup","input":{}}]});
        let turn = response_turn(AiProvider::Anthropic, "model", &body).unwrap();
        let calls = turn.calls.clone();
        let mut history = vec![ToolMessage::Assistant { turn }];
        history.extend(calls.into_iter().map(|call| ToolMessage::Tool {
            call,
            content: "ok".into(),
        }));
        let request =
            request_body(AiProvider::Anthropic, "model", "system", &history, &[], 100).unwrap();
        assert_eq!(request["messages"][0]["content"][0]["signature"], "sig");
        assert_eq!(
            request["messages"][1]["content"].as_array().unwrap().len(),
            2
        );
        assert!(
            response_turn(
                AiProvider::Anthropic,
                "model",
                &json!({"stop_reason":"max_tokens","content":body["content"]})
            )
            .is_err()
        );
    }
}
