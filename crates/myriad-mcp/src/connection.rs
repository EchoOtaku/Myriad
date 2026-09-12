//! Host runtime policy is separate from editable third-party server definitions.
use crate::{
    config::{McpServerConfig, McpServersConfig, McpTransport},
    http::{GatewayConnection, HttpTransport},
    transport::StdioTransport,
};
use serde_json::Value;

#[derive(Clone, Default)]
pub struct RuntimeOptions {
    pub allow_stdio: bool,
    pub gateway: Option<GatewayConnection>,
}
impl RuntimeOptions {
    pub fn allows(&self, transport: McpTransport) -> bool {
        match transport {
            McpTransport::Stdio => self.allow_stdio,
            McpTransport::Gateway => self.gateway.is_some(),
        }
    }
    /// Explicit opt-in for local development. Production hosts must not use this.
    pub fn development() -> Self {
        Self {
            allow_stdio: true,
            gateway: None,
        }
    }
    pub fn validate(&self, config: &McpServersConfig) -> Result<(), String> {
        for server in config.servers.iter().filter(|s| s.enabled) {
            match server.transport {
                McpTransport::Stdio if !self.allow_stdio => {
                    return Err(
                        "Local MCP processes are disabled by host policy; use the isolated gateway"
                            .into(),
                    )
                }
                McpTransport::Gateway if self.gateway.is_none() => {
                    return Err("MCP gateway is not configured by the host".into())
                }
                _ => {}
            }
        }
        Ok(())
    }
}

pub(crate) enum Transport {
    Stdio(Box<StdioTransport>),
    Gateway(HttpTransport),
}
impl Transport {
    pub async fn open(config: &McpServerConfig, options: &RuntimeOptions) -> Result<Self, String> {
        match config.transport {
            McpTransport::Stdio if options.allow_stdio => {
                Ok(Self::Stdio(Box::new(StdioTransport::spawn(config).await?)))
            }
            McpTransport::Stdio => Err("Local MCP processes are disabled by host policy".into()),
            McpTransport::Gateway => Ok(Self::Gateway(HttpTransport::new(
                options
                    .gateway
                    .clone()
                    .ok_or("MCP gateway is not configured by the host")?,
            ))),
        }
    }
    pub fn protocol_version(&self) -> &'static str {
        match self {
            Self::Stdio(_) => "2024-11-05",
            Self::Gateway(_) => crate::http::PROTOCOL_VERSION,
        }
    }
    pub fn set_protocol(&mut self, protocol: &str) -> Result<(), String> {
        match self {
            Self::Stdio(_) => Ok(()),
            Self::Gateway(t) => t.set_protocol(protocol),
        }
    }
    pub async fn send_request(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        match self {
            Self::Stdio(t) => t.send_request(method, params).await,
            Self::Gateway(t) => t.send_request(method, params).await,
        }
    }
    pub async fn send_notification(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        match self {
            Self::Stdio(t) => t.send_notification(method, params).await,
            Self::Gateway(t) => t.send_notification(method, params).await,
        }
    }
    pub fn is_alive(&mut self) -> bool {
        match self {
            Self::Stdio(t) => t.is_alive(),
            Self::Gateway(t) => t.is_alive(),
        }
    }
    pub async fn revoke(&mut self) {
        match self {
            Self::Stdio(t) => t.terminate_and_reap().await,
            Self::Gateway(t) => t.close().await,
        }
    }
    pub async fn shutdown(&mut self) {
        match self {
            Self::Stdio(t) => t.shutdown().await,
            Self::Gateway(t) => t.shutdown().await,
        }
    }
}
