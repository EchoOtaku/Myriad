//! Native tool protocol. Provider continuation data stays in server checkpoints,
//! never in AgentResponse or SSE. A truncated stream cannot authorize a tool.
use super::{AiAnalyzer, AiProvider};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "snake_case")]
pub(crate) enum ToolMessage {
    User { content: String },
    Assistant { turn: ToolTurn },
    Tool { call: ToolCall, content: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ToolTurn {
    pub text: String,
    pub calls: Vec<ToolCall>,
    /// Complete provider assistant message (reasoning/signatures included).
    pub native: Value,
    pub provider: String,
}

const MAX_STREAM_BYTES: usize = 4 * 1024 * 1024;

pub(crate) fn request_body(
    provider: AiProvider,
    model: &str,
    system: &str,
    history: &[ToolMessage],
    tools: &[ToolDefinition],
    max_tokens: u32,
) -> Result<Value> {
    // A provider switch mid-run cannot silently discard required signatures.
    for message in history {
        if let ToolMessage::Assistant { turn } = message {
            if turn.provider != provider.as_str() {
                bail!("The model provider changed during this task; restore its provider to continue");
            }
        }
    }
    match provider {
        AiProvider::OpenAI => {
            let mut messages = vec![json!({"role":"system","content":system})];
            for message in history {
                messages.push(match message {
                    ToolMessage::User { content } => json!({"role":"user","content":content}),
                    ToolMessage::Assistant { turn } => turn.native.clone(),
                    ToolMessage::Tool { call, content } => json!({"role":"tool","tool_call_id":call.id,"content":content}),
                });
            }
            Ok(json!({"model":model,"messages":messages,"stream":true,"max_tokens":max_tokens,
                "tools":tools.iter().map(|tool| json!({"type":"function","function":tool})).collect::<Vec<_>>()}))
        }
        AiProvider::Gemini => {
            let mut contents: Vec<Value> = Vec::new();
            for message in history {
                match message {
                    ToolMessage::User { content } => contents.push(json!({"role":"user","parts":[{"text":content}]})),
                    ToolMessage::Assistant { turn } => contents.push(turn.native.clone()),
                    ToolMessage::Tool { call, content } => {
                        let mut response = json!({"name":call.name,"response":{"result":content}});
                        // Generated ids are local correlation ids; do not invent provider ids.
                        if !call.id.starts_with("myriad_") { response["id"] = json!(call.id); }
                        let part = json!({"functionResponse":response});
                        if let Some(last) = contents.last_mut().filter(|v| v["role"] == "user" && v["parts"][0].get("functionResponse").is_some()) {
                            last["parts"].as_array_mut().unwrap().push(part);
                        } else { contents.push(json!({"role":"user","parts":[part]})); }
                    }
                }
            }
            Ok(json!({"systemInstruction":{"parts":[{"text":system}]},"contents":contents,
                "generationConfig":{"maxOutputTokens":max_tokens},
                "tools":[{"functionDeclarations":tools.iter().map(|t| json!({"name":t.name,"description":t.description,"parametersJsonSchema":t.parameters})).collect::<Vec<_>>()}]}))
        }
    }
}

#[derive(Default)]
struct Accumulator {
    text: String,
    reasoning: String,
    reasoning_details: Vec<Value>,
    calls: BTreeMap<usize, ToolCall>,
    parts: Vec<Value>,
    finish: Option<String>,
}

impl Accumulator {
    fn push(&mut self, provider: AiProvider, value: Value) -> Result<String> {
        if value.get("error").is_some() { bail!("Model provider returned an error"); }
        let mut visible = String::new();
        match provider {
            AiProvider::OpenAI => {
                let Some(choice) = value["choices"].as_array().and_then(|c| c.first()) else { return Ok(visible); };
                let delta = &choice["delta"];
                if let Some(text) = delta["content"].as_str() { visible.push_str(text); self.text.push_str(text); }
                if let Some(text) = delta["reasoning_content"].as_str().or_else(|| delta["reasoning"].as_str()) { self.reasoning.push_str(text); }
                if let Some(details) = delta["reasoning_details"].as_array() { self.reasoning_details.extend(details.iter().cloned()); }
                if let Some(calls) = delta["tool_calls"].as_array() {
                    for part in calls {
                        let index = part["index"].as_u64().ok_or_else(|| anyhow::anyhow!("Tool stream has no index"))? as usize;
                        if index >= 16 { bail!("Too many tool calls in one model turn"); }
                        let call = self.calls.entry(index).or_insert(ToolCall { id:String::new(), name:String::new(), arguments:String::new() });
                        if let Some(id) = part["id"].as_str() { call.id.push_str(id); }
                        if let Some(name) = part["function"]["name"].as_str() { call.name.push_str(name); }
                        if let Some(args) = part["function"]["arguments"].as_str() { call.arguments.push_str(args); }
                    }
                }
                if let Some(reason) = choice["finish_reason"].as_str() { self.finish = Some(reason.into()); }
            }
            AiProvider::Gemini => {
                let Some(candidate) = value["candidates"].as_array().and_then(|c| c.first()) else { return Ok(visible); };
                if let Some(parts) = candidate["content"]["parts"].as_array() {
                    for part in parts {
                        if part["thought"] != true {
                            if let Some(text) = part["text"].as_str() { visible.push_str(text); self.text.push_str(text); }
                        }
                        if let Some(function) = part.get("functionCall") {
                            let index = self.calls.len();
                            if index >= 16 { bail!("Too many tool calls in one model turn"); }
                            self.calls.insert(index, ToolCall {
                                id:function["id"].as_str().map(str::to_owned).unwrap_or_else(|| format!("myriad_{}",uuid::Uuid::new_v4().simple())),
                                name:function["name"].as_str().unwrap_or_default().into(),
                                arguments:function.get("args").cloned().unwrap_or(json!({})).to_string(),
                            });
                        }
                        // Keep each signed part in its original position, including empty text.
                        self.parts.push(part.clone());
                    }
                }
                if let Some(reason) = candidate["finishReason"].as_str() { self.finish = Some(reason.into()); }
            }
        }
        Ok(visible)
    }

    fn finish(self, provider: AiProvider) -> Result<ToolTurn> {
        if !matches!(self.finish.as_deref(), Some("stop" | "tool_calls" | "STOP")) {
            bail!("Model response was incomplete; no tools were executed");
        }
        let calls: Vec<_> = self.calls.into_values().collect();
        let mut ids = HashSet::new();
        for call in &calls {
            if call.id.is_empty() || call.name.is_empty() || !ids.insert(&call.id) {
                bail!("Model returned missing or duplicate tool call identifiers");
            }
        }
        if calls.is_empty() && self.text.trim().is_empty() { bail!("Model returned no answer or tool calls"); }
        let native = match provider {
            AiProvider::OpenAI => {
                let mut message = json!({"role":"assistant","content":self.text});
                if !calls.is_empty() { message["tool_calls"] = json!(calls.iter().map(|c| json!({"id":c.id,"type":"function","function":{"name":c.name,"arguments":c.arguments}})).collect::<Vec<_>>()); }
                if !self.reasoning.is_empty() { message["reasoning_content"] = json!(self.reasoning); }
                if !self.reasoning_details.is_empty() { message["reasoning_details"] = json!(self.reasoning_details); }
                message
            }
            AiProvider::Gemini => json!({"role":"model","parts":self.parts}),
        };
        Ok(ToolTurn { text:self.text, calls, native, provider:provider.as_str().into() })
    }
}

impl AiAnalyzer {
    pub(crate) async fn tool_turn<F, Fut>(&self, system: &str, history: &[ToolMessage], tools: &[ToolDefinition], max_tokens: u32, mut on_text: F) -> Result<ToolTurn>
    where F: FnMut(String) -> Fut + Send, Fut: std::future::Future<Output = ()> + Send {
        let body = request_body(self.provider, &self.model, system, history, tools, max_tokens)?;
        let input_bytes = body.to_string().len();
        let result = async {
            let (url, header, credential) = match self.provider {
                AiProvider::OpenAI => (super::openai_chat_completions_url(self.base_url.as_deref()), "Authorization", format!("Bearer {}",self.api_key)),
                AiProvider::Gemini => (format!("{}/v1beta/models/{}:streamGenerateContent?alt=sse",crate::services::http_client::GeminiApiUrl::get_base().await,self.model),"x-goog-api-key",self.api_key.clone()),
            };
            let mut response = self.client.post(url).header(header, credential).json(&body).send().await.map_err(|_| anyhow::anyhow!("Model connection failed"))?;
            if !response.status().is_success() {
                // Provider error bodies can echo credentials or request content.
                bail!("Model tool API returned HTTP {}", response.status().as_u16());
            }
            let mut bytes = Vec::new();
            let mut total = 0;
            let mut acc = Accumulator::default();
            while let Some(chunk) = response.chunk().await.map_err(|_| anyhow::anyhow!("Model stream interrupted"))? {
                total += chunk.len();
                if total > MAX_STREAM_BYTES { bail!("Model response exceeded the stream limit"); }
                bytes.extend_from_slice(&chunk);
                // Decode complete lines only: UTF-8 characters can span HTTP chunks.
                while let Some(end) = bytes.iter().position(|b| *b == b'\n') {
                    let line = bytes.drain(..=end).collect::<Vec<_>>();
                    let line = std::str::from_utf8(&line)?.trim();
                    if let Some(data) = line.strip_prefix("data:") {
                        let data = data.trim();
                        if data == "[DONE]" { continue; }
                        let text = acc.push(self.provider, serde_json::from_str(data)?)?;
                        if !text.is_empty() { on_text(text).await; }
                    }
                }
            }
            if !bytes.iter().all(u8::is_ascii_whitespace) { bail!("Model stream ended inside an event"); }
            acc.finish(self.provider)
        }.await;
        crate::services::ai_cost_ledger::record_ai_call_from_attribution(
            self.provider.as_str(), &self.model, input_bytes,
            result.as_ref().map(|turn| turn.native.to_string().len()).unwrap_or(0),
            if result.is_ok() {"completed"} else {"failed"},
            if result.is_ok() {None} else {Some("AI_PROVIDER_ERROR")},
        ).await;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragmented_calls_preserve_reasoning_and_call_identity() {
        let mut acc = Accumulator::default();
        acc.push(AiProvider::OpenAI,json!({"choices":[{"delta":{"reasoning_content":"private", "tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{\"q\":"}}]}}]})).unwrap();
        acc.push(AiProvider::OpenAI,json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"東京\"}"}}]},"finish_reason":"tool_calls"}]})).unwrap();
        let turn = acc.finish(AiProvider::OpenAI).unwrap();
        assert_eq!(turn.calls[0].arguments,"{\"q\":\"東京\"}");
        let call = turn.calls[0].clone();
        let body = request_body(AiProvider::OpenAI,"model","system",&[ToolMessage::Assistant{turn},ToolMessage::Tool{call,content:"found".into()}],&[],100).unwrap();
        assert_eq!(body["messages"][1]["reasoning_content"],"private");
        assert_eq!(body["messages"][2]["tool_call_id"],"call_1");
    }

    #[test]
    fn incomplete_stream_never_produces_executable_calls() {
        let mut acc = Accumulator::default();
        acc.push(AiProvider::OpenAI,json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"write","arguments":"{}"}}]}}]})).unwrap();
        assert!(acc.finish(AiProvider::OpenAI).is_err());
    }

    #[test]
    fn gemini_signed_parts_round_trip_without_merging() {
        let parts = json!([{"text":"","thoughtSignature":"s1"},{"functionCall":{"id":"fc1","name":"read","args":{}},"thoughtSignature":"s2"}]);
        let mut acc = Accumulator::default();
        acc.push(AiProvider::Gemini,json!({"candidates":[{"content":{"parts":parts},"finishReason":"STOP"}]})).unwrap();
        let turn = acc.finish(AiProvider::Gemini).unwrap();
        let call = turn.calls[0].clone();
        let history = vec![ToolMessage::Assistant{turn},ToolMessage::Tool{call,content:"ok".into()}];
        let body = request_body(AiProvider::Gemini,"model","system",&history,&[],100).unwrap();
        assert_eq!(body["contents"][0]["parts"], parts);
        assert_eq!(body["contents"][1]["parts"][0]["functionResponse"]["id"],"fc1");
        assert!(request_body(AiProvider::OpenAI,"model","system",&history,&[],100).is_err());
    }
}
