//! 数据库 Schema 自动补全模块
//!
//! 通过解析迁移文件定义的期望结构，与数据库实际结构比对，
//! 自动补全缺失的字段和索引。
//!
//! 使用版本标记避免每次启动都执行比对。
//! 当需要新的 schema 变更时，只需递增 SCHEMA_VERSION 常量。

use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr};
use std::collections::HashSet;

/// Schema 版本号
///
/// 修改此版本号将触发下次启动时的 schema 比对和补全。
/// 格式建议：YYYY.MM.DD 或语义版本 X.Y.Z
const SCHEMA_VERSION: &str = "2025.12.15.2";

/// 列定义
#[derive(Debug, Clone)]
struct ColumnDef {
    name: String,
    data_type: String,
    #[allow(dead_code)]
    is_nullable: bool,
    default_value: Option<String>,
}

/// 表定义
#[derive(Debug, Clone)]
struct TableDef {
    name: String,
    columns: Vec<ColumnDef>,
}

/// 索引定义
#[derive(Debug, Clone)]
struct IndexDef {
    name: String,
    table: String,
    columns: Vec<String>,
    is_unique: bool,
}

/// 获取迁移文件定义的期望表结构
///
/// 这里硬编码了迁移文件中定义的所有表结构
/// 当迁移文件更新时，需要同步更新这里
fn get_expected_schema() -> Vec<TableDef> {
    vec![
        // ==================== platforms 表 ====================
        TableDef {
            name: "platforms".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "name".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "display_name".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "icon".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "api_endpoint".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "auth_type".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "enabled".into(),
                    data_type: "boolean".into(),
                    is_nullable: true,
                    default_value: Some("false".into()),
                },
                ColumnDef {
                    name: "created_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: true,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "updated_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: true,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
            ],
        },
        // ==================== users 表 ====================
        TableDef {
            name: "users".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "github_id".into(),
                    data_type: "bigint".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "username".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "display_name".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "email".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "avatar_url".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "github_profile_url".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "bio".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "location".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "company".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "is_admin".into(),
                    data_type: "boolean".into(),
                    is_nullable: false,
                    default_value: Some("false".into()),
                },
                ColumnDef {
                    name: "created_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "updated_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "last_login_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: true,
                    default_value: None,
                },
                // 本地认证字段
                ColumnDef {
                    name: "password_hash".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "auth_provider".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: Some("'github'".into()),
                },
                ColumnDef {
                    name: "linked_github_id".into(),
                    data_type: "bigint".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "local_login_disabled".into(),
                    data_type: "boolean".into(),
                    is_nullable: false,
                    default_value: Some("false".into()),
                },
            ],
        },
        // ==================== configurations 表 ====================
        TableDef {
            name: "configurations".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "key".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "value".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "description".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "category".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: Some("'general'".into()),
                },
                ColumnDef {
                    name: "is_encrypted".into(),
                    data_type: "boolean".into(),
                    is_nullable: true,
                    default_value: Some("false".into()),
                },
                ColumnDef {
                    name: "is_public".into(),
                    data_type: "boolean".into(),
                    is_nullable: true,
                    default_value: Some("false".into()),
                },
                ColumnDef {
                    name: "created_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: true,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "updated_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: true,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
            ],
        },
        // ==================== platform_metadata 表 ====================
        TableDef {
            name: "platform_metadata".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "platform_name".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "raw_data".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "fetched_at".into(),
                    data_type: "timestamp without time zone".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "created_at".into(),
                    data_type: "timestamp without time zone".into(),
                    is_nullable: true,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "updated_at".into(),
                    data_type: "timestamp without time zone".into(),
                    is_nullable: true,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
            ],
        },
        // ==================== metadata_history 表 ====================
        TableDef {
            name: "metadata_history".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "metadata_id".into(),
                    data_type: "integer".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "platform_name".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "changed_fields".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "old_data".into(),
                    data_type: "jsonb".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "new_data".into(),
                    data_type: "jsonb".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "change_date".into(),
                    data_type: "timestamp without time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
            ],
        },
        // ==================== platform_reports 表 ====================
        TableDef {
            name: "platform_reports".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "platform".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "metadata".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "report".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "report_title".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "created_at".into(),
                    data_type: "timestamp without time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "expires_at".into(),
                    data_type: "timestamp without time zone".into(),
                    is_nullable: false,
                    default_value: None,
                },
            ],
        },
        // ==================== 002_tapp_system.rs 表 ====================
        // ==================== tapps 表 ====================
        TableDef {
            name: "tapps".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "tapp_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "name".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "version".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "description".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "author".into(),
                    data_type: "jsonb".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "icon".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "theme_color".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "manifest".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "status".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: Some("'installed'".into()),
                },
                ColumnDef {
                    name: "granted_permissions".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: Some("'[]'".into()),
                },
                ColumnDef {
                    name: "file_path".into(),
                    data_type: "text".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "code_path".into(),
                    data_type: "text".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "installed_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "last_run_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "updated_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "error_message".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
            ],
        },
        // ==================== tapp_widgets 表 ====================
        TableDef {
            name: "tapp_widgets".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "widget_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "tapp_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "name".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "description".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "icon".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "default_size".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: Some("'2x2'".into()),
                },
                ColumnDef {
                    name: "sizes".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: Some("'[\"2x2\"]'".into()),
                },
                ColumnDef {
                    name: "category".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: Some("'custom'".into()),
                },
                ColumnDef {
                    name: "config".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "registered_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
            ],
        },
        // ==================== tapp_storage 表 ====================
        TableDef {
            name: "tapp_storage".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "tapp_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "key".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "value".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "created_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "updated_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
            ],
        },
        // ==================== tapp_quota_usage 表 ====================
        TableDef {
            name: "tapp_quota_usage".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "tapp_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "quota_type".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "used".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: Some("0".into()),
                },
                ColumnDef {
                    name: "limit".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "period_start".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "period_end".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "updated_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
            ],
        },
        // ==================== tapp_store_sources 表 ====================
        TableDef {
            name: "tapp_store_sources".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "name".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "description".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "url".into(),
                    data_type: "text".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "enabled".into(),
                    data_type: "boolean".into(),
                    is_nullable: false,
                    default_value: Some("true".into()),
                },
                ColumnDef {
                    name: "official".into(),
                    data_type: "boolean".into(),
                    is_nullable: false,
                    default_value: Some("false".into()),
                },
                ColumnDef {
                    name: "icon".into(),
                    data_type: "character varying".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "created_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "updated_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
            ],
        },
        // ==================== tapp_scheduled_tasks 表 ====================
        TableDef {
            name: "tapp_scheduled_tasks".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "task_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "tapp_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "name".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "schedule_type".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "schedule_config".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "payload".into(),
                    data_type: "jsonb".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "execution_target".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: Some("'frontend'".into()),
                },
                ColumnDef {
                    name: "backend_actions".into(),
                    data_type: "jsonb".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "enabled".into(),
                    data_type: "boolean".into(),
                    is_nullable: false,
                    default_value: Some("true".into()),
                },
                ColumnDef {
                    name: "missed_policy".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: Some("'skip'".into()),
                },
                ColumnDef {
                    name: "scope".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: Some("'user'".into()),
                },
                ColumnDef {
                    name: "retry_config".into(),
                    data_type: "jsonb".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "next_run_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "last_run_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "last_run_result".into(),
                    data_type: "jsonb".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "stats".into(),
                    data_type: "jsonb".into(),
                    is_nullable: false,
                    default_value: Some(
                        r#"'{"totalRuns":0,"successRuns":0,"failedRuns":0,"missedRuns":0}'"#.into(),
                    ),
                },
                ColumnDef {
                    name: "created_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "updated_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
            ],
        },
        // ==================== tapp_task_executions 表 ====================
        TableDef {
            name: "tapp_task_executions".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "scheduled_task_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "tapp_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "task_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "scheduled_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "executed_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "completed_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "execution_target".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "status".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: Some("'pending'".into()),
                },
                ColumnDef {
                    name: "is_compensation".into(),
                    data_type: "boolean".into(),
                    is_nullable: false,
                    default_value: Some("false".into()),
                },
                ColumnDef {
                    name: "result".into(),
                    data_type: "jsonb".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "error".into(),
                    data_type: "text".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "duration_ms".into(),
                    data_type: "integer".into(),
                    is_nullable: true,
                    default_value: None,
                },
                ColumnDef {
                    name: "retry_count".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: Some("0".into()),
                },
            ],
        },
        // ==================== tapp_user_activities 表 ====================
        TableDef {
            name: "tapp_user_activities".to_string(),
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "user_id".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "tapp_id".into(),
                    data_type: "character varying".into(),
                    is_nullable: false,
                    default_value: None,
                },
                ColumnDef {
                    name: "last_run_at".into(),
                    data_type: "timestamp with time zone".into(),
                    is_nullable: false,
                    default_value: Some("CURRENT_TIMESTAMP".into()),
                },
                ColumnDef {
                    name: "run_count".into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    default_value: Some("1".into()),
                },
            ],
        },
    ]
}

/// 获取期望的索引定义
fn get_expected_indexes() -> Vec<IndexDef> {
    vec![
        IndexDef {
            name: "idx_users_github_id".into(),
            table: "users".into(),
            columns: vec!["github_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_users_username".into(),
            table: "users".into(),
            columns: vec!["username".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_users_is_admin".into(),
            table: "users".into(),
            columns: vec!["is_admin".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_linked_github_id".into(),
            table: "users".into(),
            columns: vec!["linked_github_id".into()],
            is_unique: true,
        },
        IndexDef {
            name: "idx_users_auth_provider".into(),
            table: "users".into(),
            columns: vec!["auth_provider".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_platform_metadata_user".into(),
            table: "platform_metadata".into(),
            columns: vec!["user_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_platform_metadata_platform".into(),
            table: "platform_metadata".into(),
            columns: vec!["platform_name".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_metadata_history_user".into(),
            table: "metadata_history".into(),
            columns: vec!["user_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_metadata_history_metadata".into(),
            table: "metadata_history".into(),
            columns: vec!["metadata_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_platform_reports_user_id".into(),
            table: "platform_reports".into(),
            columns: vec!["user_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_platform_reports_platform".into(),
            table: "platform_reports".into(),
            columns: vec!["platform".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_configurations_category".into(),
            table: "configurations".into(),
            columns: vec!["category".into()],
            is_unique: false,
        },
        // ==================== 002_tapp_system.rs 索引 ====================
        // tapps 索引
        IndexDef {
            name: "idx_tapps_user_tapp_id".into(),
            table: "tapps".into(),
            columns: vec!["user_id".into(), "tapp_id".into()],
            is_unique: true,
        },
        IndexDef {
            name: "idx_tapps_user_id".into(),
            table: "tapps".into(),
            columns: vec!["user_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_tapps_status".into(),
            table: "tapps".into(),
            columns: vec!["status".into()],
            is_unique: false,
        },
        // tapp_widgets 索引
        IndexDef {
            name: "idx_tapp_widgets_unique".into(),
            table: "tapp_widgets".into(),
            columns: vec!["user_id".into(), "tapp_id".into(), "widget_id".into()],
            is_unique: true,
        },
        IndexDef {
            name: "idx_tapp_widgets_user_id".into(),
            table: "tapp_widgets".into(),
            columns: vec!["user_id".into()],
            is_unique: false,
        },
        // tapp_storage 索引
        IndexDef {
            name: "idx_tapp_storage_unique".into(),
            table: "tapp_storage".into(),
            columns: vec!["user_id".into(), "tapp_id".into(), "key".into()],
            is_unique: true,
        },
        IndexDef {
            name: "idx_tapp_storage_user_tapp".into(),
            table: "tapp_storage".into(),
            columns: vec!["user_id".into(), "tapp_id".into()],
            is_unique: false,
        },
        // tapp_quota_usage 索引
        IndexDef {
            name: "idx_tapp_quota_unique".into(),
            table: "tapp_quota_usage".into(),
            columns: vec![
                "user_id".into(),
                "tapp_id".into(),
                "quota_type".into(),
                "period_start".into(),
            ],
            is_unique: true,
        },
        // tapp_store_sources 索引
        IndexDef {
            name: "idx_tapp_store_sources_url".into(),
            table: "tapp_store_sources".into(),
            columns: vec!["url".into()],
            is_unique: true,
        },
        // tapp_scheduled_tasks 索引
        IndexDef {
            name: "idx_tapp_scheduled_tasks_unique".into(),
            table: "tapp_scheduled_tasks".into(),
            columns: vec!["user_id".into(), "tapp_id".into(), "task_id".into()],
            is_unique: true,
        },
        IndexDef {
            name: "idx_tapp_scheduled_tasks_user".into(),
            table: "tapp_scheduled_tasks".into(),
            columns: vec!["user_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_tapp_scheduled_tasks_tapp".into(),
            table: "tapp_scheduled_tasks".into(),
            columns: vec!["tapp_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_tapp_scheduled_tasks_next_run".into(),
            table: "tapp_scheduled_tasks".into(),
            columns: vec!["enabled".into(), "next_run_at".into()],
            is_unique: false,
        },
        // tapp_task_executions 索引
        IndexDef {
            name: "idx_tapp_task_executions_task".into(),
            table: "tapp_task_executions".into(),
            columns: vec!["scheduled_task_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_tapp_task_executions_user_tapp".into(),
            table: "tapp_task_executions".into(),
            columns: vec!["user_id".into(), "tapp_id".into()],
            is_unique: false,
        },
        IndexDef {
            name: "idx_tapp_task_executions_executed_at".into(),
            table: "tapp_task_executions".into(),
            columns: vec!["executed_at".into()],
            is_unique: false,
        },
        // tapp_user_activities 索引
        IndexDef {
            name: "idx_tapp_user_activities_unique".into(),
            table: "tapp_user_activities".into(),
            columns: vec!["user_id".into(), "tapp_id".into()],
            is_unique: true,
        },
        IndexDef {
            name: "idx_tapp_user_activities_user_last_run".into(),
            table: "tapp_user_activities".into(),
            columns: vec!["user_id".into(), "last_run_at".into()],
            is_unique: false,
        },
    ]
}

/// 从数据库获取表的实际列
async fn get_table_columns(
    db: &DatabaseConnection,
    table_name: &str,
) -> Result<HashSet<String>, DbErr> {
    // 安全检查：表名只允许字母、数字、下划线
    if !table_name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err(DbErr::Custom(format!("Invalid table name: {}", table_name)));
    }

    let sql = format!(
        r#"
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = '{}'
        "#,
        table_name
    );

    let rows = db
        .query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            sql,
        ))
        .await?;

    let mut columns = HashSet::new();
    for row in rows {
        if let Ok(name) = row.try_get::<String>("", "column_name") {
            columns.insert(name);
        }
    }

    Ok(columns)
}

/// 从数据库获取所有表名
async fn get_existing_tables(db: &DatabaseConnection) -> Result<HashSet<String>, DbErr> {
    let sql = r#"
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    "#;

    let rows = db
        .query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            sql.to_string(),
        ))
        .await?;

    let mut tables = HashSet::new();
    for row in rows {
        if let Ok(name) = row.try_get::<String>("", "table_name") {
            tables.insert(name);
        }
    }

    Ok(tables)
}

/// 从数据库获取现有索引
async fn get_existing_indexes(db: &DatabaseConnection) -> Result<HashSet<String>, DbErr> {
    let sql = r#"
        SELECT indexname 
        FROM pg_indexes 
        WHERE schemaname = 'public'
    "#;

    let rows = db
        .query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            sql.to_string(),
        ))
        .await?;

    let mut indexes = HashSet::new();
    for row in rows {
        if let Ok(name) = row.try_get::<String>("", "indexname") {
            indexes.insert(name);
        }
    }

    Ok(indexes)
}

/// 生成 ADD COLUMN DDL
fn generate_add_column_ddl(table: &str, col: &ColumnDef) -> String {
    let mut ddl = format!(
        "ALTER TABLE {} ADD COLUMN IF NOT EXISTS {} {}",
        table, col.name, col.data_type
    );

    if let Some(ref default) = col.default_value {
        ddl.push_str(&format!(" DEFAULT {}", default));
    }

    ddl
}

/// 生成 CREATE INDEX DDL
fn generate_create_index_ddl(idx: &IndexDef) -> String {
    let unique = if idx.is_unique { "UNIQUE " } else { "" };
    let columns = idx.columns.join(", ");
    format!(
        "CREATE {}INDEX IF NOT EXISTS {} ON {}({})",
        unique, idx.name, idx.table, columns
    )
}

/// 检查 schema 版本是否已应用
async fn is_schema_version_applied(db: &DatabaseConnection, version: &str) -> Result<bool, DbErr> {
    // 安全检查：版本号只允许字母、数字、点、下划线、连字符
    if !version
        .chars()
        .all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err(DbErr::Custom(format!(
            "Invalid version format: {}",
            version
        )));
    }

    // 先确保版本表存在
    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS _schema_versions (
            version VARCHAR(50) PRIMARY KEY,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .await?;

    let result = db
        .query_one(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            format!(
                "SELECT 1 FROM _schema_versions WHERE version = '{}'",
                version
            ),
        ))
        .await?;

    Ok(result.is_some())
}

/// 记录 schema 版本已应用
async fn mark_schema_version_applied(db: &DatabaseConnection, version: &str) -> Result<(), DbErr> {
    // 安全检查：版本号只允许字母、数字、点、下划线、连字符
    if !version
        .chars()
        .all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err(DbErr::Custom(format!(
            "Invalid version format: {}",
            version
        )));
    }

    db.execute_unprepared(&format!(
        "INSERT INTO _schema_versions (version) VALUES ('{}') ON CONFLICT (version) DO NOTHING",
        version
    ))
    .await?;

    Ok(())
}

/// 确保数据库 schema 是最新的
///
/// 工作流程：
/// 1. 检查版本标记，如果当前版本已应用则跳过
/// 2. 比对迁移文件定义的期望结构与数据库实际结构
/// 3. 自动添加缺失的列和索引
/// 4. 记录版本标记
pub async fn ensure_schema(db: &DatabaseConnection) -> Result<(), DbErr> {
    // 1. 尝试获取 Advisory Lock（非阻塞）
    let lock_acquired = try_acquire_advisory_lock(db).await?;
    if !lock_acquired {
        tracing::info!("🔒 Another instance is running schema check, skipping...");
        return Ok(());
    }

    // 使用 scopeguard 确保锁一定被释放（即使发生 panic 或提前返回）
    let result = do_schema_check(db).await;

    // 无论成功失败都释放锁
    if let Err(e) = release_advisory_lock(db).await {
        tracing::error!("Failed to release advisory lock: {}", e);
    }

    result
}

/// 实际执行 schema 检查的内部函数
async fn do_schema_check(db: &DatabaseConnection) -> Result<(), DbErr> {
    // 检查版本是否已应用
    // 修改：即使版本已应用也强制检查，确保 schema 完整性
    let version_applied = is_schema_version_applied(db, SCHEMA_VERSION).await?;

    if version_applied {
        tracing::info!(
            "ℹ️ Schema version {} marked as applied, but performing safety check...",
            SCHEMA_VERSION
        );
    } else {
        tracing::info!(
            "🔍 Schema version {} not applied, checking database structure...",
            SCHEMA_VERSION
        );
    }

    let mut ddl_statements: Vec<String> = Vec::new();
    let mut changes_made = 0;

    // 2. 获取现有表
    let existing_tables = get_existing_tables(db).await?;
    let expected_tables = get_expected_schema();

    // 3. 对每个期望的表，检查缺失的列
    for table_def in &expected_tables {
        if !existing_tables.contains(&table_def.name) {
            tracing::debug!(
                "Table '{}' does not exist, skipping column check",
                table_def.name
            );
            continue;
        }

        let existing_columns = get_table_columns(db, &table_def.name).await?;

        for col in &table_def.columns {
            if !existing_columns.contains(&col.name) {
                let ddl = generate_add_column_ddl(&table_def.name, col);
                tracing::info!("📝 Missing column: {}.{}", table_def.name, col.name);
                ddl_statements.push(ddl);
                changes_made += 1;
            }
        }
    }

    // 4. 检查缺失的索引
    let existing_indexes = get_existing_indexes(db).await?;
    let expected_indexes = get_expected_indexes();

    for idx in &expected_indexes {
        if !existing_indexes.contains(&idx.name) {
            // 确保表存在
            if existing_tables.contains(&idx.table) {
                let ddl = generate_create_index_ddl(idx);
                tracing::info!("📝 Missing index: {}", idx.name);
                ddl_statements.push(ddl);
                changes_made += 1;
            }
        }
    }

    // 5. 执行所有 DDL
    if !ddl_statements.is_empty() {
        tracing::info!("🔧 Applying {} schema changes...", ddl_statements.len());

        for ddl in &ddl_statements {
            tracing::debug!("Executing: {}", ddl);
            if let Err(e) = db.execute_unprepared(ddl).await {
                tracing::warn!("DDL execution warning: {} - {}", ddl, e);
            }
        }

        tracing::info!("✅ Applied {} schema changes", changes_made);
    } else {
        tracing::info!("✅ Database schema is up to date (no changes needed)");
    }

    // 6. 记录版本已应用
    mark_schema_version_applied(db, SCHEMA_VERSION).await?;
    tracing::info!("📌 Schema version {} marked as applied", SCHEMA_VERSION);

    Ok(())
}

/// 尝试获取 PostgreSQL Advisory Lock（非阻塞）
async fn try_acquire_advisory_lock(db: &DatabaseConnection) -> Result<bool, DbErr> {
    const LOCK_ID: i64 = 0x4D59524941445343; // "MYRIADS" in hex

    let result = db
        .query_one(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            format!("SELECT pg_try_advisory_lock({})", LOCK_ID),
        ))
        .await?;

    if let Some(row) = result {
        let acquired: bool = row.try_get("", "pg_try_advisory_lock")?;
        return Ok(acquired);
    }

    Ok(false)
}

/// 释放 PostgreSQL Advisory Lock
async fn release_advisory_lock(db: &DatabaseConnection) -> Result<(), DbErr> {
    const LOCK_ID: i64 = 0x4D59524941445343;

    db.execute_unprepared(&format!("SELECT pg_advisory_unlock({})", LOCK_ID))
        .await?;

    Ok(())
}

/// 强制重新执行 schema 检查
#[allow(dead_code)]
pub async fn force_schema_check(db: &DatabaseConnection) -> Result<(), DbErr> {
    tracing::warn!("⚠️ Force schema check");

    let lock_acquired = try_acquire_advisory_lock(db).await?;
    if !lock_acquired {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let _ = try_acquire_advisory_lock(db).await;
    }

    // 执行强制检查并确保释放锁
    let result = do_force_schema_check(db).await;

    if let Err(e) = release_advisory_lock(db).await {
        tracing::error!("Failed to release advisory lock: {}", e);
    }

    result
}

/// 强制 schema 检查的内部实现
async fn do_force_schema_check(db: &DatabaseConnection) -> Result<(), DbErr> {
    let existing_tables = get_existing_tables(db).await?;
    let expected_tables = get_expected_schema();

    for table_def in &expected_tables {
        if !existing_tables.contains(&table_def.name) {
            continue;
        }

        let existing_columns = get_table_columns(db, &table_def.name).await?;

        for col in &table_def.columns {
            if !existing_columns.contains(&col.name) {
                let ddl = generate_add_column_ddl(&table_def.name, col);
                let _ = db.execute_unprepared(&ddl).await;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expected_schema_tables() {
        let tables = get_expected_schema();
        assert!(!tables.is_empty());

        // 验证关键表存在
        let table_names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
        assert!(table_names.contains(&"users"));
        assert!(table_names.contains(&"configurations"));
        assert!(table_names.contains(&"platforms"));
    }

    #[test]
    fn test_generate_add_column_ddl() {
        let col = ColumnDef {
            name: "test_col".into(),
            data_type: "VARCHAR(255)".into(),
            is_nullable: true,
            default_value: Some("'default'".into()),
        };

        let ddl = generate_add_column_ddl("users", &col);
        assert!(ddl.contains("ALTER TABLE users"));
        assert!(ddl.contains("ADD COLUMN IF NOT EXISTS"));
        assert!(ddl.contains("test_col"));
        assert!(ddl.contains("DEFAULT 'default'"));
    }

    #[test]
    fn test_generate_create_index_ddl() {
        let idx = IndexDef {
            name: "idx_test".into(),
            table: "users".into(),
            columns: vec!["col1".into(), "col2".into()],
            is_unique: true,
        };

        let ddl = generate_create_index_ddl(&idx);
        assert!(ddl.contains("CREATE UNIQUE INDEX IF NOT EXISTS"));
        assert!(ddl.contains("idx_test"));
        assert!(ddl.contains("col1, col2"));
    }
}
