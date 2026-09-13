//! First-party worker database budgets. These are deployment controls, not TAPP grants.
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

#[derive(Clone, Copy)]
pub enum WorkerKind {
    Persona,
    Federation,
}

impl WorkerKind {
    pub fn connection_limit(self) -> i32 {
        match self {
            Self::Persona => 8,
            Self::Federation => 4,
        }
    }
    fn role(self) -> &'static str {
        match self {
            Self::Persona => "myriad_persona",
            Self::Federation => "myriad_federation",
        }
    }
    fn statement_ms(self) -> i32 {
        match self {
            Self::Persona => 30_000,
            Self::Federation => 10_000,
        }
    }
}

fn valid_password(value: &str) -> bool {
    (32..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

/// Official bundled deployment provisions after migrations, before web is ready.
/// An external managed DB may instead pre-provision roles and omit both passwords.
/// Application errors are redacted; DBA statement logging must protect role DDL.
pub async fn provision(db: &DatabaseConnection) -> anyhow::Result<()> {
    let persona = std::env::var("PERSONA_DB_PASSWORD").unwrap_or_default();
    let federation = std::env::var("FEDERATION_DB_PASSWORD").unwrap_or_default();
    if persona.is_empty() && federation.is_empty() {
        return Ok(());
    }
    anyhow::ensure!(
        valid_password(&persona) && valid_password(&federation),
        "Worker database passwords must each be 32..128 URL-safe ASCII characters"
    );
    for (kind, password) in [
        (WorkerKind::Persona, persona),
        (WorkerKind::Federation, federation),
    ] {
        // Role identifiers are fixed, and password alphabet excludes SQL syntax.
        let role = kind.role();
        let sql = format!(
            r#"
DO $policy$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{role}') THEN
    CREATE ROLE {role};
  END IF;
END $policy$;
ALTER ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT {connections} PASSWORD '{password}';
ALTER ROLE {role} SET statement_timeout = '{statement}ms';
ALTER ROLE {role} SET lock_timeout = '3s';
ALTER ROLE {role} SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE {role} SET transaction_timeout = '{transaction}ms';
ALTER ROLE {role} SET work_mem = '4MB';
ALTER ROLE {role} SET temp_file_limit = '64MB';
ALTER ROLE {role} SET max_parallel_workers_per_gather = 0;
-- Temporary tables bypass temp_file_limit, and workers never perform DDL.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $policy$ BEGIN
  EXECUTE format('REVOKE TEMP ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO {role}', current_database());
END $policy$;
GRANT USAGE ON SCHEMA public TO {role};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {role};
"#,
            connections = kind.connection_limit(),
            statement = kind.statement_ms(),
            transaction = kind.statement_ms() + 5_000
        );
        db.execute_unprepared(&sql).await.map_err(|_| anyhow::anyhow!(
            "Could not provision worker database role; PostgreSQL 17+ and role administration are required"))?;
    }
    Ok(())
}

/// Refuse the legacy superuser login in production. Server-side limits continue
/// to apply even if extra pools/connections are opened outside our normal pool.
pub async fn verify(db: &DatabaseConnection, kind: WorkerKind) -> anyhow::Result<()> {
    if !crate::config::AppConfig::is_production_environment() {
        return Ok(());
    }
    let row = db
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            r#"
SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
       OR EXISTS (SELECT 1 FROM pg_roles a WHERE (a.rolsuper OR a.rolcreaterole OR a.rolcreatedb OR a.rolreplication OR a.rolbypassrls
             OR a.rolname IN ('pg_execute_server_program', 'pg_read_server_files',
                             'pg_write_server_files', 'pg_signal_backend'))
          AND pg_has_role(current_user, a.oid, 'MEMBER')) AS privileged,
       r.rolconnlimit,
       pg_size_bytes(current_setting('temp_file_limit')) AS temp_limit,
       COALESCE((SELECT setting::bigint FROM pg_settings WHERE name='transaction_timeout'), 0) AS transaction_limit,
       has_database_privilege(current_database(), 'TEMP') AS can_temp,
       has_schema_privilege('public', 'CREATE') AS can_create
FROM pg_roles r WHERE r.rolname = current_user
"#,
        ))
        .await
        .map_err(|_| anyhow::anyhow!("Could not verify worker database policy"))?
        .ok_or_else(|| anyhow::anyhow!("Worker database role is missing"))?;
    let privileged: bool = row.try_get("", "privileged")?;
    let limit: i32 = row.try_get("", "rolconnlimit")?;
    let temp: i64 = row.try_get("", "temp_limit")?;
    let transaction: i64 = row.try_get("", "transaction_limit")?;
    let can_temp: bool = row.try_get("", "can_temp")?;
    let can_create: bool = row.try_get("", "can_create")?;
    anyhow::ensure!(
        !privileged && !can_temp && !can_create && limit > 0 && limit <= kind.connection_limit()
            && (0..=64 * 1024 * 1024).contains(&temp)
            && transaction > 0 && transaction <= i64::from(kind.statement_ms() + 5_000),
        "Worker requires an unprivileged connection-limited PostgreSQL 17+ role, no DDL/TEMP privileges, temp_file_limit<=64MB and bounded transaction_timeout; provision worker DB roles before startup"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn passwords_cannot_escape_sql_or_url_context() {
        assert!(valid_password(&"aZ0-_".repeat(8)));
        for bad in [
            "x".repeat(31),
            "x".repeat(129),
            format!("{}'", "x".repeat(40)),
            format!("{}@", "x".repeat(40)),
            format!("{}\n", "x".repeat(40)),
        ] {
            assert!(!valid_password(&bad));
        }
    }
}
