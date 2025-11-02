use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AnalysisResults::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AnalysisResults::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AnalysisResults::AnalysisType).string().not_null())
                    .col(ColumnDef::new(AnalysisResults::InputProfiles).json_binary().not_null())
                    .col(ColumnDef::new(AnalysisResults::Result).json_binary().not_null())
                    .col(ColumnDef::new(AnalysisResults::AiModel).string().not_null())
                    .col(ColumnDef::new(AnalysisResults::TokensUsed).integer())
                    .col(ColumnDef::new(AnalysisResults::ProcessingTimeMs).integer())
                    .col(
                        ColumnDef::new(AnalysisResults::CreatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_analysis_results_type")
                    .table(AnalysisResults::Table)
                    .col(AnalysisResults::AnalysisType)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AnalysisResults::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AnalysisResults {
    Table,
    Id,
    AnalysisType,
    InputProfiles,
    Result,
    AiModel,
    TokensUsed,
    ProcessingTimeMs,
    CreatedAt,
}
