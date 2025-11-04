use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Configurations::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Configurations::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Configurations::Key)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(Configurations::Value)
                            .json_binary()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Configurations::Description).text())
                    .col(
                        ColumnDef::new(Configurations::IsPublic)
                            .boolean()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(Configurations::CreatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(Configurations::UpdatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        // Insert default configurations using raw SQL for JSONB compatibility
        manager
            .exec_stmt(
                Query::insert()
                    .into_table(Configurations::Table)
                    .columns([
                        Configurations::Key,
                        Configurations::Value,
                        Configurations::Description,
                        Configurations::IsPublic,
                    ])
                    .values_panic([
                        "auto_fetch_enabled".into(),
                        Expr::cust("'false'::jsonb"),
                        "Enable automatic data fetching".into(),
                        true.into(),
                    ])
                    .to_owned(),
            )
            .await?;

        manager
            .exec_stmt(
                Query::insert()
                    .into_table(Configurations::Table)
                    .columns([
                        Configurations::Key,
                        Configurations::Value,
                        Configurations::Description,
                        Configurations::IsPublic,
                    ])
                    .values_panic([
                        "fetch_interval_hours".into(),
                        Expr::cust("'24'::jsonb"),
                        "Interval between automatic fetches in hours".into(),
                        true.into(),
                    ])
                    .to_owned(),
            )
            .await?;

        manager
            .exec_stmt(
                Query::insert()
                    .into_table(Configurations::Table)
                    .columns([
                        Configurations::Key,
                        Configurations::Value,
                        Configurations::Description,
                        Configurations::IsPublic,
                    ])
                    .values_panic([
                        "ai_provider".into(),
                        Expr::cust("'\"gemini\"'::jsonb"),
                        "AI service provider (Google Gemini)".into(),
                        true.into(),
                    ])
                    .to_owned(),
            )
            .await?;

        manager
            .exec_stmt(
                Query::insert()
                    .into_table(Configurations::Table)
                    .columns([
                        Configurations::Key,
                        Configurations::Value,
                        Configurations::Description,
                        Configurations::IsPublic,
                    ])
                    .values_panic([
                        "ai_model".into(),
                        Expr::cust("'\"gemini-2.0-flash-exp\"'::jsonb"),
                        "Gemini model for analysis".into(),
                        true.into(),
                    ])
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Configurations::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Configurations {
    Table,
    Id,
    Key,
    Value,
    Description,
    IsPublic,
    CreatedAt,
    UpdatedAt,
}
