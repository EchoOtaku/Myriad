use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Platforms::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Platforms::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Platforms::Name)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(Platforms::DisplayName).string().not_null())
                    .col(ColumnDef::new(Platforms::Icon).string())
                    .col(ColumnDef::new(Platforms::ApiEndpoint).string())
                    .col(ColumnDef::new(Platforms::AuthType).string())
                    .col(ColumnDef::new(Platforms::Enabled).boolean().default(false))
                    .col(
                        ColumnDef::new(Platforms::CreatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(Platforms::UpdatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        // Insert default platforms
        let insert = Query::insert()
            .into_table(Platforms::Table)
            .columns([
                Platforms::Name,
                Platforms::DisplayName,
                Platforms::Icon,
                Platforms::ApiEndpoint,
                Platforms::AuthType,
                Platforms::Enabled,
            ])
            .values_panic([
                "github".into(),
                "GitHub".into(),
                "github".into(),
                "https://api.github.com".into(),
                "token".into(),
                true.into(),
            ])
            .values_panic([
                "bilibili".into(),
                "Bilibili".into(),
                "bilibili".into(),
                "https://api.bilibili.com".into(),
                "uid".into(),
                false.into(),
            ])
            .values_panic([
                "steam".into(),
                "Steam".into(),
                "steam".into(),
                "https://api.steampowered.com".into(),
                "api_key".into(),
                false.into(),
            ])
            .values_panic([
                "netease_music".into(),
                "Netease Music".into(),
                "netease".into(),
                "https://music.163.com".into(),
                "user_id".into(),
                false.into(),
            ])
            .values_panic([
                "twitter".into(),
                "Twitter/X".into(),
                "twitter".into(),
                "https://api.twitter.com/2".into(),
                "bearer_token".into(),
                false.into(),
            ])
            .to_owned();

        manager.exec_stmt(insert).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Platforms::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Platforms {
    Table,
    Id,
    Name,
    DisplayName,
    Icon,
    ApiEndpoint,
    AuthType,
    Enabled,
    CreatedAt,
    UpdatedAt,
}
