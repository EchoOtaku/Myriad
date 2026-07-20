//! MCP Stdio Transport
//!
//! 通过 stdin/stdout 与 MCP 服务器子进程通信。
//! 协议：每行一个 JSON-RPC 2.0 消息（line-delimited JSON）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use super::config::McpServerConfig;
use super::protocol::{JsonRpcRequest, JsonRpcResponse};

/// Stdio 双向传输通道
pub struct StdioTransport {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    next_id: AtomicU64,
}

impl StdioTransport {
    /// 启动 MCP 服务器子进程
    pub async fn spawn(config: &McpServerConfig) -> Result<Self, String> {
        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()); // stderr 用于服务器日志

        // 注入环境变量
        for (k, v) in &config.env {
            cmd.env(k, v);
        }

        // 继承 PATH 等基本环境
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        }
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn MCP server '{}': {}", config.id, e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to capture MCP server stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture MCP server stdout")?;

        // 后台转发 stderr 到 tracing
        if let Some(stderr) = child.stderr.take() {
            let server_id = config.id.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        tracing::debug!(server = %server_id, "[MCP stderr] {}", trimmed);
                    }
                    line.clear();
                }
            });
        }

        Ok(Self {
            child,
            stdin: BufWriter::new(stdin),
            stdout: BufReader::new(stdout),
            next_id: AtomicU64::new(1),
        })
    }

    /// 发送 JSON-RPC 请求并等待**匹配 id** 的响应
    ///
    /// 跳过 server 推送的 notification（无 id）以及 id 不匹配的消息，
    /// 避免把通知或乱序行当成工具结果。
    pub async fn send_request(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = JsonRpcRequest::new(id, method, params);

        // 序列化 + 换行
        let mut payload =
            serde_json::to_string(&request).map_err(|e| format!("JSON serialize error: {}", e))?;
        payload.push('\n');

        // 写入 stdin
        self.stdin
            .write_all(payload.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to MCP server: {}", e))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush MCP stdin: {}", e))?;

        // 在总超时内读到匹配 id 的响应
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err(format!("MCP server timeout (30s) for method '{}'", method));
            }

            let mut line = String::new();
            let read_result =
                tokio::time::timeout(remaining, self.read_response_line(&mut line)).await;
            match read_result {
                Err(_) => {
                    return Err(format!("MCP server timeout (30s) for method '{}'", method));
                }
                Ok(Err(e)) => return Err(e),
                Ok(Ok(())) => {}
            }

            let trimmed = line.trim();
            let value: Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(e) => {
                    tracing::debug!(
                        "[MCP] skip non-JSON line: {} | raw: {}",
                        e,
                        &trimmed[..trimmed.len().min(120)]
                    );
                    continue;
                }
            };

            // Notification: has method, no result/error pair as response — skip
            if value.get("method").is_some()
                && value.get("result").is_none()
                && value.get("error").is_none()
            {
                tracing::debug!(
                    method = %value.get("method").and_then(|m| m.as_str()).unwrap_or("?"),
                    "[MCP] skip server notification while waiting for response"
                );
                continue;
            }

            // Match request id (number or string form of number)
            let resp_id = match value.get("id") {
                Some(Value::Number(n)) => n.as_u64(),
                Some(Value::String(s)) => s.parse::<u64>().ok(),
                _ => None,
            };
            if resp_id != Some(id) {
                tracing::debug!(
                    expected = id,
                    got = ?resp_id,
                    "[MCP] skip response with mismatched id"
                );
                continue;
            }

            let response: JsonRpcResponse = serde_json::from_value(value).map_err(|e| {
                format!(
                    "Invalid JSON-RPC response: {} | raw: {}",
                    e,
                    &trimmed[..trimmed.len().min(200)]
                )
            })?;

            if let Some(err) = response.error {
                return Err(format!("MCP error ({}): {}", err.code, err.message));
            }

            return response
                .result
                .ok_or_else(|| "MCP response has no result".to_string());
        }
    }

    /// 发送 JSON-RPC 通知（无 id，不期望响应）
    pub async fn send_notification(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        // 通知没有 id 字段
        let mut map = HashMap::new();
        map.insert("jsonrpc", Value::String("2.0".to_string()));
        map.insert("method", Value::String(method.to_string()));
        if let Some(p) = params {
            map.insert("params", p);
        }

        let mut payload =
            serde_json::to_string(&map).map_err(|e| format!("JSON serialize error: {}", e))?;
        payload.push('\n');

        self.stdin
            .write_all(payload.as_bytes())
            .await
            .map_err(|e| format!("Failed to write notification: {}", e))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("Flush error: {}", e))?;

        Ok(())
    }

    /// 从 stdout 读取一行 JSON 对象（跳过空行与非 JSON 前缀）
    async fn read_response_line(&mut self, buf: &mut String) -> Result<(), String> {
        loop {
            buf.clear();
            let bytes_read = self
                .stdout
                .read_line(buf)
                .await
                .map_err(|e| format!("Failed to read from MCP server: {}", e))?;

            if bytes_read == 0 {
                return Err("MCP server closed stdout (process exited)".to_string());
            }

            let trimmed = buf.trim();
            if trimmed.is_empty() {
                continue;
            }

            // 确保是 JSON 对象
            if trimmed.starts_with('{') {
                return Ok(());
            }

            // 非 JSON 行（可能是服务器启动消息），跳过
            tracing::debug!("[MCP stdout skip] {}", &trimmed[..trimmed.len().min(100)]);
        }
    }

    /// 检查子进程是否存活
    pub fn is_alive(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(None) => true,     // 仍在运行
            Ok(Some(_)) => false, // 已退出
            Err(_) => false,
        }
    }

    /// 优雅关闭
    pub async fn shutdown(&mut self) {
        // 尝试发送 shutdown 通知
        let _ = self
            .send_notification("notifications/cancelled", None)
            .await;
        // 等待 2 秒后强制 kill
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), self.child.wait()).await;
        let _ = self.child.kill().await;
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        // 尽力 kill — 非 async，不能等待
        let _ = self.child.start_kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_id_matches_number_and_string() {
        let id = 3u64;
        let num = serde_json::json!({"jsonrpc":"2.0","id":3,"result":{}});
        let s = serde_json::json!({"jsonrpc":"2.0","id":"3","result":{}});
        let wrong = serde_json::json!({"jsonrpc":"2.0","id":4,"result":{}});
        let notif = serde_json::json!({"jsonrpc":"2.0","method":"notifications/progress"});

        let extract = |v: &Value| match v.get("id") {
            Some(Value::Number(n)) => n.as_u64(),
            Some(Value::String(s)) => s.parse::<u64>().ok(),
            _ => None,
        };
        assert_eq!(extract(&num), Some(id));
        assert_eq!(extract(&s), Some(id));
        assert_ne!(extract(&wrong), Some(id));
        assert!(notif.get("method").is_some() && notif.get("result").is_none());
    }
}
