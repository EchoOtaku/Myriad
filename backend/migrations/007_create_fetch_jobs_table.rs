use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(FetchJobs::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(FetchJobs::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(FetchJobs::PlatformId).integer().not_null())
                    .col(ColumnDef::new(FetchJobs::Status).string().not_null())
                    .col(ColumnDef::new(FetchJobs::StartedAt).timestamp_with_time_zone())
                    .col(ColumnDef::new(FetchJobs::CompletedAt).timestamp_with_time_zone())
                    .col(ColumnDef::new(FetchJobs::ErrorMessage).text())
                    .col(ColumnDef::new(FetchJobs::ItemsFetched).integer().default(0))
                    .col(
                        ColumnDef::new(FetchJobs::CreatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_fetch_jobs_platform")
                            .from(FetchJobs::Table, FetchJobs::PlatformId)
                            .to(Platforms::Table, Platforms::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_fetch_jobs_status")
                    .table(FetchJobs::Table)
                    .col(FetchJobs::Status)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_fetch_jobs_platform_id")
                    .table(FetchJobs::Table)
                    .col(FetchJobs::PlatformId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(FetchJobs::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum FetchJobs {
    Table,
    Id,
    PlatformId,
    Status,
    StartedAt,
    CompletedAt,
    ErrorMessage,
    ItemsFetched,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Platforms {
    Table,
    Id,
}
