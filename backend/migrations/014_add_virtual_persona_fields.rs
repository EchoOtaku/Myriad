use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 在 metadata_history 表中添加虚拟人设相关字段
        manager
            .alter_table(
                Table::alter()
                    .table(MetadataHistory::Table)
                    // 虚拟人设槽位 (0 或 1，支持两个人设)
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaSlot)
                            .integer()
                            .null(),
                    )
                    // 虚拟人设名称
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaName)
                            .string()
                            .null(),
                    )
                    // 虚拟人设性格描述
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaPersonality)
                            .text()
                            .null(),
                    )
                    // 虚拟人设外貌描述
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaAppearance)
                            .text()
                            .null(),
                    )
                    // 虚拟人设爱好 (JSON 数组)
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaHobbies)
                            .json_binary()
                            .null(),
                    )
                    // 虚拟人设生活方式
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaLifeStyle)
                            .text()
                            .null(),
                    )
                    // 虚拟人设视觉风格
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaVisualStyle)
                            .text()
                            .null(),
                    )
                    // 图片生成 prompt
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaImagePrompt)
                            .text()
                            .null(),
                    )
                    // 虚拟人设图片 URL
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaImageUrl)
                            .text()
                            .null(),
                    )
                    // 虚拟人设过期时间
                    .add_column(
                        ColumnDef::new(MetadataHistory::PersonaExpiresAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // 创建索引用于查询用户的虚拟人设
        manager
            .create_index(
                Index::create()
                    .name("idx_metadata_history_persona_user_slot")
                    .table(MetadataHistory::Table)
                    .col(MetadataHistory::UserId)
                    .col(MetadataHistory::PersonaSlot)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 删除索引
        manager
            .drop_index(
                Index::drop()
                    .name("idx_metadata_history_persona_user_slot")
                    .table(MetadataHistory::Table)
                    .to_owned(),
            )
            .await?;

        // 删除虚拟人设相关字段
        manager
            .alter_table(
                Table::alter()
                    .table(MetadataHistory::Table)
                    .drop_column(MetadataHistory::PersonaSlot)
                    .drop_column(MetadataHistory::PersonaName)
                    .drop_column(MetadataHistory::PersonaPersonality)
                    .drop_column(MetadataHistory::PersonaAppearance)
                    .drop_column(MetadataHistory::PersonaHobbies)
                    .drop_column(MetadataHistory::PersonaLifeStyle)
                    .drop_column(MetadataHistory::PersonaVisualStyle)
                    .drop_column(MetadataHistory::PersonaImagePrompt)
                    .drop_column(MetadataHistory::PersonaImageUrl)
                    .drop_column(MetadataHistory::PersonaExpiresAt)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
#[allow(dead_code)]
enum MetadataHistory {
    Table,
    UserId,
    PersonaSlot,
    PersonaName,
    PersonaPersonality,
    PersonaAppearance,
    PersonaHobbies,
    PersonaLifeStyle,
    PersonaVisualStyle,
    PersonaImagePrompt,
    PersonaImageUrl,
    PersonaExpiresAt,
}
