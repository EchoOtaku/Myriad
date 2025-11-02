use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserActivities::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(UserActivities::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(UserActivities::ProfileId).integer().not_null())
                    .col(ColumnDef::new(UserActivities::ActivityType).string().not_null())
                    .col(ColumnDef::new(UserActivities::Title).text())
                    .col(ColumnDef::new(UserActivities::Content).text())
                    .col(ColumnDef::new(UserActivities::Url).text())
                    .col(ColumnDef::new(UserActivities::Metadata).json_binary())
                    .col(ColumnDef::new(UserActivities::ActivityTimestamp).timestamp_with_time_zone().not_null())
                    .col(
                        ColumnDef::new(UserActivities::CreatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_user_activities_profile")
                            .from(UserActivities::Table, UserActivities::ProfileId)
                            .to(UserProfiles::Table, UserProfiles::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_user_activities_profile_id")
                    .table(UserActivities::Table)
                    .col(UserActivities::ProfileId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_user_activities_timestamp")
                    .table(UserActivities::Table)
                    .col(UserActivities::ActivityTimestamp)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(UserActivities::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum UserActivities {
    Table,
    Id,
    ProfileId,
    ActivityType,
    Title,
    Content,
    Url,
    Metadata,
    ActivityTimestamp,
    CreatedAt,
}

#[derive(DeriveIden)]
enum UserProfiles {
    Table,
    Id,
}
