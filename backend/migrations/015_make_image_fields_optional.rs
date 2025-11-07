use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Make image_prompt nullable
        manager
            .alter_table(
                Table::alter()
                    .table(VirtualPersona::Table)
                    .modify_column(ColumnDef::new(VirtualPersona::ImagePrompt).text().null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Revert image_prompt to not null
        manager
            .alter_table(
                Table::alter()
                    .table(VirtualPersona::Table)
                    .modify_column(
                        ColumnDef::new(VirtualPersona::ImagePrompt)
                            .text()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum VirtualPersona {
    Table,
    ImagePrompt,
}
