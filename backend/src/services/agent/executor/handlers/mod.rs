//! 能力执行处理器
//!
//! 按能力类别分发执行逻辑

mod data_read;
mod data_write;
mod ai_process;
mod resource_create;
mod ui_control;
mod external;
mod system_op;

use crate::services::agent::types::*;
use crate::services::analyzer::AiAnalyzer;
use sea_orm::DatabaseConnection;
use serde_json::Value;
use std::collections::HashMap;

/// Handler 执行上下文
#[allow(dead_code)]
pub struct HandlerContext<'a> {
    pub db: &'a DatabaseConnection,
    pub ai_analyzer: Option<&'a AiAnalyzer>,
    pub user_id: i32,
    /// 执行上下文快照（包含对话历史、角色身份等）
    pub execution_context: Option<ExecutionContext>,
}

impl<'a> HandlerContext<'a> {
    /// 获取对话历史的格式化字符串
    /// 用于非 AI 类 handler 需要对话上下文时
    #[allow(dead_code)]
    pub fn get_conversation_context_prompt(&self) -> Option<String> {
        self.execution_context
            .as_ref()
            .and_then(|ctx| ctx.conversation_context.as_ref())
            .filter(|history| !history.is_empty())
            .map(|history| {
                let messages: Vec<String> = history
                    .iter()
                    .map(|msg| format!("[{}]: {}", msg.role, msg.content))
                    .collect();
                format!(
                    "\n\n=== 之前的对话历史 ===\n{}\n=== 对话历史结束 ===\n\n请参考上述对话历史来理解用户的当前请求。",
                    messages.join("\n")
                )
            })
    }
}

/// 根据能力类别分发执行
pub async fn execute_capability(
    capability_id: &str,
    action: &str,
    category: &CapabilityCategory,
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    match category {
        CapabilityCategory::DataRead => {
            data_read::execute(capability_id, params, ctx).await
        }
        CapabilityCategory::DataWrite => {
            data_write::execute(capability_id, params, ctx).await
        }
        CapabilityCategory::AiProcess => {
            ai_process::execute(capability_id, action, params, ctx).await
        }
        CapabilityCategory::ResourceCreate => {
            resource_create::execute(capability_id, params, ctx).await
        }
        CapabilityCategory::SystemOp => {
            system_op::execute(capability_id, params, ctx).await
        }
        CapabilityCategory::ExternalIntegration => {
            external::execute(capability_id, params, ctx).await
        }
        CapabilityCategory::UiControl => {
            ui_control::execute(capability_id, params, ctx).await
        }
    }
}
