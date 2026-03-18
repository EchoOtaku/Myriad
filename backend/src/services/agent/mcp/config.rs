//! MCP 服务器配置
//!
//! 从 `data/agent/mcp_servers.json` 加载 MCP 服务器定义。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// MCP 服务器配置集合
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct McpServersConfig {
    #[serde(default)]
    pub servers: Vec<McpServerConfig>,
}

/// 单个 MCP 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// 服务器 ID（用于日志和引用）
    pub id: String,
    /// 启动命令（如 "npx", "python", "node"）
    pub command: String,
    /// 命令参数
    #[serde(default)]
    pub args: Vec<String>,
    /// 额外环境变量
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 是否启用
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 崩溃后自动重启
    #[serde(default = "default_true")]
    pub auto_restart: bool,
    /// 最大重启次数
    #[serde(default = "default_max_restarts")]
    pub max_restart_attempts: u32,
}

fn default_true() -> bool {
    true
}
fn default_max_restarts() -> u32 {
    3
}

/// 从文件加载配置
pub async fn load_config(path: &Path) -> McpServersConfig {
    match tokio::fs::read_to_string(path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
            tracing::warn!("[MCP] Failed to parse config: {}", e);
            McpServersConfig::default()
        }),
        Err(_) => {
            tracing::debug!("[MCP] Config file not found: {}", path.display());
            McpServersConfig::default()
        }
    }
}
