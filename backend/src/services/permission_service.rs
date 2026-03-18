//! Tapp 权限下放服务
//!
//! 基于 Tapp 系统的权限等级（PermissionLevel）管理权限下放。
//!
//! ## 权限层级（来自 Tapp 系统）
//! - **public**: 无需权限，所有人可用
//! - **basic**: 基础权限，默认所有用户（包括游客）可用
//! - **elevated**: 提升权限，默认仅管理员，可配置下放
//! - **privileged**: 特权权限，始终仅管理员可用
//!
//! ## 设计原则
//! - basic 级别权限（10个）默认对所有用户开放，无需配置
//! - elevated 级别权限（9个）可由管理员选择性下放给普通用户或游客
//! - privileged 级别权限（3个）始终仅限管理员
//!
//! ## Tapp 权限完整列表（22个）
//!
//! ### Basic（10个）- 默认开放
//! - widget:register, platform:read, report:read, storage
//! - ui:notification, ui:fullscreen, ui:theme, ui:confirm
//! - media:read, event:subscribe
//!
//! ### Elevated（9个）- 可配置下放
//! - ai:generate, ai:analyze, ai:chat
//! - report:write
//! - network:fetch
//! - media:control
//! - component:theme
//! - shortcut:register
//! - event:publish
//!
//! ### Privileged（3个）- 仅管理员
//! - platform:write, platform:register, component:agent

use crate::config::DynamicConfig;
use serde::{Deserialize, Serialize};

/// 用户角色
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Admin,
    User,
    Guest,
}

impl UserRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserRole::Admin => "admin",
            UserRole::User => "user",
            UserRole::Guest => "guest",
        }
    }
}

impl From<&str> for UserRole {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "admin" => UserRole::Admin,
            "user" => UserRole::User,
            _ => UserRole::Guest,
        }
    }
}

/// Tapp 权限（与前端 TappPermission 类型对应）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TappPermission {
    // Basic 级别（10个）
    #[serde(rename = "widget:register")]
    WidgetRegister,
    #[serde(rename = "platform:read")]
    PlatformRead,
    #[serde(rename = "tappList:read")]
    TappListRead,
    #[serde(rename = "brew:read")]
    BrewRead,
    #[serde(rename = "report:read")]
    ReportRead,
    #[serde(rename = "storage")]
    Storage,
    #[serde(rename = "ui:notification")]
    UiNotification,
    #[serde(rename = "ui:fullscreen")]
    UiFullscreen,
    #[serde(rename = "ui:theme")]
    UiTheme,
    #[serde(rename = "ui:confirm")]
    UiConfirm,
    #[serde(rename = "media:read")]
    MediaRead,
    #[serde(rename = "event:subscribe")]
    EventSubscribe,

    // Elevated 级别（10个）
    #[serde(rename = "ai:generate")]
    AiGenerate,
    #[serde(rename = "ai:analyze")]
    AiAnalyze,
    #[serde(rename = "ai:chat")]
    AiChat,
    #[serde(rename = "ai:image")]
    AiImage,
    #[serde(rename = "report:write")]
    ReportWrite,
    #[serde(rename = "brew:write")]
    BrewWrite,
    #[serde(rename = "brew:comment")]
    BrewComment,
    #[serde(rename = "network:fetch")]
    NetworkFetch,
    #[serde(rename = "media:control")]
    MediaControl,
    #[serde(rename = "component:theme")]
    ComponentTheme,
    #[serde(rename = "shortcut:register")]
    ShortcutRegister,
    #[serde(rename = "event:publish")]
    EventPublish,
    #[serde(rename = "scheduler:register")]
    SchedulerRegister,
    #[serde(rename = "speech:tts")]
    SpeechTts,
    #[serde(rename = "speech:asr")]
    SpeechAsr,

    // Privileged 级别（3个）
    #[serde(rename = "platform:write")]
    PlatformWrite,
    #[serde(rename = "platform:register")]
    PlatformRegister,
    #[serde(rename = "component:agent")]
    ComponentAgent,
    #[serde(rename = "tappList:manage")]
    TappListManage,
    #[serde(rename = "brew:manage")]
    BrewManage,
}

impl TappPermission {
    /// 获取权限等级
    pub fn level(&self) -> PermissionLevel {
        match self {
            // Basic
            TappPermission::WidgetRegister
            | TappPermission::PlatformRead
            | TappPermission::TappListRead
            | TappPermission::BrewRead
            | TappPermission::ReportRead
            | TappPermission::Storage
            | TappPermission::UiNotification
            | TappPermission::UiFullscreen
            | TappPermission::UiTheme
            | TappPermission::UiConfirm
            | TappPermission::MediaRead
            | TappPermission::EventSubscribe => PermissionLevel::Basic,

            // Elevated
            TappPermission::AiGenerate
            | TappPermission::AiAnalyze
            | TappPermission::AiChat
            | TappPermission::AiImage
            | TappPermission::ReportWrite
            | TappPermission::BrewWrite
            | TappPermission::BrewComment
            | TappPermission::NetworkFetch
            | TappPermission::MediaControl
            | TappPermission::ComponentTheme
            | TappPermission::ShortcutRegister
            | TappPermission::EventPublish
            | TappPermission::SchedulerRegister
            | TappPermission::SpeechTts
            | TappPermission::SpeechAsr => PermissionLevel::Elevated,

            // Privileged
            TappPermission::PlatformWrite
            | TappPermission::PlatformRegister
            | TappPermission::ComponentAgent
            | TappPermission::TappListManage
            | TappPermission::BrewManage => PermissionLevel::Privileged,
        }
    }

    /// 获取权限的显示名称
    #[allow(dead_code)]
    pub fn display_name(&self) -> &'static str {
        match self {
            TappPermission::WidgetRegister => "注册小组件",
            TappPermission::PlatformRead => "读取平台数据",
            TappPermission::TappListRead => "读取 Tapp 列表",
            TappPermission::BrewRead => "读取 Brew 内容",
            TappPermission::PlatformWrite => "写入平台数据",
            TappPermission::PlatformRegister => "注册新平台",
            TappPermission::AiGenerate => "AI 生成",
            TappPermission::AiAnalyze => "AI 分析",
            TappPermission::AiChat => "AI 对话",
            TappPermission::AiImage => "AI 图片生成",
            TappPermission::ReportRead => "读取报告",
            TappPermission::ReportWrite => "生成报告",
            TappPermission::BrewWrite => "编辑 Brew 内容",
            TappPermission::BrewComment => "Brew 评论",
            TappPermission::Storage => "本地存储",
            TappPermission::UiNotification => "显示通知",
            TappPermission::UiFullscreen => "全屏模式",
            TappPermission::UiTheme => "主题访问",
            TappPermission::UiConfirm => "确认对话框",
            TappPermission::NetworkFetch => "网络请求",
            TappPermission::MediaControl => "媒体控制",
            TappPermission::MediaRead => "读取媒体",
            TappPermission::ComponentTheme => "注册主题",
            TappPermission::ComponentAgent => "注册 Agent",
            TappPermission::TappListManage => "管理 Tapp",
            TappPermission::BrewManage => "管理 Brew",
            TappPermission::ShortcutRegister => "注册快捷键",
            TappPermission::EventPublish => "发布事件",
            TappPermission::SchedulerRegister => "注册定时任务",
            TappPermission::EventSubscribe => "订阅事件",
            TappPermission::SpeechTts => "文本转语音",
            TappPermission::SpeechAsr => "语音转文本",
        }
    }

    /// 获取所有 elevated 级别权限 (10个)
    pub fn all_elevated() -> Vec<TappPermission> {
        vec![
            TappPermission::AiGenerate,
            TappPermission::AiAnalyze,
            TappPermission::AiChat,
            TappPermission::AiImage,
            TappPermission::ReportWrite,
            TappPermission::NetworkFetch,
            TappPermission::MediaControl,
            TappPermission::ComponentTheme,
            TappPermission::ShortcutRegister,
            TappPermission::EventPublish,
            TappPermission::SchedulerRegister,
            TappPermission::SpeechTts,
            TappPermission::SpeechAsr,
        ]
    }

    /// 从字符串解析权限
    pub fn from_str(s: &str) -> Option<TappPermission> {
        match s {
            "widget:register" => Some(TappPermission::WidgetRegister),
            "platform:read" => Some(TappPermission::PlatformRead),
            "tappList:read" => Some(TappPermission::TappListRead),
            "brew:read" => Some(TappPermission::BrewRead),
            "platform:write" => Some(TappPermission::PlatformWrite),
            "platform:register" => Some(TappPermission::PlatformRegister),
            "report:read" => Some(TappPermission::ReportRead),
            "report:write" => Some(TappPermission::ReportWrite),
            "brew:write" => Some(TappPermission::BrewWrite),
            "brew:comment" => Some(TappPermission::BrewComment),
            "storage" => Some(TappPermission::Storage),
            "ui:notification" => Some(TappPermission::UiNotification),
            "ui:fullscreen" => Some(TappPermission::UiFullscreen),
            "ui:theme" => Some(TappPermission::UiTheme),
            "ui:confirm" => Some(TappPermission::UiConfirm),
            "ai:generate" => Some(TappPermission::AiGenerate),
            "ai:analyze" => Some(TappPermission::AiAnalyze),
            "ai:chat" => Some(TappPermission::AiChat),
            "ai:image" => Some(TappPermission::AiImage),
            "network:fetch" => Some(TappPermission::NetworkFetch),
            "media:control" => Some(TappPermission::MediaControl),
            "media:read" => Some(TappPermission::MediaRead),
            "component:theme" => Some(TappPermission::ComponentTheme),
            "component:agent" => Some(TappPermission::ComponentAgent),
            "tappList:manage" => Some(TappPermission::TappListManage),
            "brew:manage" => Some(TappPermission::BrewManage),
            "shortcut:register" => Some(TappPermission::ShortcutRegister),
            "event:publish" => Some(TappPermission::EventPublish),
            "event:subscribe" => Some(TappPermission::EventSubscribe),
            "scheduler:register" => Some(TappPermission::SchedulerRegister),
            "speech:tts" => Some(TappPermission::SpeechTts),
            "speech:asr" => Some(TappPermission::SpeechAsr),
            _ => None,
        }
    }

    /// 转换为字符串
    #[allow(dead_code)]
    pub fn as_str(&self) -> &'static str {
        match self {
            TappPermission::WidgetRegister => "widget:register",
            TappPermission::PlatformRead => "platform:read",
            TappPermission::TappListRead => "tappList:read",
            TappPermission::BrewRead => "brew:read",
            TappPermission::PlatformWrite => "platform:write",
            TappPermission::PlatformRegister => "platform:register",
            TappPermission::ReportRead => "report:read",
            TappPermission::ReportWrite => "report:write",
            TappPermission::BrewWrite => "brew:write",
            TappPermission::BrewComment => "brew:comment",
            TappPermission::Storage => "storage",
            TappPermission::UiNotification => "ui:notification",
            TappPermission::UiFullscreen => "ui:fullscreen",
            TappPermission::UiTheme => "ui:theme",
            TappPermission::UiConfirm => "ui:confirm",
            TappPermission::AiGenerate => "ai:generate",
            TappPermission::AiAnalyze => "ai:analyze",
            TappPermission::AiChat => "ai:chat",
            TappPermission::AiImage => "ai:image",
            TappPermission::NetworkFetch => "network:fetch",
            TappPermission::MediaControl => "media:control",
            TappPermission::MediaRead => "media:read",
            TappPermission::ComponentTheme => "component:theme",
            TappPermission::ComponentAgent => "component:agent",
            TappPermission::TappListManage => "tappList:manage",
            TappPermission::BrewManage => "brew:manage",
            TappPermission::ShortcutRegister => "shortcut:register",
            TappPermission::EventPublish => "event:publish",
            TappPermission::EventSubscribe => "event:subscribe",
            TappPermission::SchedulerRegister => "scheduler:register",
            TappPermission::SpeechTts => "speech:tts",
            TappPermission::SpeechAsr => "speech:asr",
        }
    }
}

/// 权限等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionLevel {
    Public,
    Basic,
    Elevated,
    Privileged,
}

/// Tapp 权限检查服务
pub struct TappPermissionService;

impl TappPermissionService {
    /// 检查用户是否拥有特定 Tapp 权限
    pub fn check(config: &DynamicConfig, role: UserRole, permission: TappPermission) -> bool {
        // 管理员拥有所有权限
        if role == UserRole::Admin {
            return true;
        }

        match permission.level() {
            PermissionLevel::Public => true,
            PermissionLevel::Basic => true, // 所有用户都有 basic 权限
            PermissionLevel::Elevated => Self::check_elevated(config, role, permission),
            PermissionLevel::Privileged => false, // 仅管理员
        }
    }

    /// 检查 elevated 级别权限
    fn check_elevated(config: &DynamicConfig, role: UserRole, permission: TappPermission) -> bool {
        match role {
            UserRole::Admin => true,
            UserRole::User => Self::check_user_elevated(config, permission),
            UserRole::Guest => Self::check_guest_elevated(config, permission),
        }
    }

    /// 检查普通用户的 elevated 权限
    fn check_user_elevated(config: &DynamicConfig, permission: TappPermission) -> bool {
        match permission {
            TappPermission::AiGenerate => config.user_perm_ai_generate,
            TappPermission::AiAnalyze => config.user_perm_ai_analyze,
            TappPermission::AiChat => config.user_perm_ai_chat,
            TappPermission::AiImage => config.user_perm_ai_image,
            TappPermission::ReportWrite => config.user_perm_report_write,
            TappPermission::NetworkFetch => config.user_perm_network_fetch,
            TappPermission::MediaControl => config.user_perm_media_control,
            TappPermission::ComponentTheme => config.user_perm_component_theme,
            TappPermission::ShortcutRegister => config.user_perm_shortcut_register,
            TappPermission::EventPublish => config.user_perm_event_publish,
            TappPermission::SchedulerRegister => config.user_perm_scheduler_register,
            TappPermission::SpeechTts => config.user_perm_speech_tts,
            TappPermission::SpeechAsr => config.user_perm_speech_asr,
            _ => false,
        }
    }

    /// 检查游客的 elevated 权限
    fn check_guest_elevated(config: &DynamicConfig, permission: TappPermission) -> bool {
        match permission {
            TappPermission::AiGenerate => config.guest_perm_ai_generate,
            TappPermission::AiAnalyze => config.guest_perm_ai_analyze,
            TappPermission::AiChat => config.guest_perm_ai_chat,
            TappPermission::AiImage => config.guest_perm_ai_image,
            TappPermission::ReportWrite => config.guest_perm_report_write,
            TappPermission::NetworkFetch => config.guest_perm_network_fetch,
            TappPermission::MediaControl => config.guest_perm_media_control,
            TappPermission::ComponentTheme => config.guest_perm_component_theme,
            TappPermission::ShortcutRegister => config.guest_perm_shortcut_register,
            TappPermission::EventPublish => config.guest_perm_event_publish,
            TappPermission::SchedulerRegister => config.guest_perm_scheduler_register,
            TappPermission::SpeechTts => config.guest_perm_speech_tts,
            TappPermission::SpeechAsr => config.guest_perm_speech_asr,
            _ => false,
        }
    }

    /// 获取用户可用的权限等级列表
    pub fn get_allowed_levels(config: &DynamicConfig, role: UserRole) -> Vec<PermissionLevel> {
        match role {
            UserRole::Admin => vec![
                PermissionLevel::Public,
                PermissionLevel::Basic,
                PermissionLevel::Elevated,
                PermissionLevel::Privileged,
            ],
            UserRole::User | UserRole::Guest => {
                let mut levels = vec![PermissionLevel::Public, PermissionLevel::Basic];
                // 如果有任何 elevated 权限被授予，添加 elevated 级别
                let has_elevated = TappPermission::all_elevated()
                    .into_iter()
                    .any(|p| Self::check(config, role, p));
                if has_elevated {
                    levels.push(PermissionLevel::Elevated);
                }
                levels
            }
        }
    }

    /// 获取权限配置摘要
    pub fn get_permission_config(config: &DynamicConfig) -> TappPermissionConfig {
        TappPermissionConfig {
            user: ElevatedPermissions {
                ai_generate: config.user_perm_ai_generate,
                ai_analyze: config.user_perm_ai_analyze,
                ai_chat: config.user_perm_ai_chat,
                ai_image: config.user_perm_ai_image,
                report_write: config.user_perm_report_write,
                network_fetch: config.user_perm_network_fetch,
                media_control: config.user_perm_media_control,
                component_theme: config.user_perm_component_theme,
                shortcut_register: config.user_perm_shortcut_register,
                event_publish: config.user_perm_event_publish,
                scheduler_register: config.user_perm_scheduler_register,
                speech_tts: config.user_perm_speech_tts,
                speech_asr: config.user_perm_speech_asr,
            },
            guest: ElevatedPermissions {
                ai_generate: config.guest_perm_ai_generate,
                ai_analyze: config.guest_perm_ai_analyze,
                ai_chat: config.guest_perm_ai_chat,
                ai_image: config.guest_perm_ai_image,
                report_write: config.guest_perm_report_write,
                network_fetch: config.guest_perm_network_fetch,
                media_control: config.guest_perm_media_control,
                component_theme: config.guest_perm_component_theme,
                shortcut_register: config.guest_perm_shortcut_register,
                event_publish: config.guest_perm_event_publish,
                scheduler_register: config.guest_perm_scheduler_register,
                speech_tts: config.guest_perm_speech_tts,
                speech_asr: config.guest_perm_speech_asr,
            },
            user_ai_quota: AiQuotaConfig {
                daily_calls: config.user_ai_daily_calls,
                daily_tokens: config.user_ai_daily_tokens,
                cooldown_seconds: config.user_ai_cooldown_seconds,
            },
            guest_ai_quota: AiQuotaConfig {
                daily_calls: config.guest_ai_daily_calls,
                daily_tokens: config.guest_ai_daily_tokens,
                cooldown_seconds: config.guest_ai_cooldown_seconds,
            },
        }
    }
}

/// Tapp 权限配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TappPermissionConfig {
    pub user: ElevatedPermissions,
    pub guest: ElevatedPermissions,
    /// 普通用户 AI 使用限额配置
    pub user_ai_quota: AiQuotaConfig,
    /// 游客 AI 使用限额配置
    pub guest_ai_quota: AiQuotaConfig,
}

/// AI 限额配置（用于设置界面）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiQuotaConfig {
    /// 每日 AI 调用次数限制
    pub daily_calls: i32,
    /// 每日 AI Token 限制
    pub daily_tokens: i32,
    /// AI 调用冷却时间（秒）
    pub cooldown_seconds: i32,
}

/// Elevated 级别权限配置（11个权限，platform:write 和 platform:register 已升为 privileged）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElevatedPermissions {
    pub ai_generate: bool,
    pub ai_analyze: bool,
    pub ai_chat: bool,
    pub ai_image: bool,
    pub report_write: bool,
    pub network_fetch: bool,
    pub media_control: bool,
    pub component_theme: bool,
    pub shortcut_register: bool,
    pub event_publish: bool,
    pub scheduler_register: bool,
    pub speech_tts: bool,
    pub speech_asr: bool,
}

/// AI 使用限额配置（根据用户角色返回不同的限额）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct AiQuotaLimits {
    /// 每日 AI 调用次数限制（所有 AI 权限共享）
    pub daily_calls: i32,
    /// 每日 AI Token 限制
    pub daily_tokens: i32,
    /// AI 调用冷却时间（秒）
    pub cooldown_seconds: i32,
    /// 是否无限制（管理员）
    pub unlimited: bool,
}

impl TappPermissionService {
    /// 获取用户的 AI 使用限额
    ///
    /// - 管理员：无限制
    /// - 普通用户：根据配置的限额
    /// - 游客：根据配置的限额（通常更严格）
    #[allow(dead_code)]
    pub fn get_ai_quota_limits(config: &DynamicConfig, role: UserRole) -> AiQuotaLimits {
        match role {
            UserRole::Admin => AiQuotaLimits {
                daily_calls: i32::MAX,
                daily_tokens: i32::MAX,
                cooldown_seconds: 0,
                unlimited: true,
            },
            UserRole::User => AiQuotaLimits {
                daily_calls: config.user_ai_daily_calls,
                daily_tokens: config.user_ai_daily_tokens,
                cooldown_seconds: config.user_ai_cooldown_seconds,
                unlimited: false,
            },
            UserRole::Guest => AiQuotaLimits {
                daily_calls: config.guest_ai_daily_calls,
                daily_tokens: config.guest_ai_daily_tokens,
                cooldown_seconds: config.guest_ai_cooldown_seconds,
                unlimited: false,
            },
        }
    }

    /// 检查用户是否有任何 AI 权限
    #[allow(dead_code)]
    pub fn has_any_ai_permission(config: &DynamicConfig, role: UserRole) -> bool {
        Self::check(config, role, TappPermission::AiGenerate)
            || Self::check(config, role, TappPermission::AiAnalyze)
            || Self::check(config, role, TappPermission::AiChat)
            || Self::check(config, role, TappPermission::AiImage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_admin_has_all_permissions() {
        let config = DynamicConfig::default();
        assert!(TappPermissionService::check(
            &config,
            UserRole::Admin,
            TappPermission::ComponentAgent
        ));
        assert!(TappPermissionService::check(
            &config,
            UserRole::Admin,
            TappPermission::AiGenerate
        ));
    }

    #[test]
    fn test_user_has_basic_permissions() {
        let config = DynamicConfig::default();
        assert!(TappPermissionService::check(
            &config,
            UserRole::User,
            TappPermission::PlatformRead
        ));
        assert!(TappPermissionService::check(
            &config,
            UserRole::User,
            TappPermission::Storage
        ));
    }

    #[test]
    fn test_user_no_elevated_by_default() {
        let config = DynamicConfig::default();
        assert!(!TappPermissionService::check(
            &config,
            UserRole::User,
            TappPermission::AiGenerate
        ));
        assert!(!TappPermissionService::check(
            &config,
            UserRole::User,
            TappPermission::NetworkFetch
        ));
    }

    #[test]
    fn test_configurable_elevated_permissions() {
        let config = DynamicConfig::default();

        // 默认用户没有 AI 生成权限
        assert!(!TappPermissionService::check(
            &config,
            UserRole::User,
            TappPermission::AiGenerate
        ));

        // 启用后可以
        let config_enabled = DynamicConfig {
            user_perm_ai_generate: true,
            ..Default::default()
        };
        assert!(TappPermissionService::check(
            &config_enabled,
            UserRole::User,
            TappPermission::AiGenerate
        ));
    }

    #[test]
    fn test_privileged_only_admin() {
        let config = DynamicConfig {
            user_perm_ai_generate: true, // 即使开启 elevated
            ..Default::default()
        };

        assert!(!TappPermissionService::check(
            &config,
            UserRole::User,
            TappPermission::ComponentAgent
        ));
        assert!(!TappPermissionService::check(
            &config,
            UserRole::Guest,
            TappPermission::ComponentAgent
        ));
    }
}
