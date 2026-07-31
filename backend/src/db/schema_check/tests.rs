//! schema_check unit tests
use super::orchestrator::*;
use super::expected_schema::get_expected_schema;
use super::expected_indexes::get_expected_indexes;
use super::introspect::*;
use super::types::*;
use super::seeds::*;


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

/// 近一个月新功能：须在 get_expected_schema / indexes 有完整条目
/// （数字系列 001/004/005 已 CREATE；本列表只校验 schema_check 侧期望）。
#[test]
fn test_recent_month_features_in_expected_schema() {
    let tables = get_expected_schema();
    let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    for required in [
        // 001 SITE ANALYTICS
        "analytics_page_daily",
        "analytics_visitor_seen",
        "analytics_event_daily",
        "analytics_event_visitor",
        "analytics_referrer_daily",
        "analytics_country_daily",
        "analytics_country_visitor",
        // 004
        "heartbeat_claims",
        // 005 扩展
        "federation_content_filters",
        "federation_policy_settings",
        "federation_domain_aliases",
        "federation_object_interactions",
    ] {
        assert!(
            names.contains(&required),
            "missing recent-feature table in get_expected_schema: {required}"
        );
    }

    let page = tables
        .iter()
        .find(|t| t.name == "analytics_page_daily")
        .expect("analytics_page_daily");
    for col in [
        "day",
        "path",
        "views",
        "unique_visitors",
        "engagement_ms",
        "engaged_views",
    ] {
        assert!(
            page.columns.iter().any(|c| c.name == col),
            "analytics_page_daily missing column {col}"
        );
    }

    let policy = tables
        .iter()
        .find(|t| t.name == "federation_policy_settings")
        .expect("federation_policy_settings");
    for col in [
        "min_trust_level",
        "allowed_domains",
        "auto_discover",
        "rate_max_requests",
        "rate_window_seconds",
        "rate_trusted_multiplier",
    ] {
        assert!(
            policy.columns.iter().any(|c| c.name == col),
            "federation_policy_settings missing column {col}"
        );
    }

    let indexes = get_expected_indexes();
    let idx_names: Vec<&str> = indexes.iter().map(|i| i.name.as_str()).collect();
    for required in [
        "idx_analytics_page_daily_day",
        "idx_analytics_country_daily_day",
        "idx_heartbeat_claims_claimed_at",
        "idx_federation_domain_aliases_new",
        "idx_fed_interactions_object_kind",
        "idx_fed_interactions_user_kind_created",
    ] {
        assert!(
            idx_names.contains(&required),
            "missing recent-feature index in get_expected_indexes: {required}"
        );
    }
}

#[test]
fn test_users_schema_includes_is_owner() {
    let tables = get_expected_schema();
    let users = tables
        .iter()
        .find(|t| t.name == "users")
        .expect("users table");
    assert!(
        users.columns.iter().any(|c| c.name == "is_owner"),
        "users must define is_owner (schema_check / base 001)"
    );
}

#[test]
fn test_default_platform_seeds_include_x_and_core() {
    let seeds = default_platform_seeds();
    let names: Vec<&str> = seeds.iter().map(|s| s.name).collect();
    for required in [
        "github",
        "bilibili",
        "steam",
        "youtube",
        "netease_music",
        "bangumi",
        "x",
        "discord",
        "mal",
    ] {
        assert!(
            names.contains(&required),
            "missing default platform seed: {}",
            required
        );
    }
    // name 唯一
    let mut sorted = names.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), names.len());
}

#[test]
fn test_tapps_schema_includes_approved_permissions() {
    let tables = get_expected_schema();
    let tapps = tables
        .iter()
        .find(|t| t.name == "tapps")
        .expect("tapps table");
    let col = tapps
        .columns
        .iter()
        .find(|c| c.name == "approved_permissions")
        .expect("tapps.approved_permissions must be in expected schema (002 + generic ADD)");
    assert_eq!(col.data_type, "jsonb");
    assert!(!col.is_nullable);
    assert_eq!(col.default_value.as_deref(), Some("'[]'"));
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

/// **CI 漂移闸门。**
///
/// 在一个刚跑完 `Migrator::up` 的全新数据库上，`report_schema_drift` 必须返回空。
/// 一旦不为空，就说明 `migrations/` 里的建表语句与本文件的权威结构列表
/// （49 个 TableDef / 554 个 ColumnDef）已经不一致 —— 也就是审计指出的
/// "5228 行 runtime healer 与 migration 重复定义并已发生漂移"。
///
/// 需要真实 PostgreSQL。没有 `MYRIAD_SCHEMA_DRIFT_DB` 时静默跳过，
/// 这样本地 `cargo test` 不受影响；CI 里由 postgres service 提供该变量。
#[tokio::test]
async fn migrations_leave_no_schema_drift() {
    let Ok(url) = std::env::var("MYRIAD_SCHEMA_DRIFT_DB") else {
        eprintln!("skipping: set MYRIAD_SCHEMA_DRIFT_DB to run the schema drift gate");
        return;
    };

    use sea_orm_migration::MigratorTrait;
    let db = sea_orm::Database::connect(&url)
        .await
        .expect("connect to the drift-check database");

    crate::db::Migrator::up(&db, None)
        .await
        .expect("migrations must apply cleanly to an empty database");

    let drift = report_schema_drift(&db)
        .await
        .expect("drift report must succeed");

    assert!(
        drift.is_empty(),
        "migrations and the schema_check expectation list disagree on {} item(s).\n\
         Either the migration is missing this structure, or schema_check declares \n\
         something the migrations never create:\n{}",
        drift.len(),
        drift.summary()
    );
}
