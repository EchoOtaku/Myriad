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
    /// 对于大型数据结构，使用迭代而非递归以避免栈溢出
    /// 🚀 优化：对超大数组（如歌曲列表）只检测数量变化，避免逐项比较导致OOM
    fn detect_changes(&self, old_data: &Value, new_data: &Value) -> Vec<String> {
        let mut changed_fields = Vec::new();

        // 🚀 内存保护：限制变化检测的总迭代次数
        const MAX_ITERATIONS: usize = 10000;

        // 使用栈模拟递归，避免栈溢出
        let mut stack: Vec<(String, &Value, &Value)> = vec![("".to_string(), old_data, new_data)];
        let max_depth = 50; // 限制最大深度
        let mut iteration_count = 0;

        while let Some((prefix, old, new)) = stack.pop() {
            iteration_count += 1;
            if iteration_count > MAX_ITERATIONS {
                // 防止无限循环或过度内存使用
                tracing::warn!(
                    "⚠️ detect_changes reached max iterations ({}), truncating comparison",
                    MAX_ITERATIONS
                );
                changed_fields.push(format!("{} (comparison truncated)", prefix));
                break;
            }

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
                                    // 限制递归深度
                                    let current_depth = field_path.matches('.').count();
                                    if current_depth < max_depth {
                                        stack.push((field_path, old_val, new_val));
                                    } else {
                                        changed_fields
                                            .push(format!("{} (deep change)", field_path));
                                    }
                                }
                            }
                            None => {
                                // 新增字段
                                changed_fields.push(field_path);
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
                            changed_fields.push(format!("{} (deleted)", field_path));
                        }
                    }
                }
                (Value::Array(old_arr), Value::Array(new_arr)) => {
                    const MAX_ARRAY_COMPARE: usize = 50; // 数组最多比较前50个元素

                    // 🚀 优化：对超大数组（>200元素）只检测长度变化
                    if old_arr.len() > 200 || new_arr.len() > 200 {
                        if old_arr.len() != new_arr.len() {
                            changed_fields.push(format!(
                                "{} (large array length: {} -> {})",
                                prefix,
                                old_arr.len(),
                                new_arr.len()
                            ));
                        } else {
                            // 对于超大数组，只标记为"可能有变化"，不深入比较
                            tracing::debug!(
                                "⚡ Skipping deep comparison for large array: {} ({} items)",
                                prefix,
                                old_arr.len()
                            );
                        }
                    } else {
                        // 中小型数组：检查长度和内容变化
                        if old_arr.len() != new_arr.len() {
                            changed_fields.push(format!(
                                "{} (array length: {} -> {})",
                                prefix,
                                old_arr.len(),
                                new_arr.len()
                            ));
                        } else {
                            // 只检查前N个元素的变化，避免处理超大数组
                            let check_count = old_arr.len().min(MAX_ARRAY_COMPARE);
                            for (i, (old_item, new_item)) in old_arr
                                .iter()
                                .zip(new_arr.iter())
                                .take(check_count)
                                .enumerate()
                            {
                                if old_item != new_item {
                                    let item_path = format!("{}[{}]", prefix, i);
                                    let current_depth = item_path.matches('.').count();
                                    if current_depth < max_depth {
                                        stack.push((item_path, old_item, new_item));
                                    } else {
                                        changed_fields.push(format!("{} (deep change)", item_path));
                                    }
                                }
                            }
                            if old_arr.len() > MAX_ARRAY_COMPARE {
                                tracing::debug!(
                                    "⚡ Array {} has {} more elements not checked",
                                    prefix,
                                    old_arr.len() - MAX_ARRAY_COMPARE
                                );
                            }
                        }
                    }
                }
                _ => {
                    // 基本类型变化
                    if old != new && !prefix.is_empty() {
                        changed_fields.push(prefix);
                    }
                }
            }
        }

        changed_fields
    }

    /// 递归比较JSON对象并记录变化的字段路径（已弃用，保留用于向后兼容）
    #[allow(dead_code)]
    fn compare_json_recursive(prefix: &str, old: &Value, new: &Value, changes: &mut Vec<String>) {
        Self::compare_json(prefix, old, new, changes, 0);
    }

    /// 递归比较JSON对象（带深度限制）
    #[allow(dead_code)]
    fn compare_json(
        prefix: &str,
        old: &Value,
        new: &Value,
        changes: &mut Vec<String>,
        depth: usize,
    ) {
        const MAX_DEPTH: usize = 30;
        if depth > MAX_DEPTH {
            changes.push(format!("{} (deep change, depth > {})", prefix, MAX_DEPTH));
            return;
        }

        match (old, new) {
            (Value::Object(old_map), Value::Object(new_map)) => {
                for (key, new_val) in new_map {
                    let field_path = if prefix.is_empty() {
                        key.clone()
                    } else {
                        format!("{}.{}", prefix, key)
                    };
                    match old_map.get(key) {
                        Some(old_val) if old_val != new_val => {
                            Self::compare_json(&field_path, old_val, new_val, changes, depth + 1);
                        }
                        None => changes.push(field_path),
                        _ => {}
                    }
                }
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
                if old_arr.len() != new_arr.len() {
                    changes.push(format!("{} (array length changed)", prefix));
                } else {
                    for (i, (old_item, new_item)) in
                        old_arr.iter().zip(new_arr.iter()).enumerate().take(50)
                    {
                        if old_item != new_item {
                            Self::compare_json(
                                &format!("{}[{}]", prefix, i),
                                old_item,
                                new_item,
                                changes,
                                depth + 1,
                            );
                        }
                    }
                }
            }
            _ if old != new => changes.push(prefix.to_string()),
            _ => {}
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
    /// 🚀 彻底优化：历史记录只保存变化字段列表和摘要，不保存完整数据
    ///
    /// 设计理念：
    /// - metadata_history 用于记录"什么字段变化了"，而不是"完整的数据是什么"
    /// - 完整数据已经保存在 platform_metadata 表中，通过 metadata_id 关联
    /// - 对于超大数据集(如1919首歌曲)，只保存统计摘要，避免OOM和数据库膨胀
    async fn record_metadata_change(
        &self,
        metadata_id: i32,
        user_id: i32,
        platform_name: &str,
        changed_fields: Vec<String>,
        old_data: Option<Value>,
        new_data: Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // 🚀 彻底方案：默认不保存完整数据，只保存变化摘要
        const MAX_SUMMARY_SIZE: usize = 50_000; // 50KB 摘要限制(远小于原来的256KB)

        let now = Utc::now().naive_utc();

        // 🚀 智能摘要策略：
        // 1. 对于小数据(<50KB)：保存完整数据
        // 2. 对于大数据(>=50KB)：只保存变化摘要，不保存完整JSON
        let new_data_size = Self::estimate_json_size(&new_data);

        let (new_data_to_save, old_data_to_save) = if new_data_size >= MAX_SUMMARY_SIZE {
            tracing::info!(
                "📊 Large metadata detected ({} bytes), saving change summary only",
                new_data_size
            );

            // 创建轻量级摘要(只包含变化统计)
            let new_summary = Self::create_change_summary(&new_data, platform_name, &changed_fields);
            let old_summary = old_data.as_ref().map(|d| {
                Self::create_change_summary(d, platform_name, &changed_fields)
            });

            (Some(new_summary), old_summary)
        } else {
            // 小数据集：保存完整数据用于详细对比
            (Some(new_data), old_data)
        };

        let history = metadata_history::ActiveModel {
            metadata_id: Set(Some(metadata_id)),
            user_id: Set(user_id),
            platform_name: Set(platform_name.to_string()),
            changed_fields: Set(json!(changed_fields)),
            old_data: Set(old_data_to_save),
            new_data: Set(new_data_to_save),
            change_date: Set(now),
            ..Default::default()
        };

        history.insert(&self.db).await?;
        tracing::info!("✅ Metadata change history recorded (summary mode: {})", new_data_size >= MAX_SUMMARY_SIZE);
        Ok(())
    }

    /// 估算 JSON 数据的大小（不进行实际序列化，避免OOM）
    /// 采用递归深度优先遍历，计算结构大小
    fn estimate_json_size(value: &Value) -> usize {
        const MAX_DEPTH: usize = 50;
        Self::estimate_json_size_recursive(value, 0, MAX_DEPTH)
    }

    /// 递归估算 JSON 大小
    fn estimate_json_size_recursive(value: &Value, depth: usize, max_depth: usize) -> usize {
        if depth > max_depth {
            return 100; // 深度过大，返回固定估值
        }

        match value {
            Value::Null => 4,  // "null"
            Value::Bool(_) => 5,  // "true" or "false"
            Value::Number(n) => n.to_string().len(),
            Value::String(s) => s.len() + 2,  // 包含引号
            Value::Array(arr) => {
                let mut size = 2;  // []
                for (i, item) in arr.iter().enumerate() {
                    if i > 0 {
                        size += 1;  // 逗号
                    }
                    // 🚀 优化：对超大数组(>100元素)进行采样估算，避免遍历全部
                    if i < 100 {
                        size += Self::estimate_json_size_recursive(item, depth + 1, max_depth);
                    } else {
                        // 采样前100个元素的平均大小，推断剩余元素
                        let sample_avg = size / 100;
                        size += sample_avg * (arr.len() - 100);
                        break;
                    }
                }
                size
            }
            Value::Object(map) => {
                let mut size = 2;  // {}
                for (i, (key, val)) in map.iter().enumerate() {
                    if i > 0 {
                        size += 1;  // 逗号
                    }
                    size += key.len() + 3;  // "key":
                    size += Self::estimate_json_size_recursive(val, depth + 1, max_depth);
                }
                size
            }
        }
    }

    /// 创建轻量级变化摘要（只包含统计信息，不包含完整数据）
    /// 🚀 这是最彻底的方案：只记录"变化了什么"，而不是"数据是什么"
    fn create_change_summary(data: &Value, platform_name: &str, changed_fields: &[String]) -> Value {
        match platform_name {
            "netease" => {
                json!({
                    "_type": "change_summary",
                    "_note": "Lightweight summary - full data in platform_metadata table",
                    "changed_fields_count": changed_fields.len(),
                    "profile_exists": data.get("profile").is_some(),
                    "liked_songs_count": data.get("liked_songs")
                        .and_then(|s| s.as_array())
                        .map(|arr| arr.len())
                        .unwrap_or(0),
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })
            }
            "steam" => {
                json!({
                    "_type": "change_summary",
                    "_note": "Lightweight summary - full data in platform_metadata table",
                    "changed_fields_count": changed_fields.len(),
                    "games_count": data.get("games")
                        .and_then(|g| g.as_array())
                        .map(|arr| arr.len())
                        .unwrap_or(0),
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })
            }
            "bilibili" => {
                json!({
                    "_type": "change_summary",
                    "_note": "Lightweight summary - full data in platform_metadata table",
                    "changed_fields_count": changed_fields.len(),
                    "videos_count": data.get("videos")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.len())
                        .unwrap_or(0),
                    "bangumi_count": data.get("bangumi")
                        .and_then(|b| b.as_array())
                        .map(|arr| arr.len())
                        .unwrap_or(0),
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })
            }
            "github" => {
                json!({
                    "_type": "change_summary",
                    "_note": "Lightweight summary - full data in platform_metadata table",
                    "changed_fields_count": changed_fields.len(),
                    "repos_count": data.get("repos")
                        .and_then(|r| r.as_array())
                        .map(|arr| arr.len())
                        .unwrap_or(0),
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })
            }
            _ => {
                json!({
                    "_type": "change_summary",
                    "_note": "Lightweight summary - full data in platform_metadata table",
                    "changed_fields_count": changed_fields.len(),
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })
            }
        }
    }

    /// 创建数据摘要（用于超大数据集）
    /// 注意：这个函数已被 create_change_summary 取代，保留用于向后兼容
    #[allow(dead_code)]
    fn create_data_summary(data: &Value, platform_name: &str) -> Value {
        match platform_name {
            "netease" => {
                // 网易云音乐：只保留用户信息和歌曲数量统计
                let mut summary = json!({
                    "_summary": true,
                    "_note": "Data truncated due to large size"
                });

                if let Some(profile) = data.get("profile") {
                    summary["profile"] = profile.clone();
                }

                if let Some(liked_songs) = data.get("liked_songs").and_then(|s| s.as_array()) {
                    let total_count = liked_songs.len();
                    // 🚀 优化：只保存前5首作为样本,减少克隆开销
                    let sample_songs: Vec<_> = liked_songs.iter().take(5).cloned().collect();

                    summary["liked_songs_summary"] = json!({
                        "total_count": total_count,
                        "sample_songs": sample_songs,
                        "_truncated": total_count > 5,
                        "_note": "Only showing first 5 songs for memory efficiency"
                    });
                }

                summary
            }
            "steam" => {
                // Steam：保留用户信息和游戏统计
                let mut summary = json!({
                    "_summary": true,
                    "_note": "Data truncated due to large size"
                });

                if let Some(user) = data.get("user") {
                    summary["user"] = user.clone();
                }

                if let Some(games) = data.get("games").and_then(|g| g.as_array()) {
                    summary["games_summary"] = json!({
                        "total_count": games.len(),
                        "top_10_by_playtime": games.iter().take(10).cloned().collect::<Vec<_>>()
                    });
                }

                summary
            }
            _ => {
                // 其他平台：通用截断策略
                json!({
                    "_summary": true,
                    "_note": "Data truncated due to large size",
                    "_original_size_estimate": serde_json::to_string(data).unwrap_or_default().len()
                })
            }
        }
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
