use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(VirtualPersona::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(VirtualPersona::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(VirtualPersona::UserId)
                            .string()
                            .not_null()
                            .default("default_user"),
                    )
                    .col(ColumnDef::new(VirtualPersona::Name).string().not_null())
                    .col(
                        ColumnDef::new(VirtualPersona::Personality)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(VirtualPersona::Appearance).text().not_null())
                    .col(
                        ColumnDef::new(VirtualPersona::Hobbies)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .col(ColumnDef::new(VirtualPersona::LifeStyle).text().not_null())
                    .col(ColumnDef::new(VirtualPersona::VisualStyle).text())
                    .col(
                        ColumnDef::new(VirtualPersona::ImagePrompt)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(VirtualPersona::ImageUrl).text())
                    .col(
                        ColumnDef::new(VirtualPersona::GeneratedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(VirtualPersona::ExpiresAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Create unique index on user_id
        manager
            .create_index(
                Index::create()
                    .name("idx_virtual_persona_user_id")
                    .table(VirtualPersona::Table)
                    .col(VirtualPersona::UserId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Create index on expires_at
        manager
            .create_index(
                Index::create()
                    .name("idx_virtual_persona_expires_at")
                    .table(VirtualPersona::Table)
                    .col(VirtualPersona::ExpiresAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(VirtualPersona::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum VirtualPersona {
    Table,
    Id,
    UserId,
    Name,
    Personality,
    Appearance,
    Hobbies,
    LifeStyle,
    VisualStyle,
    ImagePrompt,
    ImageUrl,
    GeneratedAt,
    ExpiresAt,
}
