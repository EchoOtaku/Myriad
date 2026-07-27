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

/// 允许透传给 MCP 子进程的环境变量。
///
/// 只放"进程要跑起来"必需的东西。任何凭据类变量都不在这里 ——
/// server 自己需要的密钥由 `mcp_servers.json` 的 `env` 显式声明，
/// 这样每个 server 拿到什么是可审计的，而不是默认继承一切。
const ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TZ",
    "LANG",
    "LC_ALL",
    "TERM",
    // Node/Python 运行时定位自身依赖所需
    "NODE_PATH",
    "NVM_DIR",
    "PYTHONPATH",
    "PYTHONHOME",
    // 代理设置：MCP server 常需联网，且这些不是凭据
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    // TLS / 企业自签 CA：路径指向证书束，不是密钥。
    // 缺了这些时 Node/Python/curl 在企业代理环境会 TLS handshake 失败。
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "AWS_CA_BUNDLE",
    // Windows 上进程创建的基本要求
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "COMSPEC",
    "PATHEXT",
    "APPDATA",
    "LOCALAPPDATA",
    "USERPROFILE",
];

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

        // ⚠️ env_clear 必须在任何 cmd.env() 之前。
        //
        // Command 默认**继承父进程的整个环境**。之前这里只是"再设一遍"
        // PATH/HOME，看着像白名单，实际上每个 MCP server 子进程都拿到了
        // JWT_SECRET、DATABASE_URL（含 POSTGRES_PASSWORD）、
        // UPDATER_GATEWAY_SECRET —— 一个 `cat /proc/self/environ` 全都有。
        //
        // MCP server 是第三方代码（npx 拉取的包、社区实现），不该看到宿主凭据。
        cmd.env_clear();

        // 显式白名单：只给运行时真正需要的变量。
        for key in ENV_ALLOWLIST {
            if let Ok(value) = std::env::var(key) {
                cmd.env(key, value);
            }
        }

        // 该 server 在配置里声明的环境变量（它自己的 API key 等）。
        // 放在白名单之后，允许显式覆盖 PATH 这类值。
        for (k, v) in &config.env {
            cmd.env(k, v);
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

    /// MCP server 是第三方代码。这条断言锁住"宿主凭据不进子进程环境"。
    ///
    /// 修复前 `Command` 默认继承整个父环境，这些变量全都泄给了每个 MCP server。
    #[test]
    fn env_allowlist_excludes_host_credentials() {
        for leaked in [
            "JWT_SECRET",
            "DATABASE_URL",
            "POSTGRES_PASSWORD",
            "UPDATER_GATEWAY_SECRET",
            "UPDATE_TOKEN",
            "MYRIAD_DATA_KEY",
            "OAUTH_STATE_SECRET",
        ] {
            assert!(
                !ENV_ALLOWLIST.contains(&leaked),
                "{leaked} must never be inherited by MCP subprocesses"
            );
        }
    }

    #[test]
    fn env_allowlist_keeps_what_runtimes_need() {
        for needed in [
            "PATH",
            "HOME",
            "NODE_PATH",
            "HTTPS_PROXY",
            "SSL_CERT_FILE",
            "NODE_EXTRA_CA_CERTS",
            "REQUESTS_CA_BUNDLE",
        ] {
            assert!(
                ENV_ALLOWLIST.contains(&needed),
                "{needed} should pass through"
            );
        }
    }

    /// 白名单本身不能出现凭据形状的名字 —— 防止将来有人顺手往里加。
    ///
    /// 证书*路径*（`*_CA_*` / `SSL_CERT_*`）允许：它们是文件系统路径，不是密钥。
    #[test]
    fn env_allowlist_has_no_credential_shaped_names() {
        for name in ENV_ALLOWLIST {
            let lower = name.to_ascii_lowercase();
            let is_cert_path = lower.contains("ssl_cert")
                || lower.contains("ca_bundle")
                || lower.contains("ca_certs")
                || lower.contains("extra_ca");
            if is_cert_path {
                continue;
            }
            assert!(
                !(lower.contains("secret")
                    || lower.contains("token")
                    || lower.contains("password")
                    || lower.contains("api_key")),
                "{name} looks like a credential; it must not be allowlisted"
            );
        }
    }
}
