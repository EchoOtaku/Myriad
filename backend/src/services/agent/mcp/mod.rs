//! MCP (Model Context Protocol) Client 模块
//!
//! 通过 stdio 管理多个 MCP 服务器子进程，
//! 提供统一的工具发现和调用接口。

pub mod config;
pub mod manager;
pub mod protocol;
pub mod server;
pub mod transport;

use std::path::Path;
use std::sync::{Arc, OnceLock};

use manager::McpManager;

static MCP_MANAGER: OnceLock<Arc<McpManager>> = OnceLock::new();

/// 初始化 MCP 管理器（在 main.rs 启动时调用）
pub async fn init_mcp(config_path: &Path) {
    let manager = McpManager::init(config_path).await;
    let _ = MCP_MANAGER.set(manager);
    tracing::info!("[MCP] Manager initialized");
}

/// 获取全局 MCP 管理器实例
pub fn get_mcp_manager() -> Option<&'static Arc<McpManager>> {
    MCP_MANAGER.get()
}
