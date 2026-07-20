//! MCP JSON-RPC 2.0 协议类型
//!
//! 实现 Model Context Protocol 的最小子集：
//! - JSON-RPC 2.0 请求/响应
//! - MCP initialize, tools/list, tools/call

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC 2.0 请求
#[derive(Debug, Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcRequest {
    pub fn new(id: u64, method: &str, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        }
    }
}

/// JSON-RPC 2.0 响应
///
/// `id` 允许 number / string（部分 MCP server 用字符串 id），反序列化时尽量宽松。
#[derive(Debug, Deserialize)]
pub struct JsonRpcResponse {
    #[allow(dead_code)]
    pub jsonrpc: String,
    #[allow(dead_code)]
    #[serde(default)]
    pub id: Option<Value>,
    pub result: Option<Value>,
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC 2.0 错误
#[derive(Debug, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[allow(dead_code)]
    pub data: Option<Value>,
}

/// MCP Tool 定义（从 tools/list 返回）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDef {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_schema")]
    pub input_schema: Value,
}

fn default_schema() -> Value {
    serde_json::json!({"type": "object"})
}

/// MCP initialize 结果
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInitializeResult {
    pub protocol_version: String,
    #[allow(dead_code)]
    pub capabilities: Option<Value>,
    #[allow(dead_code)]
    pub server_info: Option<Value>,
}

/// MCP tools/call 的 content 项
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct McpToolResultContent {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub data: Option<String>,
}

/// MCP tools/call 结果
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResult {
    pub content: Vec<McpToolResultContent>,
    #[serde(default)]
    pub is_error: bool,
}
