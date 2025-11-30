use crate::models::entities::platform_metadata;
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SaveProgress {
    pub total_chunks: usize,
    pub saved_chunks: usize,
    pub status: String,
}

pub struct BatchSaver {
    db: DatabaseConnection,
    // 保存进度跟踪: task_id -> progress
    progress_map: Arc<RwLock<HashMap<String, SaveProgress>>>,
}

impl BatchSaver {
    pub fn new(db: DatabaseConnection) -> Self {
        Self {
            db,
            progress_map: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 🚀 分批保存平台元数据(异步)
    ///
    /// 策略:
    /// 1. 主记录立即保存(前100首)
    /// 2. 后台任务分批保存剩余chunks
    ///
    /// 参数:
    /// - user_id: 用户ID
    /// - platform_name: 平台名称(如"netease")
    /// - full_data: 完整数据(如包含1919首歌曲)
    /// - chunk_size: 每批大小(默认100)
    pub async fn save_large_metadata_batched(
        &self,
        user_id: i32,
        platform_name: &str,
        full_data: Value,
        chunk_size: usize,
    ) -> Result<(i32, String), Box<dyn std::error::Error>> {
        let now = Utc::now().naive_utc();

        // 1. 检查是否需要分批(检测liked_songs数组大小)
        let (needs_chunking, total_songs) =
            if let Some(songs) = full_data.get("liked_songs").and_then(|s| s.as_array()) {
                (songs.len() > chunk_size, songs.len())
            } else {
                (false, 0)
            };

        if !needs_chunking {
            // 数据量小,直接保存
            tracing::info!("✓ Small metadata, saving directly");
            let new_metadata = platform_metadata::ActiveModel {
                user_id: Set(user_id),
                platform_name: Set(platform_name.to_string()),
                raw_data: Set(full_data),
                fetched_at: Set(now),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            };
            let inserted = new_metadata.insert(&self.db).await?;
            return Ok((inserted.id, "completed".to_string()));
        }

        // 2. 需要分批保存
        tracing::info!(
            "🚀 Large metadata detected ({} songs), using chunked save",
            total_songs
        );

        // 2.1 创建主记录(只包含前chunk_size首歌曲)
        let mut main_data = full_data.clone();
        if let Some(songs) = main_data
            .get_mut("liked_songs")
            .and_then(|s| s.as_array_mut())
        {
            songs.truncate(chunk_size);
        }

        // 添加分片元数据
        if let Some(obj) = main_data.as_object_mut() {
            obj.insert("_chunked".to_string(), json!(true));
            obj.insert("_total_songs".to_string(), json!(total_songs));
            obj.insert("_chunk_size".to_string(), json!(chunk_size));
        }

        let main_record = platform_metadata::ActiveModel {
            user_id: Set(user_id),
            platform_name: Set(platform_name.to_string()),
            raw_data: Set(main_data),
            fetched_at: Set(now),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };

        let inserted = main_record.insert(&self.db).await?;
        let metadata_id = inserted.id;

        tracing::info!("✅ Main record saved (id: {})", metadata_id);

        // 2.2 启动后台任务保存剩余chunks
        let task_id = format!("{}_{}", platform_name, Utc::now().timestamp_millis());
        let db_clone = self.db.clone();
        let progress_map_clone = self.progress_map.clone();
        let full_data_arc = Arc::new(full_data); // 使用Arc避免大数据克隆
        let platform_name_clone = platform_name.to_string();

        // 计算总chunk数（向上取整），再减去主记录
        let total_chunks = total_songs.div_ceil(chunk_size) - 1; // 减去主记录

        // 初始化进度
        {
            let mut progress = progress_map_clone.write().await;
            progress.insert(
                task_id.clone(),
                SaveProgress {
                    total_chunks,
                    saved_chunks: 0,
                    status: "processing".to_string(),
                },
            );
        }

        // 在后台保存剩余chunks
        let task_id_for_return = task_id.clone();
        tokio::spawn(async move {
            if let Err(e) = Self::save_chunks_background(
                db_clone,
                progress_map_clone,
                task_id,
                user_id,
                &platform_name_clone,
                full_data_arc,
                chunk_size,
            )
            .await
            {
                tracing::error!("❌ Background chunk save failed: {}", e);
            }
        });

        Ok((metadata_id, task_id_for_return))
    }

    /// 后台任务:保存剩余的chunks（使用Arc避免大数据克隆）
    async fn save_chunks_background(
        db: DatabaseConnection,
        progress_map: Arc<RwLock<HashMap<String, SaveProgress>>>,
        task_id: String,
        user_id: i32,
        platform_name: &str,
        full_data: Arc<Value>, // 使用Arc避免克隆
        chunk_size: usize,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let songs = full_data
            .get("liked_songs")
            .and_then(|s| s.as_array())
            .ok_or("No liked_songs array")?;

        let total_songs = songs.len();
        let mut saved_chunks = 0;

        // 从第二个chunk开始(第一个已在主记录中)
        for chunk_idx in 1..(total_songs.div_ceil(chunk_size)) {
            let start = chunk_idx * chunk_size;
            let end = std::cmp::min(start + chunk_size, total_songs);

            if start >= total_songs {
                break;
            }

            // 创建chunk数据
            let chunk_songs: Vec<Value> = songs[start..end].to_vec();
            let chunk_data = json!({
                "chunk_index": chunk_idx,
                "songs": chunk_songs,
                "range": format!("{}-{}", start, end - 1)
            });

            // 保存chunk
            let now = Utc::now().naive_utc();
            let chunk_record = platform_metadata::ActiveModel {
                user_id: Set(user_id),
                platform_name: Set(format!("{}_chunk_{}", platform_name, chunk_idx)),
                raw_data: Set(chunk_data),
                fetched_at: Set(now),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            };

            chunk_record.insert(&db).await?;

            saved_chunks += 1;

            // 更新进度
            {
                let mut progress = progress_map.write().await;
                if let Some(p) = progress.get_mut(&task_id) {
                    p.saved_chunks = saved_chunks;
                }
            }

            tracing::info!(
                "✓ Chunk {} saved ({}-{}), progress: {}/{}",
                chunk_idx,
                start,
                end - 1,
                saved_chunks,
                total_songs.div_ceil(chunk_size) - 1
            );

            // 添加短暂延迟,避免数据库压力
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        // 标记完成
        {
            let mut progress = progress_map.write().await;
            if let Some(p) = progress.get_mut(&task_id) {
                p.status = "completed".to_string();
            }
        }

        tracing::info!("✅ All chunks saved for task: {}", task_id);
        Ok(())
    }

    /// 查询保存进度
    #[allow(dead_code)]
    pub async fn get_save_progress(&self, task_id: &str) -> Option<SaveProgress> {
        let progress = self.progress_map.read().await;
        progress.get(task_id).cloned()
    }

    /// 🔍 读取完整的分片数据
    ///
    /// 从主记录和所有chunk记录中合并数据
    #[allow(dead_code)]
    pub async fn load_chunked_metadata(
        &self,
        user_id: i32,
        platform_name: &str,
    ) -> Result<Option<Value>, Box<dyn std::error::Error>> {
        // 1. 读取主记录
        let main_record = platform_metadata::Entity::find()
            .filter(platform_metadata::Column::UserId.eq(user_id))
            .filter(platform_metadata::Column::PlatformName.eq(platform_name))
            .one(&self.db)
            .await?;

        let Some(main) = main_record else {
            return Ok(None);
        };

        let mut full_data = main.raw_data.clone();

        // 2. 检查是否有chunks
        let is_chunked = full_data
            .get("_chunked")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if !is_chunked {
            return Ok(Some(full_data));
        }

        // 3. 读取所有chunk记录
        let chunk_prefix = format!("{}_chunk_", platform_name);
        let chunks = platform_metadata::Entity::find()
            .filter(platform_metadata::Column::UserId.eq(user_id))
            .filter(platform_metadata::Column::PlatformName.contains(&chunk_prefix))
            .all(&self.db)
            .await?;

        // 4. 合并所有chunks的songs
        if let Some(main_songs) = full_data
            .get_mut("liked_songs")
            .and_then(|s| s.as_array_mut())
        {
            for chunk in chunks {
                if let Some(chunk_songs) = chunk.raw_data.get("songs").and_then(|s| s.as_array()) {
                    main_songs.extend_from_slice(chunk_songs);
                }
            }
        }

        Ok(Some(full_data))
    }
}
