//! Temporary brew → phantasi rename for databases that already ran 003_brew_system.
//!
//! Delete this file and `myriad_phantasi::legacy` after every instance has upgraded.
//! Greenfield databases skip this (no `brew_sources`) and create `phantasi_*` via
//! the rewritten 003.

use myriad_phantasi::legacy::{
    FOREIGN_KEYS, FUNCTIONS, INDEXES, NEW_MIGRATION_NAME, NEW_SOURCES_TABLE, OLD_MIGRATION_NAME,
    OLD_SOURCES_TABLE, TABLES, TEXT_REPLACEMENTS, TRIGGERS, rename_json_brew_key,
    rewrite_stored_text,
};
use sea_orm::{ConnectionTrait, DatabaseBackend, DbErr, Statement};
use serde_json::Value;

fn ident_ok(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn qident(name: &str) -> Result<String, DbErr> {
    if ident_ok(name) {
        Ok(name.to_string())
    } else {
        Err(DbErr::Custom(format!("unsafe identifier {name}")))
    }
}

async fn table_exists(db: &impl ConnectionTrait, table: &str) -> Result<bool, DbErr> {
    let table = qident(table)?;
    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1
               FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = $1",
            [table.into()],
        ))
        .await?;
    Ok(!rows.is_empty())
}

/// Whether this instance still needs the brew → phantasi rename pass.
///
/// `pending_old_version` means `seaql_migrations` still has `003_brew_system`.
/// That stays true if an earlier attempt renamed tables and then failed mid-rewrite,
/// so a later startup can finish instead of treating the DB as greenfield.
fn rename_needed(has_old: bool, has_new: bool, pending_old_version: bool) -> Result<bool, DbErr> {
    if has_old && has_new {
        return Err(DbErr::Custom(
            "both brew_sources and phantasi_sources exist; refuse to guess".into(),
        ));
    }
    Ok(has_old || pending_old_version)
}

/// Rename leftover brew tables/data, then rewrite `003_brew_system` → `003_phantasi_system`.
pub async fn rename_brew_to_phantasi_if_needed(db: &impl ConnectionTrait) -> Result<(), DbErr> {
    let has_old = table_exists(db, OLD_SOURCES_TABLE).await?;
    let has_new = table_exists(db, NEW_SOURCES_TABLE).await?;
    let pending_old_version = migration_version_exists(db, OLD_MIGRATION_NAME).await?;
    if rename_needed(has_old, has_new, pending_old_version)? {
        rename_relations(db).await?;
        rewrite_row_text(db).await?;
        rewrite_json_documents(db).await?;
        rewrite_migration_version(db).await?;
    }

    // This repair also runs for databases that completed the original rename
    // before agent_persona asset fields were added to its rewrite scope.
    repair_agent_persona_asset_urls(db).await?;
    Ok(())
}

async fn rename_relations(db: &impl ConnectionTrait) -> Result<(), DbErr> {
    for (old, new) in TABLES {
        let old = qident(old)?;
        let new = qident(new)?;
        db.execute_unprepared(&format!("ALTER TABLE IF EXISTS {old} RENAME TO {new}"))
            .await?;
    }
    for (old, new) in INDEXES {
        let old = qident(old)?;
        let new = qident(new)?;
        db.execute_unprepared(&format!("ALTER INDEX IF EXISTS {old} RENAME TO {new}"))
            .await?;
    }
    for (old_table, old_fk, new_fk) in FOREIGN_KEYS {
        let new_table = TABLES
            .iter()
            .find(|(old, _)| old == old_table)
            .map(|(_, new)| *new)
            .unwrap_or(old_table);
        let table = qident(new_table)?;
        let old_fk = qident(old_fk)?;
        let new_fk = qident(new_fk)?;
        db.execute_unprepared(&format!(
            "DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '{old_fk}'
    ) THEN
        EXECUTE 'ALTER TABLE {table} RENAME CONSTRAINT {old_fk} TO {new_fk}';
    END IF;
END $$;"
        ))
        .await?;
    }
    for (old, new) in FUNCTIONS {
        let old = qident(old)?;
        let new = qident(new)?;
        db.execute_unprepared(&format!(
            "DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = '{old}'
    ) THEN
        EXECUTE 'ALTER FUNCTION {old}() RENAME TO {new}';
    END IF;
END $$;"
        ))
        .await?;
    }
    for (old_table, old_trig, new_trig) in TRIGGERS {
        let new_table = TABLES
            .iter()
            .find(|(old, _)| old == old_table)
            .map(|(_, new)| *new)
            .unwrap_or(old_table);
        let table = qident(new_table)?;
        let old_trig = qident(old_trig)?;
        let new_trig = qident(new_trig)?;
        db.execute_unprepared(&format!(
            "DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = '{table}'
          AND t.tgname = '{old_trig}'
    ) THEN
        EXECUTE 'ALTER TRIGGER {old_trig} ON {table} RENAME TO {new_trig}';
    END IF;
END $$;"
        ))
        .await?;
    }
    Ok(())
}

/// Stored AP / MFP text that may still say brew.
/// `federation_published_content` has no `object_json` — that column is on
/// `federation_activities`.
const FEDERATION_PAYLOAD_REWRITES: &[(&str, &str, Option<&str>)] = &[
    ("federation_published_content", "content_id", None),
    ("federation_activities", "object_json", Some("json")),
    ("federation_activities", "object_type", None),
    ("federation_timeline", "content_json", Some("json")),
    ("federation_timeline", "content_preview", None),
    ("federation_timeline", "object_type", None),
];

fn apply_sql_replaces(expr: &str) -> String {
    apply_replacements(expr, TEXT_REPLACEMENTS)
}

fn apply_replacements(expr: &str, replacements: &[(&str, &str)]) -> String {
    let mut out = expr.to_string();
    for (from, to) in replacements {
        let from = from.replace('\'', "''");
        let to = to.replace('\'', "''");
        out = format!("replace({out}, '{from}', '{to}')");
    }
    out
}

async fn rewrite_row_text(db: &impl ConnectionTrait) -> Result<(), DbErr> {
    let updates = [
        ("phantasi_items", &["content", "image", "summary"][..]),
        ("phantasi_sources", &["icon"][..]),
        ("phantasi_note_docs", &["content_md", "image"][..]),
        ("media_assets", &["url"][..]),
    ];
    for (table, cols) in updates {
        if !table_exists(db, table).await? {
            continue;
        }
        let table = qident(table)?;
        for col in cols {
            let col = qident(col)?;
            let expr = apply_sql_replaces(&col);
            db.execute_unprepared(&format!(
                "UPDATE {table} SET {col} = {expr} WHERE {col} IS NOT NULL"
            ))
            .await?;
        }
    }

    if table_exists(db, "phantasi_sources").await? {
        db.execute_unprepared(
            "UPDATE phantasi_sources SET source_type = 'phantasiai' WHERE source_type = 'brewlia'",
        )
        .await?;
        db.execute_unprepared(
            "UPDATE phantasi_sources
                SET name = '笔记'
              WHERE source_type = 'note'
                AND name = '手记'",
        )
        .await?;
    }
    // Mapping table only: content_type / content_id. The Create envelope is
    // `federation_activities.object_json`.
    if table_exists(db, "federation_published_content").await? {
        db.execute_unprepared(
            "UPDATE federation_published_content
                SET content_type = 'phantasi-article'
              WHERE content_type = 'brew-article'",
        )
        .await?;
    }
    for (table, column, restore_cast) in FEDERATION_PAYLOAD_REWRITES {
        rewrite_column(db, table, column, *restore_cast).await?;
    }
    if table_exists(db, "federation_ring_memberships").await? {
        db.execute_unprepared(
            "UPDATE federation_ring_memberships
                SET ring_type = 'phantasi-recommend'
              WHERE ring_type = 'brew-recommend'",
        )
        .await?;
    }
    if table_exists(db, "agent_notifications").await? {
        db.execute_unprepared(
            "UPDATE agent_notifications
                SET notification_type = replace(notification_type, 'brew_', 'phantasi_')
              WHERE notification_type LIKE 'brew_%'",
        )
        .await?;
        if column_exists(db, "agent_notifications", "metadata").await? {
            let expr = apply_sql_replaces("metadata::text");
            db.execute_unprepared(&format!(
                "UPDATE agent_notifications SET metadata = ({expr})::jsonb WHERE metadata IS NOT NULL"
            ))
            .await?;
        }
    }
    if table_exists(db, "analytics_event_daily").await? {
        db.execute_unprepared(
            "UPDATE analytics_event_daily
                SET event_name = replace(event_name, 'brew_', 'phantasi_')
              WHERE event_name LIKE 'brew_%'",
        )
        .await?;
    }
    if table_exists(db, "analytics_event_visitor").await? {
        db.execute_unprepared(
            "UPDATE analytics_event_visitor
                SET event_name = replace(event_name, 'brew_', 'phantasi_')
              WHERE event_name LIKE 'brew_%'",
        )
        .await?;
    }
    Ok(())
}

const LEGACY_IMAGE_CACHE_REPLACEMENTS: &[(&str, &str)] =
    &[("/api/brew/image-cache/", "/api/phantasi/image-cache/")];

const AGENT_PERSONA_ASSET_COLUMNS: &[(&str, Option<&str>)] = &[
    ("portrait_asset_id", None),
    ("avatar_asset_id", None),
    ("visual_profile", Some("jsonb")),
    ("portrait_generation", Some("jsonb")),
    ("avatar_generation", Some("jsonb")),
];

async fn repair_agent_persona_asset_urls(db: &impl ConnectionTrait) -> Result<(), DbErr> {
    for (column, restore_cast) in AGENT_PERSONA_ASSET_COLUMNS {
        rewrite_column_with_replacements(
            db,
            "agent_persona",
            column,
            *restore_cast,
            LEGACY_IMAGE_CACHE_REPLACEMENTS,
        )
        .await?;
    }
    Ok(())
}

/// Rewrite stored brew strings in one column. `restore_cast` is `json` / `jsonb`
/// when the column is not text; `None` writes the replaced text back as-is.
/// Missing table or column is a no-op so a half-applied rename can resume.
async fn rewrite_column(
    db: &impl ConnectionTrait,
    table: &str,
    column: &str,
    restore_cast: Option<&str>,
) -> Result<(), DbErr> {
    rewrite_column_with_replacements(db, table, column, restore_cast, TEXT_REPLACEMENTS).await
}

async fn rewrite_column_with_replacements(
    db: &impl ConnectionTrait,
    table: &str,
    column: &str,
    restore_cast: Option<&str>,
    replacements: &[(&str, &str)],
) -> Result<(), DbErr> {
    if replacements.is_empty() {
        return Ok(());
    }
    if !table_exists(db, table).await? || !column_exists(db, table, column).await? {
        return Ok(());
    }
    let table = qident(table)?;
    let column = qident(column)?;
    let expr = apply_replacements(&format!("{column}::text"), replacements);
    let contains_legacy_value = replacements
        .iter()
        .map(|(from, _)| {
            let from = from.replace('\'', "''");
            format!("position('{from}' in {column}::text) > 0")
        })
        .collect::<Vec<_>>()
        .join(" OR ");
    let value = match restore_cast {
        Some(ty) => {
            if !ident_ok(ty) {
                return Err(DbErr::Custom(format!("unsafe type {ty}")));
            }
            format!("({expr})::{ty}")
        }
        None => expr,
    };
    db.execute_unprepared(&format!(
        "UPDATE {table} SET {column} = {value} WHERE {column} IS NOT NULL AND ({contains_legacy_value})"
    ))
    .await?;
    Ok(())
}

async fn column_exists(
    db: &impl ConnectionTrait,
    table: &str,
    column: &str,
) -> Result<bool, DbErr> {
    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1
               FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = $1
                AND column_name = $2",
            [table.into(), column.into()],
        ))
        .await?;
    Ok(!rows.is_empty())
}

async fn rewrite_json_documents(db: &impl ConnectionTrait) -> Result<(), DbErr> {
    if table_exists(db, "configurations").await? {
        db.execute_unprepared(
            "DELETE FROM configurations legacy
              WHERE legacy.key = 'brew_notes_rss'
                AND EXISTS (
                    SELECT 1 FROM configurations current
                     WHERE current.key = 'phantasi_notes_rss'
                );
             UPDATE configurations
                SET key = 'phantasi_notes_rss'
              WHERE key = 'brew_notes_rss'",
        )
        .await?;
        db.execute_unprepared(
            "DELETE FROM configurations legacy
              USING configurations current
              WHERE legacy.key LIKE '%perm_brew_%'
                AND current.key = replace(legacy.key, 'perm_brew_', 'perm_phantasi_')
                AND current.id <> legacy.id;
             UPDATE configurations
                SET key = replace(key, 'perm_brew_', 'perm_phantasi_')
              WHERE key LIKE '%perm_brew_%'",
        )
        .await?;
        rewrite_json_column(db, "configurations", "id", "value").await?;
    }
    if table_exists(db, "tapps").await? {
        rewrite_json_column(db, "tapps", "id", "approved_permissions").await?;
    }
    if table_exists(db, "users").await?
        && column_exists(db, "users", "notification_preferences").await?
    {
        rewrite_json_column(db, "users", "id", "notification_preferences").await?;
    }
    Ok(())
}

async fn rewrite_json_column(
    db: &impl ConnectionTrait,
    table: &str,
    id_col: &str,
    json_col: &str,
) -> Result<(), DbErr> {
    let table = qident(table)?;
    let id_col = qident(id_col)?;
    let json_col = qident(json_col)?;
    let rows = db
        .query_all_raw(Statement::from_string(
            DatabaseBackend::Postgres,
            format!("SELECT {id_col}::text AS id, {json_col}::text AS body FROM {table} WHERE {json_col} IS NOT NULL"),
        ))
        .await?;
    for row in rows {
        let id: String = row.try_get("", "id")?;
        let Some(body) = row.try_get::<Option<String>>("", "body")? else {
            continue;
        };
        let rewritten = rewrite_stored_text(&body);
        let mut value: Value = match serde_json::from_str(&rewritten) {
            Ok(v) => v,
            Err(_) => continue,
        };
        rename_json_brew_key(&mut value);
        let next = value.to_string();
        if next == body {
            continue;
        }
        db.execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            format!("UPDATE {table} SET {json_col} = $1::jsonb WHERE {id_col}::text = $2"),
            [next.into(), id.into()],
        ))
        .await?;
    }
    Ok(())
}

async fn migration_version_exists(db: &impl ConnectionTrait, version: &str) -> Result<bool, DbErr> {
    if !table_exists(db, "seaql_migrations").await? {
        return Ok(false);
    }
    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1 FROM seaql_migrations WHERE version = $1",
            [version.into()],
        ))
        .await?;
    Ok(!rows.is_empty())
}

async fn rewrite_migration_version(db: &impl ConnectionTrait) -> Result<(), DbErr> {
    if !table_exists(db, "seaql_migrations").await? {
        return Ok(());
    }
    db.execute_unprepared(&format!(
        "DELETE FROM seaql_migrations
          WHERE version = '{OLD_MIGRATION_NAME}'
            AND EXISTS (
                SELECT 1 FROM seaql_migrations
                 WHERE version = '{NEW_MIGRATION_NAME}'
            );
         UPDATE seaql_migrations
            SET version = '{NEW_MIGRATION_NAME}'
          WHERE version = '{OLD_MIGRATION_NAME}'"
    ))
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Requires a disposable empty database; never point this at an instance database.
    #[tokio::test]
    #[ignore = "requires MYRIAD_MIGRATION_TEST_DATABASE_URL pointing to an empty disposable database"]
    async fn repairs_persona_assets_after_completed_rename_in_postgres() {
        let url = std::env::var("MYRIAD_MIGRATION_TEST_DATABASE_URL").unwrap();
        let db = sea_orm::Database::connect(url).await.unwrap();
        let existing = db
            .query_all_raw(Statement::from_string(
                DatabaseBackend::Postgres,
                "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public'",
            ))
            .await
            .unwrap();
        assert!(existing.is_empty(), "test database must be empty");

        // Greenfield startup, then a database whose original rename already finished.
        rename_brew_to_phantasi_if_needed(&db).await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE phantasi_sources (id integer PRIMARY KEY);
             CREATE TABLE agent_persona (
                 id integer PRIMARY KEY, portrait_asset_id text, avatar_asset_id text,
                 visual_profile jsonb, portrait_generation jsonb, avatar_generation jsonb
             );
             INSERT INTO agent_persona VALUES (
                 1, '/api/brew/image-cache/aa/portrait.png', '/api/brew/image-cache/bb/avatar.png',
                 '{\"wardrobe\":[{\"portraitAssetId\":\"/api/brew/image-cache/cc/outfit.png\"}],\"label\":\"brew\"}',
                 '{\"image\":\"/api/brew/image-cache/dd/generated.png\"}',
                 '{\"sourcePortraitAssetId\":\"/api/brew/image-cache/aa/portrait.png\"}'
             ), (
                 2, '/api/phantasi/image-cache/aa/current.png', NULL,
                 '{\"remote\":\"https://example.com/portrait.png\"}', NULL, NULL
             );",
        ).await.unwrap();
        let read = || {
            Statement::from_string(
                DatabaseBackend::Postgres,
                "SELECT *, xmin::text AS row_version FROM agent_persona ORDER BY id",
            )
        };
        let before = db.query_all_raw(read()).await.unwrap();
        rename_brew_to_phantasi_if_needed(&db).await.unwrap();
        let repaired = db.query_all_raw(read()).await.unwrap();
        let portrait: String = repaired[0].try_get("", "portrait_asset_id").unwrap();
        let avatar: String = repaired[0].try_get("", "avatar_asset_id").unwrap();
        let profile: Value = repaired[0].try_get("", "visual_profile").unwrap();
        let generation: Value = repaired[0].try_get("", "portrait_generation").unwrap();
        let avatar_generation: Value = repaired[0].try_get("", "avatar_generation").unwrap();
        assert_eq!(portrait, "/api/phantasi/image-cache/aa/portrait.png");
        assert_eq!(avatar, "/api/phantasi/image-cache/bb/avatar.png");
        assert_eq!(
            profile["wardrobe"][0]["portraitAssetId"],
            "/api/phantasi/image-cache/cc/outfit.png"
        );
        assert_eq!(profile["label"], "brew");
        assert_eq!(
            generation["image"],
            "/api/phantasi/image-cache/dd/generated.png"
        );
        assert_eq!(
            avatar_generation["sourcePortraitAssetId"],
            "/api/phantasi/image-cache/aa/portrait.png"
        );
        assert_eq!(
            before[1].try_get::<String>("", "row_version").unwrap(),
            repaired[1].try_get::<String>("", "row_version").unwrap()
        );

        rename_brew_to_phantasi_if_needed(&db).await.unwrap();
        let repeated = db.query_all_raw(read()).await.unwrap();
        for (previous, current) in repaired.iter().zip(&repeated) {
            assert_eq!(
                previous.try_get::<String>("", "row_version").unwrap(),
                current.try_get::<String>("", "row_version").unwrap(),
                "repeated startup must not rewrite already repaired rows"
            );
        }
    }

    #[test]
    fn rename_needed_skips_greenfield_and_finished_upgrade() {
        assert!(!rename_needed(false, false, false).unwrap());
        assert!(!rename_needed(false, true, false).unwrap());
    }

    #[test]
    fn rename_needed_runs_first_pass_and_resume() {
        assert!(rename_needed(true, false, true).unwrap());
        assert!(rename_needed(true, false, false).unwrap());
        assert!(rename_needed(false, true, true).unwrap());
    }

    #[test]
    fn rename_needed_refuses_both_source_tables() {
        let err = rename_needed(true, true, true).unwrap_err();
        assert!(err.to_string().contains("refuse to guess"));
    }

    #[test]
    fn published_content_is_not_an_object_json_target() {
        assert!(
            FEDERATION_PAYLOAD_REWRITES
                .iter()
                .any(|(table, column, _)| *table == "federation_activities"
                    && *column == "object_json")
        );
        assert!(
            !FEDERATION_PAYLOAD_REWRITES
                .iter()
                .any(
                    |(table, column, _)| *table == "federation_published_content"
                        && *column == "object_json"
                )
        );
    }

    #[test]
    fn agent_persona_repair_rewrites_asset_columns_and_json_urls() {
        let columns: Vec<_> = AGENT_PERSONA_ASSET_COLUMNS
            .iter()
            .map(|(column, ty)| (*column, *ty))
            .collect();
        assert_eq!(
            columns,
            [
                ("portrait_asset_id", None),
                ("avatar_asset_id", None),
                ("visual_profile", Some("jsonb")),
                ("portrait_generation", Some("jsonb")),
                ("avatar_generation", Some("jsonb")),
            ]
        );
        let expr = apply_replacements("visual_profile::text", LEGACY_IMAGE_CACHE_REPLACEMENTS);
        assert!(expr.contains("/api/brew/image-cache/"));
        assert!(expr.contains("/api/phantasi/image-cache/"));
        assert!(expr.starts_with("replace("));
    }
}
