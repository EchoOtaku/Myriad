use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserProfiles::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(UserProfiles::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(UserProfiles::PlatformId).integer().not_null())
                    .col(ColumnDef::new(UserProfiles::Username).string().not_null())
                    .col(ColumnDef::new(UserProfiles::DisplayName).string())
                    .col(ColumnDef::new(UserProfiles::AvatarUrl).text())
                    .col(ColumnDef::new(UserProfiles::Bio).text())
                    .col(ColumnDef::new(UserProfiles::Location).string())
                    .col(ColumnDef::new(UserProfiles::Website).string())
                    .col(ColumnDef::new(UserProfiles::RawData).json_binary().not_null())
                    .col(
                        ColumnDef::new(UserProfiles::FetchedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(UserProfiles::CreatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(UserProfiles::UpdatedAt)
                            .timestamp_with_time_zone()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_user_profiles_platform")
                            .from(UserProfiles::Table, UserProfiles::PlatformId)
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
                    .name("idx_user_profiles_platform_id")
                    .table(UserProfiles::Table)
                    .col(UserProfiles::PlatformId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_user_profiles_username")
                    .table(UserProfiles::Table)
                    .col(UserProfiles::Username)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(UserProfiles::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum UserProfiles {
    Table,
    Id,
    PlatformId,
    Username,
    DisplayName,
    AvatarUrl,
    Bio,
    Location,
    Website,
    RawData,
    FetchedAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Platforms {
    Table,
    Id,
}
