use crate::models::entities::{metadata_history, platform_metadata};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, Set,
};
use serde_json::{json, Value};
use std::collections::HashMap;

/// 元数据服务，用于管理平台原始元数据的存储和变化历史
#[allow(dead_code)]
pub struct MetadataService {
    db: DatabaseConnection,
}

impl MetadataService {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }

    /// 保存或更新平台元数据，并记录变化
    pub async fn save_platform_metadata(
        &self,
        user_id: i32,
        platform_name: &str,
        raw_data: Value,
    ) -> Result<i32, Box<dyn std::error::Error>> {
        tracing::info!(
            "💾 Saving platform metadata to database: {} for user {}",
            platform_name,
            user_id
        );

        // 查找是否已存在该平台的元数据
        let existing = platform_metadata::Entity::find()
            .filter(platform_metadata::Column::UserId.eq(user_id))
            .filter(platform_metadata::Column::PlatformName.eq(platform_name))
            .order_by_desc(platform_metadata::Column::FetchedAt)
            .one(&self.db)
            .await?;

        let now = Utc::now().naive_utc();

        match existing {
            Some(old_metadata) => {
                // 检测数据变化
                let changed_fields = self.detect_changes(&old_metadata.raw_data, &raw_data);

                if changed_fields.is_empty() {
                    tracing::info!("   No changes detected, skipping save");
                    return Ok(old_metadata.id);
                }

                tracing::info!("   Detected {} field changes", changed_fields.len());

                // 更新现有记录
                let mut active_model: platform_metadata::ActiveModel = old_metadata.clone().into();
                active_model.raw_data = Set(raw_data.clone());
                active_model.fetched_at = Set(now);
                active_model.updated_at = Set(now);

                let updated = active_model.update(&self.db).await?;
                let metadata_id = updated.id;

                // 记录变化历史
                self.record_metadata_change(
                    metadata_id,
                    user_id,
                    platform_name,
                    changed_fields,
                    Some(old_metadata.raw_data),
                    raw_data,
                )
                .await?;

                tracing::info!("✅ Platform metadata updated (id: {})", metadata_id);
                Ok(metadata_id)
            }
            None => {
                // 创建新记录
                let new_metadata = platform_metadata::ActiveModel {
                    user_id: Set(user_id),
                    platform_name: Set(platform_name.to_string()),
                    raw_data: Set(raw_data.clone()),
                    fetched_at: Set(now),
                    created_at: Set(now),
                    updated_at: Set(now),
                    ..Default::default()
                };

                let inserted = new_metadata.insert(&self.db).await?;
                let metadata_id = inserted.id;

                // 记录初始状态（无旧数据）
                let all_fields: Vec<String> = self.extract_field_paths(&raw_data);
                self.record_metadata_change(
                    metadata_id,
                    user_id,
                    platform_name,
                    all_fields,
                    None,
                    raw_data,
                )
                .await?;

                tracing::info!("✅ New platform metadata created (id: {})", metadata_id);
                Ok(metadata_id)
            }
        }
    }

    /// 检测两个JSON对象之间的变化
    fn detect_changes(&self, old_data: &Value, new_data: &Value) -> Vec<String> {
        let mut changed_fields = Vec::new();
        Self::compare_json("", old_data, new_data, &mut changed_fields);
        changed_fields
    }

    /// 递归比较JSON对象并记录变化的字段路径
    fn compare_json(prefix: &str, old: &Value, new: &Value, changes: &mut Vec<String>) {
        match (old, new) {
            (Value::Object(old_map), Value::Object(new_map)) => {
                // 检查新增和修改的字段
                for (key, new_val) in new_map {
                    let field_path = if prefix.is_empty() {
                        key.clone()
                    } else {
                        format!("{}.{}", prefix, key)
                    };

                    match old_map.get(key) {
                        Some(old_val) => {
                            if old_val != new_val {
                                Self::compare_json(&field_path, old_val, new_val, changes);
                            }
                        }
                        None => {
                            // 新增字段
                            changes.push(field_path);
                        }
                    }
                }

                // 检查删除的字段
                for key in old_map.keys() {
                    if !new_map.contains_key(key) {
                        let field_path = if prefix.is_empty() {
                            key.clone()
                        } else {
                            format!("{}.{}", prefix, key)
                        };
                        changes.push(format!("{} (deleted)", field_path));
                    }
                }
            }
            (Value::Array(old_arr), Value::Array(new_arr)) => {
                // 数组长度或内容变化
                if old_arr.len() != new_arr.len() {
                    changes.push(format!("{} (array length changed)", prefix));
                } else {
                    for (i, (old_item, new_item)) in old_arr.iter().zip(new_arr.iter()).enumerate()
                    {
                        let item_path = format!("{}[{}]", prefix, i);
                        if old_item != new_item {
                            Self::compare_json(&item_path, old_item, new_item, changes);
                        }
                    }
                }
            }
            _ => {
                // 基本类型变化
                if old != new {
                    changes.push(prefix.to_string());
                }
            }
        }
    }

    /// 提取JSON对象中所有字段的路径
    fn extract_field_paths(&self, data: &Value) -> Vec<String> {
        let mut paths = Vec::new();
        Self::collect_paths("", data, &mut paths);
        paths
    }

    /// 递归收集JSON路径
    fn collect_paths(prefix: &str, value: &Value, paths: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, val) in map {
                    let path = if prefix.is_empty() {
                        key.clone()
                    } else {
                        format!("{}.{}", prefix, key)
                    };
                    paths.push(path.clone());
                    Self::collect_paths(&path, val, paths);
                }
            }
            Value::Array(arr) => {
                for (i, item) in arr.iter().enumerate() {
                    let path = format!("{}[{}]", prefix, i);
                    paths.push(path.clone());
                    Self::collect_paths(&path, item, paths);
                }
            }
            _ => {}
        }
    }

    /// 记录元数据变化历史
    async fn record_metadata_change(
        &self,
        metadata_id: i32,
        user_id: i32,
        platform_name: &str,
        changed_fields: Vec<String>,
        old_data: Option<Value>,
        new_data: Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let now = Utc::now().naive_utc();
        let history = metadata_history::ActiveModel {
            metadata_id: Set(Some(metadata_id)),
            user_id: Set(user_id),
            platform_name: Set(platform_name.to_string()),
            changed_fields: Set(json!(changed_fields)),
            old_data: Set(old_data),
            new_data: Set(Some(new_data)),
            change_date: Set(now),
            ..Default::default()
        };

        history.insert(&self.db).await?;
        tracing::info!("✅ Metadata change history recorded");
        Ok(())
    }

    /// 获取最新的平台元数据
    #[allow(dead_code)]
    pub async fn get_latest_metadata(
        &self,
        user_id: i32,
        platform_name: &str,
    ) -> Result<Option<platform_metadata::Model>, Box<dyn std::error::Error>> {
        let metadata = platform_metadata::Entity::find()
            .filter(platform_metadata::Column::UserId.eq(user_id))
            .filter(platform_metadata::Column::PlatformName.eq(platform_name))
            .order_by_desc(platform_metadata::Column::FetchedAt)
            .one(&self.db)
            .await?;

        Ok(metadata)
    }

    /// 获取所有平台的最新元数据
    #[allow(dead_code)]
    pub async fn get_all_latest_metadata(
        &self,
        user_id: i32,
    ) -> Result<HashMap<String, Value>, Box<dyn std::error::Error>> {
        let all_metadata = platform_metadata::Entity::find()
            .filter(platform_metadata::Column::UserId.eq(user_id))
            .order_by_desc(platform_metadata::Column::FetchedAt)
            .all(&self.db)
            .await?;

        // 按平台分组，取最新的
        let mut result = HashMap::new();
        let mut seen_platforms = std::collections::HashSet::new();

        for metadata in all_metadata {
            if !seen_platforms.contains(&metadata.platform_name) {
                result.insert(metadata.platform_name.clone(), metadata.raw_data);
                seen_platforms.insert(metadata.platform_name);
            }
        }

        Ok(result)
    }

    /// 获取元数据变化历史
    #[allow(dead_code)]
    pub async fn get_metadata_history(
        &self,
        user_id: i32,
        platform_name: Option<&str>,
        limit: Option<u64>,
    ) -> Result<Vec<metadata_history::Model>, Box<dyn std::error::Error>> {
        use sea_orm::QuerySelect;

        let mut query = metadata_history::Entity::find()
            .filter(metadata_history::Column::UserId.eq(user_id))
            .order_by_desc(metadata_history::Column::ChangeDate);

        if let Some(platform) = platform_name {
            query = query.filter(metadata_history::Column::PlatformName.eq(platform));
        }

        if let Some(limit_val) = limit {
            query = query.limit(limit_val);
        }

        let history = query.all(&self.db).await?;
        Ok(history)
    }

    /// 获取特定元数据ID的所有变化历史
    #[allow(dead_code)]
    pub async fn get_metadata_changes_by_id(
        &self,
        metadata_id: i32,
    ) -> Result<Vec<metadata_history::Model>, Box<dyn std::error::Error>> {
        let history = metadata_history::Entity::find()
            .filter(metadata_history::Column::MetadataId.eq(metadata_id))
            .order_by_desc(metadata_history::Column::ChangeDate)
            .all(&self.db)
            .await?;

        Ok(history)
    }

    /// 统计变化次数
    #[allow(dead_code)]
    pub async fn count_changes(
        &self,
        user_id: i32,
        platform_name: Option<&str>,
    ) -> Result<u64, Box<dyn std::error::Error>> {
        let mut query =
            metadata_history::Entity::find().filter(metadata_history::Column::UserId.eq(user_id));

        if let Some(platform) = platform_name {
            query = query.filter(metadata_history::Column::PlatformName.eq(platform));
        }

        let count = query.count(&self.db).await?;
        Ok(count)
    }
}
