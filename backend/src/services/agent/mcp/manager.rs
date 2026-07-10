//! MCP Manager
//!
//! 拥有所有 MCP 服务器实例，维护 tool_name → server 的路由索引，
//! 提供统一的 call_tool 入口。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::config::{load_config, McpServerConfig};
use super::protocol::McpToolDef;
use super::server::{McpServer, SharedMcpServer};

/// MCP 管理器 — 拥有所有 MCP 服务器实例
pub struct McpManager {
    servers: Vec<SharedMcpServer>,
    /// tool_name → server index（用于 call_tool 路由）
    tool_index: Mutex<HashMap<String, usize>>,
}

impl McpManager {
    /// 从配置文件初始化所有 MCP 服务器
    pub async fn init(config_path: &Path) -> Arc<Self> {
        let config = load_config(config_path).await;

        let enabled: Vec<McpServerConfig> =
            config.servers.into_iter().filter(|s| s.enabled).collect();

        if enabled.is_empty() {
            tracing::debug!("[MCP] No enabled servers configured");
        } else {
            tracing::info!("[MCP] Loading {} server(s)", enabled.len());
        }

        let servers: Vec<SharedMcpServer> = enabled
            .into_iter()
            .map(|cfg| Arc::new(Mutex::new(McpServer::new(cfg))))
            .collect();

        let manager = Arc::new(Self {
            servers,
            tool_index: Mutex::new(HashMap::new()),
        });

        // 后台启动所有服务器（不阻塞 main）
        let mgr = manager.clone();
        tokio::spawn(async move {
            mgr.start_all().await;
        });

        manager
    }

    /// 启动所有服务器并建立工具索引
    async fn start_all(&self) {
        for (idx, server) in self.servers.iter().enumerate() {
            let mut srv = server.lock().await;
            let server_id = srv.config.id.clone();

            match srv.start().await {
                Ok(()) => {
                    // 注册工具到索引
                    let mut index = self.tool_index.lock().await;
                    for tool in srv.tools() {
                        let qualified_name = tool.name.clone();
                        if index.contains_key(&qualified_name) {
                            tracing::warn!(
                                tool = %qualified_name,
                                server = %server_id,
                                "Duplicate MCP tool name, overwriting"
                            );
                        }
                        index.insert(qualified_name, idx);
                    }
                }
                Err(e) => {
                    tracing::error!(
                        server = %server_id,
                        error = %e,
                        "Failed to start MCP server"
                    );
                }
            }
        }

        let index = self.tool_index.lock().await;
        if !index.is_empty() {
            tracing::info!(
                "[MCP] Tool index built: {} tool(s) across {} server(s)",
                index.len(),
                self.servers.len()
            );
        }
    }

    /// 调用 MCP 工具（自动路由到正确的服务器）
    pub async fn call_tool(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let server_idx = {
            let index = self.tool_index.lock().await;
            *index
                .get(tool_name)
                .ok_or_else(|| format!("MCP tool '{}' not found", tool_name))?
        };

        let server = &self.servers[server_idx];
        let mut srv = server.lock().await;

        // 健康检查 + 自动重启
        if !srv.is_healthy() && srv.config.auto_restart {
            tracing::warn!(tool = %tool_name, "MCP server unhealthy, attempting restart");
            srv.try_restart().await?;

            // 重建该服务器的工具索引
            let mut index = self.tool_index.lock().await;
            // 移除旧的
            index.retain(|_, &mut idx| idx != server_idx);
            // 添加新的
            for tool in srv.tools() {
                index.insert(tool.name.clone(), server_idx);
            }
        }

        let result_text = srv.call_tool(tool_name, arguments).await?;

        Ok(serde_json::Value::String(result_text))
    }

    /// 获取所有已注册的 MCP 工具定义（用于 Planner 的能力索引）
    pub async fn list_tools(&self) -> Vec<(String, McpToolDef)> {
        let mut all_tools = Vec::new();
        for server in &self.servers {
            let srv = server.lock().await;
            let server_id = srv.config.id.clone();
            for tool in srv.tools() {
                all_tools.push((server_id.clone(), tool.clone()));
            }
        }
        all_tools
    }
}
