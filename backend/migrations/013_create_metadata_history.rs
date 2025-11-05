use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 创建元数据变化历史表
        manager
            .create_table(
                Table::create()
                    .table(MetadataHistory::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(MetadataHistory::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(MetadataHistory::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(MetadataHistory::UserId).string().not_null())
                    .col(
                        ColumnDef::new(MetadataHistory::PlatformName)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataHistory::ChangedFields)
                            .json_binary()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataHistory::OldData)
                            .json_binary()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(MetadataHistory::NewData)
                            .json_binary()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataHistory::ChangeDate)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_metadata_history_metadata_id")
                            .from(MetadataHistory::Table, MetadataHistory::MetadataId)
                            .to(PlatformMetadata::Table, PlatformMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // 创建索引
        manager
            .create_index(
                Index::create()
                    .name("idx_metadata_history_metadata_id")
                    .table(MetadataHistory::Table)
                    .col(MetadataHistory::MetadataId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_metadata_history_user_platform")
                    .table(MetadataHistory::Table)
                    .col(MetadataHistory::UserId)
                    .col(MetadataHistory::PlatformName)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_metadata_history_change_date")
                    .table(MetadataHistory::Table)
                    .col(MetadataHistory::ChangeDate)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(MetadataHistory::Table).to_owned())
            .await
    }
}

#[derive(Iden)]
enum MetadataHistory {
    Table,
    Id,
    MetadataId,
    UserId,
    PlatformName,
    ChangedFields,
    OldData,
    NewData,
    ChangeDate,
}

#[derive(Iden)]
enum PlatformMetadata {
    Table,
    Id,
}
