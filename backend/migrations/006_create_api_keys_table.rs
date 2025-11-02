use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ApiKeys::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ApiKeys::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ApiKeys::PlatformId).integer())
                    .col(ColumnDef::new(ApiKeys::ServiceName).string().not_null())
                    .col(ColumnDef::new(ApiKeys::KeyEncrypted).text().not_null())
                    .col(ColumnDef::new(ApiKeys::KeyHint).string())
                    .col(ColumnDef::new(ApiKeys::IsActive).boolean().default(true))
                    .col(ColumnDef::new(ApiKeys::ExpiresAt).timestamp_with_time_zone())
                    .col(
                        ColumnDef::new(ApiKeys::CreatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(ApiKeys::UpdatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_api_keys_platform")
                            .from(ApiKeys::Table, ApiKeys::PlatformId)
                            .to(Platforms::Table, Platforms::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ApiKeys::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ApiKeys {
    Table,
    Id,
    PlatformId,
    ServiceName,
    KeyEncrypted,
    KeyHint,
    IsActive,
    ExpiresAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Platforms {
    Table,
    Id,
}
