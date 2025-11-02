use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Reports::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Reports::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Reports::UserId).integer().not_null())
                    .col(ColumnDef::new(Reports::ReportData).json().not_null())
                    .col(ColumnDef::new(Reports::SelectedTopics).json().not_null())
                    .col(ColumnDef::new(Reports::CreatedAt).timestamp().not_null())
                    .col(ColumnDef::new(Reports::ExpiresAt).timestamp().not_null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Reports::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Reports {
    Table,
    Id,
    UserId,
    ReportData,
    SelectedTopics,
    CreatedAt,
    ExpiresAt,
}
