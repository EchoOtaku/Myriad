use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 创建平台元数据主表
        manager
            .create_table(
                Table::create()
                    .table(PlatformMetadata::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformMetadata::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(PlatformMetadata::UserId)
                            .string()
                            .not_null()
                            .default("default_user"),
                    )
                    .col(
                        ColumnDef::new(PlatformMetadata::PlatformName)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformMetadata::RawData)
                            .json_binary()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformMetadata::FetchedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformMetadata::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(PlatformMetadata::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        // 创建索引
        manager
            .create_index(
                Index::create()
                    .name("idx_platform_metadata_user_platform")
                    .table(PlatformMetadata::Table)
                    .col(PlatformMetadata::UserId)
                    .col(PlatformMetadata::PlatformName)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_platform_metadata_fetched_at")
                    .table(PlatformMetadata::Table)
                    .col(PlatformMetadata::FetchedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PlatformMetadata::Table).to_owned())
            .await
    }
}

#[derive(Iden)]
enum PlatformMetadata {
    Table,
    Id,
    UserId,
    PlatformName,
    RawData,
    FetchedAt,
    CreatedAt,
    UpdatedAt,
}
