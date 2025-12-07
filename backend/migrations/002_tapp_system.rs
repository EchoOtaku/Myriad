use sea_orm_migration::prelude::*;

/// Tapp 系统数据库结构
///
/// 包含 Tapp 应用、小组件和存储表
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ==================== 1. TAPPS 表 ====================
        // 存储已安装的 Tapp 应用元数据
        manager
            .create_table(
                Table::create()
                    .table(Tapps::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Tapps::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Tapps::TappId).string_len(255).not_null())
                    .col(ColumnDef::new(Tapps::UserId).integer().not_null())
                    .col(ColumnDef::new(Tapps::Name).string_len(255).not_null())
                    .col(ColumnDef::new(Tapps::Version).string_len(50).not_null())
                    .col(ColumnDef::new(Tapps::Description).text())
                    .col(ColumnDef::new(Tapps::Author).json())
                    .col(ColumnDef::new(Tapps::Icon).text())
                    .col(ColumnDef::new(Tapps::ThemeColor).string_len(20))
                    .col(ColumnDef::new(Tapps::Manifest).json().not_null())
                    .col(
                        ColumnDef::new(Tapps::Status)
                            .string_len(20)
                            .not_null()
                            .default("installed"),
                    )
                    .col(
                        ColumnDef::new(Tapps::GrantedPermissions)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(ColumnDef::new(Tapps::FilePath).text().not_null())
                    .col(ColumnDef::new(Tapps::CodePath).text().not_null())
                    .col(
                        ColumnDef::new(Tapps::InstalledAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Tapps::LastRunAt).timestamp_with_time_zone())
                    .col(
                        ColumnDef::new(Tapps::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Tapps::ErrorMessage).text())
                    .to_owned(),
            )
            .await?;

        // 唯一索引：同一用户不能安装同一 Tapp 两次
        manager
            .create_index(
                Index::create()
                    .name("idx_tapps_user_tapp_id")
                    .table(Tapps::Table)
                    .col(Tapps::UserId)
                    .col(Tapps::TappId)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_tapps_user_id")
                    .table(Tapps::Table)
                    .col(Tapps::UserId)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_tapps_status")
                    .table(Tapps::Table)
                    .col(Tapps::Status)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        // 状态约束 (仅 PostgreSQL 支持)
        // 对于其他数据库，在应用层验证状态值
        let db_backend = manager.get_database_backend();
        if matches!(db_backend, sea_orm::DatabaseBackend::Postgres) {
            let _ = manager
                .get_connection()
                .execute_unprepared(
                    "DO $$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_tapp_status') THEN
                        ALTER TABLE tapps ADD CONSTRAINT check_tapp_status 
                        CHECK (status IN ('installed', 'running', 'suspended', 'error'));
                    END IF;
                END $$;",
                )
                .await;
        }

        // ==================== 2. TAPP_WIDGETS 表 ====================
        // 存储 Tapp 注册的小组件
        manager
            .create_table(
                Table::create()
                    .table(TappWidgets::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TappWidgets::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(TappWidgets::WidgetId)
                            .string_len(255)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TappWidgets::TappId)
                            .string_len(255)
                            .not_null(),
                    )
                    .col(ColumnDef::new(TappWidgets::UserId).integer().not_null())
                    .col(ColumnDef::new(TappWidgets::Name).string_len(255).not_null())
                    .col(ColumnDef::new(TappWidgets::Description).text())
                    .col(ColumnDef::new(TappWidgets::Icon).text())
                    .col(
                        ColumnDef::new(TappWidgets::DefaultSize)
                            .string_len(10)
                            .not_null()
                            .default("2x2"),
                    )
                    .col(
                        ColumnDef::new(TappWidgets::Sizes)
                            .json()
                            .not_null()
                            .default("[\"2x2\"]"),
                    )
                    .col(
                        ColumnDef::new(TappWidgets::Category)
                            .string_len(50)
                            .default("custom"),
                    )
                    .col(ColumnDef::new(TappWidgets::Config).json().not_null())
                    .col(
                        ColumnDef::new(TappWidgets::RegisteredAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        // 唯一索引：同一用户同一 Tapp 的 Widget ID 唯一
        manager
            .create_index(
                Index::create()
                    .name("idx_tapp_widgets_unique")
                    .table(TappWidgets::Table)
                    .col(TappWidgets::UserId)
                    .col(TappWidgets::TappId)
                    .col(TappWidgets::WidgetId)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_tapp_widgets_user_id")
                    .table(TappWidgets::Table)
                    .col(TappWidgets::UserId)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        // ==================== 3. TAPP_STORAGE 表 ====================
        // 存储 Tapp 的键值数据
        manager
            .create_table(
                Table::create()
                    .table(TappStorage::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TappStorage::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(TappStorage::TappId)
                            .string_len(255)
                            .not_null(),
                    )
                    .col(ColumnDef::new(TappStorage::UserId).integer().not_null())
                    .col(ColumnDef::new(TappStorage::Key).string_len(255).not_null())
                    .col(ColumnDef::new(TappStorage::Value).json().not_null())
                    .col(
                        ColumnDef::new(TappStorage::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(TappStorage::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        // 唯一索引：同一用户同一 Tapp 的 Key 唯一
        manager
            .create_index(
                Index::create()
                    .name("idx_tapp_storage_unique")
                    .table(TappStorage::Table)
                    .col(TappStorage::UserId)
                    .col(TappStorage::TappId)
                    .col(TappStorage::Key)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_tapp_storage_user_tapp")
                    .table(TappStorage::Table)
                    .col(TappStorage::UserId)
                    .col(TappStorage::TappId)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        // ==================== 4. TAPP_QUOTA_USAGE 表 ====================
        // 存储 Tapp 的配额使用情况
        manager
            .create_table(
                Table::create()
                    .table(TappQuotaUsage::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TappQuotaUsage::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(TappQuotaUsage::TappId)
                            .string_len(255)
                            .not_null(),
                    )
                    .col(ColumnDef::new(TappQuotaUsage::UserId).integer().not_null())
                    .col(
                        ColumnDef::new(TappQuotaUsage::QuotaType)
                            .string_len(50)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TappQuotaUsage::Used)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(TappQuotaUsage::Limit).integer().not_null())
                    .col(
                        ColumnDef::new(TappQuotaUsage::PeriodStart)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TappQuotaUsage::PeriodEnd)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TappQuotaUsage::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        // 唯一索引
        manager
            .create_index(
                Index::create()
                    .name("idx_tapp_quota_unique")
                    .table(TappQuotaUsage::Table)
                    .col(TappQuotaUsage::UserId)
                    .col(TappQuotaUsage::TappId)
                    .col(TappQuotaUsage::QuotaType)
                    .col(TappQuotaUsage::PeriodStart)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        // ==================== 5. TAPP_STORE_SOURCES 表 ====================
        // 存储远程商店源配置（仅管理员可管理）
        manager
            .create_table(
                Table::create()
                    .table(TappStoreSources::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TappStoreSources::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(TappStoreSources::Name)
                            .string_len(255)
                            .not_null(),
                    )
                    .col(ColumnDef::new(TappStoreSources::Description).text())
                    .col(ColumnDef::new(TappStoreSources::Url).text().not_null())
                    .col(
                        ColumnDef::new(TappStoreSources::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(TappStoreSources::Official)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(TappStoreSources::Icon).string_len(100))
                    .col(
                        ColumnDef::new(TappStoreSources::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(TappStoreSources::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        // 唯一索引：URL 唯一
        manager
            .create_index(
                Index::create()
                    .name("idx_tapp_store_sources_url")
                    .table(TappStoreSources::Table)
                    .col(TappStoreSources::Url)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        // 插入官方商店源
        manager
            .exec_stmt(
                Query::insert()
                    .into_table(TappStoreSources::Table)
                    .columns([
                        TappStoreSources::Name,
                        TappStoreSources::Description,
                        TappStoreSources::Url,
                        TappStoreSources::Enabled,
                        TappStoreSources::Official,
                        TappStoreSources::Icon,
                    ])
                    .values_panic([
                        "Myriad 官方商店".into(),
                        "官方应用商店，提供经过审核的高质量应用".into(),
                        "https://raw.githubusercontent.com/Myriad-You/tapp-store/main/index.json"
                            .into(),
                        true.into(),
                        true.into(),
                        "🏪".into(),
                    ])
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(TappStoreSources::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(TappQuotaUsage::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(TappStorage::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(TappWidgets::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Tapps::Table).to_owned())
            .await?;

        Ok(())
    }
}

// ==================== 表定义枚举 ====================

#[derive(DeriveIden)]
enum Tapps {
    Table,
    Id,
    TappId,
    UserId,
    Name,
    Version,
    Description,
    Author,
    Icon,
    ThemeColor,
    Manifest,
    Status,
    GrantedPermissions,
    FilePath,
    CodePath,
    InstalledAt,
    LastRunAt,
    UpdatedAt,
    ErrorMessage,
}

#[derive(DeriveIden)]
enum TappWidgets {
    Table,
    Id,
    WidgetId,
    TappId,
    UserId,
    Name,
    Description,
    Icon,
    DefaultSize,
    Sizes,
    Category,
    Config,
    RegisteredAt,
}

#[derive(DeriveIden)]
enum TappStorage {
    Table,
    Id,
    TappId,
    UserId,
    Key,
    Value,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum TappQuotaUsage {
    Table,
    Id,
    TappId,
    UserId,
    QuotaType,
    Used,
    Limit,
    PeriodStart,
    PeriodEnd,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum TappStoreSources {
    Table,
    Id,
    Name,
    Description,
    Url,
    Enabled,
    Official,
    Icon,
    CreatedAt,
    UpdatedAt,
}
