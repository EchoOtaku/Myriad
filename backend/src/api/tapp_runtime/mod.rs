//! Tapp API - 第三方应用集成接口
//!
//! 模块结构：
//! - common:      共享基础（缓存、安全、权限、指标）
//! - platform:    平台数据读写 API
//! - ai:          AI 生成/分析/对话/图片 API
//! - reports:     报告 CRUD API
//! - data:        数据转换处理 API
//! - context:     运行上下文 API
//! - media:       媒体控制 API
//! - components:  组件注册 API
//! - shortcuts:   快捷键注册 API
//! - events:      事件总线 API
//! - metrics:     性能指标 API
//! - declared_api: Tapp API 声明系统

pub mod common;
mod platform;
mod ai;
mod reports;
mod data;
mod context;
mod media;
mod components;
mod shortcuts;
mod events;
mod metrics;
mod declared_api;

// ============ 公开 re-export（保持 api::tapp::* 路径兼容） ============

// Platform API
pub use platform::{
    get_platform_data, get_platform_stats, get_platform_distribution,
    add_platform_item, add_platform_items_batch,
};

// AI API
pub use ai::{ai_generate, ai_analyze, ai_chat, ai_image_generate, ai_image_task_status};

// Reports API
pub use reports::{
    list_reports, create_report, list_tapp_reports,
    get_tapp_report, update_tapp_report, delete_tapp_report,
};

// Data API
pub use data::data_transform;

// Context API
pub use context::{
    get_context_app, get_context_user, get_context_player,
    get_context_navigation, get_context_system, get_context_geo,
};

// Media API
pub use media::{media_control, media_status};

// Components API
pub use components::{
    register_component, unregister_component,
    list_components, list_all_components_by_type,
};

// Shortcuts API
pub use shortcuts::{register_shortcut, unregister_shortcut, list_shortcuts};

// Events API
pub use events::{publish_event, get_event_subscriptions, update_event_subscriptions};

// Metrics API
pub use metrics::{get_tapp_metrics, reset_tapp_metrics, get_rate_limit_status};

// Declared API System
pub use declared_api::{execute_tapp_api, list_tapp_apis, invalidate_tapp_apis_cache};
