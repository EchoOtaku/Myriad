//! MCP Manager
//!
//! 拥有所有 MCP 服务器实例，维护 server_id.tool_name → server 的路由索引，
//! 提供统一的 call_tool 入口。
//!
//! 支持：
//! - 配置文件 mtime 热重载
//! - 未就绪服务器周期重试
//! - 进程退出时 graceful shutdown

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use tokio::sync::{Mutex, RwLock};

use super::config::{load_config, McpServerConfig};
use super::protocol::McpToolDef;
use super::server::{McpServer, SharedMcpServer};

/// MCP 管理器 — 拥有所有 MCP 服务器实例
pub struct McpManager {
    config_path: PathBuf,
    /// 服务器列表（热重载时整表替换）
    servers: RwLock<Vec<SharedMcpServer>>,
    /// server_id.tool_name → server index
    tool_index: Mutex<HashMap<String, usize>>,
    /// 上次加载配置时的 mtime
    loaded_mtime: Mutex<Option<SystemTime>>,
    /// 串行化 reload，避免并发双启子进程
    reload_lock: Mutex<()>,
}

impl McpManager {
    /// 从配置文件初始化所有 MCP 服务器
    pub async fn init(config_path: &Path) -> Arc<Self> {
        let mtime = file_mtime(config_path).await;
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
            config_path: config_path.to_path_buf(),
            servers: RwLock::new(servers),
            tool_index: Mutex::new(HashMap::new()),
            loaded_mtime: Mutex::new(mtime),
            reload_lock: Mutex::new(()),
        });

        // 后台启动所有服务器（不阻塞 main）
        let mgr = manager.clone();
        tokio::spawn(async move {
            mgr.start_all().await;
            // 维护循环：配置热重载 + 未就绪重试
            mgr.run_maintenance_loop().await;
        });

        manager
    }

    async fn run_maintenance_loop(&self) {
        let interval = std::time::Duration::from_secs(60);
        loop {
            tokio::time::sleep(interval).await;
            if let Err(e) = self.reload_if_config_changed().await {
                tracing::warn!(error = %e, "[MCP] Config reload failed");
            }
            self.retry_unhealthy().await;
        }
    }

    /// 启动当前列表中的所有服务器并建立工具索引
    async fn start_all(&self) {
        let servers = self.servers.read().await.clone();
        for (idx, server) in servers.iter().enumerate() {
            let mut srv = server.lock().await;
            let server_id = srv.config.id.clone();

            match srv.start().await {
                Ok(()) => {
                    self.reindex_server(idx, &server_id, srv.tools()).await;
                    if let Some(manager) =
                        crate::services::agent::notifications::get_notification_manager()
                    {
                        manager
                            .notify_mcp_server_status(
                                &server_id,
                                true,
                                &format!("已加载 {} 个工具", srv.tools().len()),
                            )
                            .await;
                    }
                }
                Err(e) => {
                    tracing::error!(
                        server = %server_id,
                        error = %e,
                        "Failed to start MCP server"
                    );
                    if let Some(manager) =
                        crate::services::agent::notifications::get_notification_manager()
                    {
                        manager
                            .notify_mcp_server_status(&server_id, false, &e)
                            .await;
                    }
                }
            }
        }

        let index = self.tool_index.lock().await;
        if !index.is_empty() {
            tracing::info!(
                "[MCP] Tool index built: {} tool(s) across {} server(s)",
                index.len(),
                servers.len()
            );
        }
    }

    async fn reindex_server(&self, idx: usize, server_id: &str, tools: &[McpToolDef]) {
        let mut index = self.tool_index.lock().await;
        index.retain(|_, &mut i| i != idx);
        for tool in tools {
            index.insert(format!("{}.{}", server_id, tool.name), idx);
        }
    }

    /// 若 `mcp_servers.json` mtime 变化则热重载整表配置
    pub async fn reload_if_config_changed(&self) -> Result<bool, String> {
        let current = file_mtime(&self.config_path).await;
        let stale = {
            let loaded = self.loaded_mtime.lock().await;
            current != *loaded
        };
        if !stale {
            return Ok(false);
        }
        self.reload_from_disk().await?;
        Ok(true)
    }

    /// 强制从磁盘重载（API / 维护用）
    pub async fn reload_from_disk(&self) -> Result<(), String> {
        let _guard = self.reload_lock.lock().await;

        let config = load_config(&self.config_path).await;
        let enabled: Vec<McpServerConfig> =
            config.servers.into_iter().filter(|s| s.enabled).collect();

        tracing::info!(
            count = enabled.len(),
            "[MCP] Reloading server configuration from {}",
            self.config_path.display()
        );

        let new_servers: Vec<SharedMcpServer> = enabled
            .into_iter()
            .map(|cfg| Arc::new(Mutex::new(McpServer::new(cfg))))
            .collect();

        // 取出旧列表，换上新列表
        let old_servers = {
            let mut servers = self.servers.write().await;
            std::mem::replace(&mut *servers, new_servers)
        };
        {
            let mut index = self.tool_index.lock().await;
            index.clear();
        }
        *self.loaded_mtime.lock().await = file_mtime(&self.config_path).await;

        // 关闭旧子进程（在新列表之外，不阻塞新启动）
        for server in old_servers {
            let mut srv = server.lock().await;
            srv.shutdown().await;
        }

        // 启动新配置
        self.start_all().await;
        Ok(())
    }

    /// 对未就绪 / 不健康且允许 auto_restart 的服务器做一次恢复尝试
    pub async fn retry_unhealthy(&self) {
        let servers = self.servers.read().await.clone();
        for (idx, server) in servers.iter().enumerate() {
            let mut srv = server.lock().await;
            if srv.is_healthy() {
                continue;
            }
            if !srv.config.auto_restart {
                continue;
            }
            let server_id = srv.config.id.clone();
            tracing::info!(server = %server_id, "[MCP] Maintenance: retrying unhealthy server");
            match srv.force_restart().await {
                Ok(()) => {
                    self.reindex_server(idx, &server_id, srv.tools()).await;
                    if let Some(manager) =
                        crate::services::agent::notifications::get_notification_manager()
                    {
                        manager
                            .notify_mcp_server_status(&server_id, true, "维护重试成功")
                            .await;
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        server = %server_id,
                        error = %e,
                        "[MCP] Maintenance restart failed"
                    );
                }
            }
        }
    }

    /// 调用 MCP 工具（自动路由到正确的服务器）
    pub async fn call_tool(
        &self,
        server_id: &str,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let qualified_name = format!("{}.{}", server_id, tool_name);
        let server_idx = {
            let index = self.tool_index.lock().await;
            *index
                .get(&qualified_name)
                .ok_or_else(|| format!("MCP tool '{}' not found", qualified_name))?
        };

        let server = {
            let servers = self.servers.read().await;
            servers
                .get(server_idx)
                .cloned()
                .ok_or_else(|| format!("MCP server index {} out of range", server_idx))?
        };

        let mut srv = server.lock().await;

        // 健康检查 + 自动重启
        if !srv.is_healthy() && srv.config.auto_restart {
            tracing::warn!(tool = %qualified_name, "MCP server unhealthy, attempting restart");
            let restarted_server_id = srv.config.id.clone();
            if let Err(error) = srv.try_restart().await {
                if let Some(manager) =
                    crate::services::agent::notifications::get_notification_manager()
                {
                    manager
                        .notify_mcp_server_status(&restarted_server_id, false, &error)
                        .await;
                }
                return Err(error);
            }
            if let Some(manager) = crate::services::agent::notifications::get_notification_manager()
            {
                manager
                    .notify_mcp_server_status(&restarted_server_id, true, "自动重启成功")
                    .await;
            }

            self.reindex_server(server_idx, &restarted_server_id, srv.tools())
                .await;
        }

        let result_text = srv.call_tool(tool_name, arguments).await?;

        Ok(serde_json::Value::String(result_text))
    }

    /// 获取所有已注册的 MCP 工具定义（用于 Planner 的能力索引）
    pub async fn list_tools(&self) -> Vec<(String, McpToolDef)> {
        let mut all_tools = Vec::new();
        let servers = self.servers.read().await;
        for server in servers.iter() {
            let srv = server.lock().await;
            let server_id = srv.config.id.clone();
            for tool in srv.tools() {
                all_tools.push((server_id.clone(), tool.clone()));
            }
        }
        all_tools
    }

    /// 优雅关闭所有 MCP 子进程（进程退出前调用）
    pub async fn shutdown_all(&self) {
        let servers = self.servers.read().await.clone();
        for server in servers {
            let mut srv = server.lock().await;
            srv.shutdown().await;
        }
        tracing::info!("[MCP] All servers shut down");
    }
}

async fn file_mtime(path: &Path) -> Option<SystemTime> {
    tokio::fs::metadata(path).await.ok()?.modified().ok()
}
