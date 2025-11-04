use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Modify users table for local authentication support

        // 1. Add password_hash column (nullable for GitHub users)
        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .add_column(ColumnDef::new(Users::PasswordHash).string_len(255).null())
                    .to_owned(),
            )
            .await?;

        // 2. Add auth_provider column with default 'github'
        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .add_column(
                        ColumnDef::new(Users::AuthProvider)
                            .string_len(20)
                            .not_null()
                            .default("github"),
                    )
                    .to_owned(),
            )
            .await?;

        // 3. Add linked_github_id column for linking local admin to GitHub
        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .add_column(ColumnDef::new(Users::LinkedGithubId).big_integer().null())
                    .to_owned(),
            )
            .await?;

        // 4. Add local_login_disabled flag
        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .add_column(
                        ColumnDef::new(Users::LocalLoginDisabled)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await?;

        // 5. Make github_id nullable (for local users)
        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .modify_column(ColumnDef::new(Users::GithubId).big_integer().null())
                    .to_owned(),
            )
            .await?;

        // 6. Add CHECK constraint: auth_provider must be 'local' or 'github'
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE users ADD CONSTRAINT check_auth_provider 
                 CHECK (auth_provider IN ('local', 'github'))",
            )
            .await?;

        // 7. Add CHECK constraint: is_admin can only be true for local auth
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE users ADD CONSTRAINT check_admin_local_only 
                 CHECK (NOT is_admin OR auth_provider = 'local')",
            )
            .await?;

        // 8. Create unique index for local admin (only one local account allowed)
        manager
            .get_connection()
            .execute_unprepared(
                "CREATE UNIQUE INDEX idx_local_admin ON users (auth_provider) 
                 WHERE auth_provider = 'local'",
            )
            .await?;

        // 9. Create unique index for linked_github_id
        manager
            .create_index(
                Index::create()
                    .name("idx_linked_github_id")
                    .table(Users::Table)
                    .col(Users::LinkedGithubId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop indexes
        manager
            .get_connection()
            .execute_unprepared("DROP INDEX IF EXISTS idx_local_admin")
            .await?;

        manager
            .drop_index(Index::drop().name("idx_linked_github_id").to_owned())
            .await?;

        // Drop constraints
        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE users DROP CONSTRAINT IF EXISTS check_auth_provider")
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE users DROP CONSTRAINT IF EXISTS check_admin_local_only",
            )
            .await?;

        // Revert github_id to not null
        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .modify_column(ColumnDef::new(Users::GithubId).big_integer().not_null())
                    .to_owned(),
            )
            .await?;

        // Drop columns
        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .drop_column(Users::LocalLoginDisabled)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .drop_column(Users::LinkedGithubId)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .drop_column(Users::AuthProvider)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Users::Table)
                    .drop_column(Users::PasswordHash)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum Users {
    Table,
    GithubId,
    PasswordHash,
    AuthProvider,
    LinkedGithubId,
    LocalLoginDisabled,
}
