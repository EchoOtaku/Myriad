//! Agent 混合记忆系统 (v2 — TF-IDF 语义搜索)
//!
//! 三级记忆架构：
//! - **ShortTerm**：当前对话上下文（高衰减，session 结束后归档）
//! - **MediumTerm**：会话摘要、近期交互模式（天级留存）
//! - **LongTerm**：用户偏好、重要事实、关键决策（永久）
//!
//! 搜索采用 TF-IDF 余弦相似度 + 时间衰减 + 重要性权重的复合评分，
//! 无需外部 embedding 模型，零依赖。
//!
//! 持久化：
//! - `memory.md`：人类可读的长期记忆（向后兼容）
//! - `memory_index.json`：完整索引状态（快速恢复）
//! - `YYYY-MM-DD.md`：每日交互日志（追加写入）

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

// ==================== 类型定义 ====================

/// 记忆条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    /// 唯一 ID（内容 hash）
    pub id: String,
    /// 记忆类型
    pub memory_type: MemoryType,
    /// 记忆层级
    #[serde(default = "default_tier")]
    pub tier: MemoryTier,
    /// 记忆内容
    pub content: String,
    /// 来源描述
    pub source: Option<String>,
    /// 重要性 (0.0 - 1.0)
    #[serde(default = "default_importance")]
    pub importance: f32,
    /// 访问次数
    #[serde(default)]
    pub access_count: u32,
    /// 创建时间
    pub created_at: String,
    /// 最后访问时间
    #[serde(default)]
    pub last_accessed_at: Option<String>,
}

fn default_tier() -> MemoryTier {
    MemoryTier::LongTerm
}
fn default_importance() -> f32 {
    0.5
}

/// 记忆类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    /// 用户偏好
    Preference,
    /// 事实性记忆
    Fact,
    /// 交互记录
    Interaction,
    /// 决策记录
    Decision,
    /// 会话摘要（由 consolidate 生成）
    SessionSummary,
}

/// 记忆层级
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryTier {
    /// 当前对话上下文（ephemeral）
    ShortTerm,
    /// 会话摘要、近期模式（天级留存）
    MediumTerm,
    /// 永久事实、偏好、决策
    LongTerm,
}

// ==================== TF-IDF 搜索索引 ====================

/// 轻量级 TF-IDF 索引
///
/// 对中英文混合文本做 token 化，支持 CJK bigram + 拉丁单词分词。
/// 设计目标：百级文档集上的毫秒级搜索，零外部依赖。
struct TfIdfIndex {
    /// doc_id → { term → tf }
    tf: HashMap<String, HashMap<String, f32>>,
    /// term → idf
    idf: HashMap<String, f32>,
    /// 文档总数
    doc_count: usize,
}

impl TfIdfIndex {
    fn new() -> Self {
        Self {
            tf: HashMap::new(),
            idf: HashMap::new(),
            doc_count: 0,
        }
    }

    /// 中文高频停用词（过滤以提升 TF-IDF 质量）
    const CJK_STOP_CHARS: &'static [char] = &[
        '的', '了', '是', '在', '和', '与', '也', '就', '都', '而', '及', '着',
        '或', '一', '不', '有', '这', '那', '个', '为', '以', '到', '对', '被',
        '从', '把', '让', '给', '向', '但', '又', '要', '会', '能', '可', '很',
    ];

    /// 对文本做 token 化
    ///
    /// 策略：拉丁文按空格分词并 lowercase，CJK 按字符 bigram 切分，过滤停用词
    fn tokenize(text: &str) -> Vec<String> {
        let text_lower = text.to_lowercase();
        let mut tokens = Vec::new();
        let mut latin_buf = String::new();
        let stop_set: std::collections::HashSet<char> =
            Self::CJK_STOP_CHARS.iter().cloned().collect();

        for ch in text_lower.chars() {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                latin_buf.push(ch);
            } else {
                // flush latin
                if latin_buf.len() >= 2 {
                    tokens.push(latin_buf.clone());
                }
                latin_buf.clear();

                // CJK character → 单字 token（过滤停用词）
                if is_cjk(ch) && !stop_set.contains(&ch) {
                    tokens.push(ch.to_string());
                }
            }
        }
        if latin_buf.len() >= 2 {
            tokens.push(latin_buf);
        }

        // CJK bigram（仅当两个字符都非停用词时生成）
        let cjk_chars: Vec<char> = text_lower
            .chars()
            .filter(|c| is_cjk(*c) && !stop_set.contains(c))
            .collect();
        for window in cjk_chars.windows(2) {
            tokens.push(format!("{}{}", window[0], window[1]));
        }

        tokens
    }

    /// 添加文档到索引
    fn add_document(&mut self, doc_id: &str, text: &str) {
        let tokens = Self::tokenize(text);
        if tokens.is_empty() {
            return;
        }

        let total = tokens.len() as f32;
        let mut term_freq: HashMap<String, f32> = HashMap::new();
        for token in &tokens {
            *term_freq.entry(token.clone()).or_default() += 1.0;
        }
        // normalize TF
        for v in term_freq.values_mut() {
            *v /= total;
        }

        self.tf.insert(doc_id.to_string(), term_freq);
        self.doc_count += 1;
    }

    /// 移除文档
    fn remove_document(&mut self, doc_id: &str) {
        if self.tf.remove(doc_id).is_some() {
            self.doc_count = self.doc_count.saturating_sub(1);
        }
    }

    /// 重建 IDF（在批量 add/remove 之后调用）
    fn rebuild_idf(&mut self) {
        let n = self.doc_count.max(1) as f32;
        let mut df: HashMap<String, u32> = HashMap::new();

        for term_freqs in self.tf.values() {
            for term in term_freqs.keys() {
                *df.entry(term.clone()).or_default() += 1;
            }
        }

        self.idf.clear();
        for (term, count) in df {
            // IDF = ln(N / df) + 1 (smoothed)
            self.idf
                .insert(term, (n / count as f32).ln() + 1.0);
        }
    }

    /// 计算 query 与文档的 TF-IDF 余弦相似度
    fn similarity(&self, query_tokens: &[String], doc_id: &str) -> f32 {
        let Some(doc_tf) = self.tf.get(doc_id) else {
            return 0.0;
        };

        // query TF
        let q_total = query_tokens.len().max(1) as f32;
        let mut query_tf: HashMap<&str, f32> = HashMap::new();
        for t in query_tokens {
            *query_tf.entry(t.as_str()).or_default() += 1.0 / q_total;
        }

        // dot product + magnitudes
        let mut dot = 0.0f32;
        let mut q_mag = 0.0f32;
        let mut d_mag = 0.0f32;

        // 收集所有出现的 term
        let mut all_terms: Vec<&str> = Vec::new();
        for t in query_tf.keys() {
            all_terms.push(t);
        }
        for t in doc_tf.keys() {
            if !query_tf.contains_key(t.as_str()) {
                all_terms.push(t.as_str());
            }
        }

        for term in all_terms {
            let idf = self.idf.get(term).copied().unwrap_or(1.0);
            let q_w = query_tf.get(term).copied().unwrap_or(0.0) * idf;
            let d_w = doc_tf.get(term).copied().unwrap_or(0.0) * idf;

            dot += q_w * d_w;
            q_mag += q_w * q_w;
            d_mag += d_w * d_w;
        }

        let magnitude = (q_mag * d_mag).sqrt();
        if magnitude < 1e-10 {
            return 0.0;
        }
        dot / magnitude
    }

    /// 搜索：返回 (doc_id, similarity_score) 降序
    fn search(&self, query: &str, limit: usize) -> Vec<(String, f32)> {
        let tokens = Self::tokenize(query);
        if tokens.is_empty() {
            return Vec::new();
        }

        let mut results: Vec<(String, f32)> = self
            .tf
            .keys()
            .map(|doc_id| {
                let score = self.similarity(&tokens, doc_id);
                (doc_id.clone(), score)
            })
            .filter(|(_, score)| *score > 0.0)
            .collect();

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(limit);
        results
    }
}

/// CJK unicode 范围检测
fn is_cjk(ch: char) -> bool {
    matches!(ch,
        '\u{4E00}'..='\u{9FFF}'   // CJK Unified Ideographs
        | '\u{3400}'..='\u{4DBF}' // CJK Extension A
        | '\u{3040}'..='\u{309F}' // Hiragana
        | '\u{30A0}'..='\u{30FF}' // Katakana
        | '\u{AC00}'..='\u{D7AF}' // Hangul
    )
}

// ==================== 复合评分 ====================

/// 召回查询参数
pub struct RecallQuery {
    pub query: String,
    pub limit: usize,
    /// 仅搜索指定层级（None = 全部）
    pub tier_filter: Option<Vec<MemoryTier>>,
    /// 仅搜索指定类型（None = 全部）
    pub type_filter: Option<Vec<MemoryType>>,
    /// 语义相似度权重
    pub similarity_weight: f32,
    /// 时间衰减权重
    pub recency_weight: f32,
    /// 重要性权重
    pub importance_weight: f32,
}

impl Default for RecallQuery {
    fn default() -> Self {
        Self {
            query: String::new(),
            limit: 5,
            tier_filter: None,
            type_filter: None,
            similarity_weight: 0.5,
            recency_weight: 0.3,
            importance_weight: 0.2,
        }
    }
}

/// 计算时间衰减分：越新越高
fn recency_score(created_at: &str) -> f32 {
    let hours_ago = chrono::DateTime::parse_from_rfc3339(created_at)
        .map(|dt| (Utc::now() - dt.with_timezone(&Utc)).num_hours().max(0) as f32)
        .unwrap_or(720.0); // 默认 30 天前
    1.0 / (1.0 + hours_ago / 24.0)
}

// ==================== AgentMemory 主结构 ====================

/// Agent 记忆管理器 (v2)
pub struct AgentMemory {
    /// 记忆文件目录
    memory_dir: PathBuf,
    /// 全部记忆条目 (id → entry)
    entries: RwLock<HashMap<String, MemoryEntry>>,
    /// TF-IDF 搜索索引
    index: RwLock<TfIdfIndex>,
}

/// 索引文件名
const INDEX_FILE: &str = "memory_index.json";

impl AgentMemory {
    /// 创建记忆管理器（异步加载持久化状态）
    pub async fn new(memory_dir: PathBuf) -> Self {
        let _ = tokio::fs::create_dir_all(&memory_dir).await;

        let entries = Self::load_entries(&memory_dir).await;
        let mut idx = TfIdfIndex::new();
        for (id, entry) in &entries {
            idx.add_document(id, &entry.content);
        }
        idx.rebuild_idf();

        let count = entries.len();
        let manager = Self {
            memory_dir,
            entries: RwLock::new(entries),
            index: RwLock::new(idx),
        };

        if count > 0 {
            tracing::info!("[AgentMemory] Loaded {} memories (TF-IDF indexed)", count);
        }

        manager
    }

    // ==================== 写入 ====================

    /// 记住一条记忆
    pub async fn remember(&self, content: &str, memory_type: MemoryType) {
        self.remember_with_tier(content, memory_type, MemoryTier::LongTerm, 0.5)
            .await;
    }

    /// 记住一条记忆（带层级和重要性）
    pub async fn remember_with_tier(
        &self,
        content: &str,
        memory_type: MemoryType,
        tier: MemoryTier,
        importance: f32,
    ) {
        let id = Self::make_id(content);

        let entry = MemoryEntry {
            id: id.clone(),
            memory_type,
            tier,
            content: content.to_string(),
            source: Some("agent".to_string()),
            importance: importance.clamp(0.0, 1.0),
            access_count: 0,
            created_at: Utc::now().to_rfc3339(),
            last_accessed_at: None,
        };

        // 更新索引
        {
            let mut idx = self.index.write().await;
            idx.add_document(&id, content);
            idx.rebuild_idf();
        }

        // 更新条目
        {
            let mut entries = self.entries.write().await;
            entries.insert(id, entry);
        }

        // 持久化
        self.save_all().await;
    }

    /// 追加今日日志
    pub async fn log_daily(&self, user_id: i32, entry: &str) {
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let log_path = self.memory_dir.join(format!("{}.md", today));

        let timestamp = Utc::now().format("%H:%M:%S").to_string();
        let log_line = format!("\n- [{}] user:{} — {}\n", timestamp, user_id, entry);

        if !log_path.exists() {
            let header = format!("# Agent Daily Log - {}\n", today);
            let _ = tokio::fs::write(&log_path, header).await;
        }

        use tokio::io::AsyncWriteExt;
        if let Ok(mut file) = tokio::fs::OpenOptions::new()
            .append(true)
            .open(&log_path)
            .await
        {
            let _ = file.write_all(log_line.as_bytes()).await;
        }
    }

    /// 归档会话摘要到 MediumTerm 记忆
    ///
    /// 在会话结束或切换时调用，将对话要点浓缩为一条 SessionSummary。
    pub async fn consolidate_session(&self, summary: &str) {
        if summary.trim().is_empty() {
            return;
        }
        self.remember_with_tier(summary, MemoryType::SessionSummary, MemoryTier::MediumTerm, 0.6)
            .await;
    }

    /// 提升高频访问的 MediumTerm 记忆到 LongTerm
    ///
    /// 阈值：access_count >= 3 的 MediumTerm 条目自动升级。
    pub async fn promote_memories(&self) -> usize {
        let mut promoted = 0;
        {
            let mut entries = self.entries.write().await;
            for entry in entries.values_mut() {
                if entry.tier == MemoryTier::MediumTerm && entry.access_count >= 3 {
                    entry.tier = MemoryTier::LongTerm;
                    entry.importance = (entry.importance + 0.1).min(1.0);
                    promoted += 1;
                }
            }
        }
        if promoted > 0 {
            tracing::info!(
                "[AgentMemory] Promoted {} memories to LongTerm",
                promoted
            );
            self.save_all().await;
        }
        promoted
    }

    // ==================== 列举 ====================

    /// 列出最近的记忆条目（按创建时间降序，排除 ShortTerm）
    pub async fn list_recent(&self, limit: usize) -> Vec<MemoryEntry> {
        let entries = self.entries.read().await;
        let mut recent: Vec<&MemoryEntry> = entries
            .values()
            .filter(|e| e.tier != MemoryTier::ShortTerm)
            .collect();
        recent.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        recent.truncate(limit);
        recent.into_iter().cloned().collect()
    }

    // ==================== 搜索 ====================

    /// 召回相关记忆（简单接口，向后兼容）
    #[allow(dead_code)]
    pub async fn recall(&self, query: &str, limit: usize) -> Vec<MemoryEntry> {
        self.recall_with_params(RecallQuery {
            query: query.to_string(),
            limit,
            ..Default::default()
        })
        .await
    }

    /// 召回相关记忆（完整参数）
    pub async fn recall_with_params(&self, params: RecallQuery) -> Vec<MemoryEntry> {
        if params.query.is_empty() {
            return Vec::new();
        }

        // TF-IDF 搜索 — 拿多一些候选做后续过滤
        let tfidf_results = {
            let idx = self.index.read().await;
            idx.search(&params.query, params.limit * 3)
        };

        let entries = self.entries.read().await;

        let mut scored: Vec<(f32, String)> = tfidf_results
            .into_iter()
            .filter_map(|(id, sim_score)| {
                let entry = entries.get(&id)?;

                // 层级过滤
                if let Some(ref tiers) = params.tier_filter {
                    if !tiers.contains(&entry.tier) {
                        return None;
                    }
                }
                // 类型过滤
                if let Some(ref types) = params.type_filter {
                    if !types.contains(&entry.memory_type) {
                        return None;
                    }
                }

                // 复合评分（LongTerm 记忆降低时间衰减权重，确保持久知识不因时间被低估）
                let r_score = recency_score(&entry.created_at);
                let (sim_w, rec_w, imp_w) = if entry.tier == MemoryTier::LongTerm {
                    (0.6, 0.1, 0.3) // LongTerm: 重语义+重要性，轻时间
                } else {
                    (params.similarity_weight, params.recency_weight, params.importance_weight)
                };
                let final_score = sim_w * sim_score
                    + rec_w * r_score
                    + imp_w * entry.importance;

                Some((final_score, id))
            })
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(params.limit);

        // 更新 access_count (不阻塞返回)
        let hit_ids: Vec<String> = scored.iter().map(|(_, id)| id.clone()).collect();
        drop(entries);

        // 收集结果
        let entries = self.entries.read().await;
        let results: Vec<MemoryEntry> = scored
            .iter()
            .filter_map(|(_, id)| entries.get(id).cloned())
            .collect();
        drop(entries);

        // 异步更新 access_count
        if !hit_ids.is_empty() {
            let mut entries = self.entries.write().await;
            let now = Utc::now().to_rfc3339();
            for id in &hit_ids {
                if let Some(entry) = entries.get_mut(id) {
                    entry.access_count += 1;
                    entry.last_accessed_at = Some(now.clone());
                }
            }
        }

        results
    }

    // ==================== 清理 ====================

    /// 清理旧日志（保留最近 N 天）
    pub async fn cleanup_old_logs(&self, keep_days: i64) {
        let cutoff = Utc::now().date_naive() - chrono::Duration::days(keep_days);

        let mut dir = match tokio::fs::read_dir(&self.memory_dir).await {
            Ok(d) => d,
            Err(_) => return,
        };

        while let Ok(Some(entry)) = dir.next_entry().await {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.len() == 13 && file_name.ends_with(".md") {
                if let Ok(date) = NaiveDate::parse_from_str(&file_name[..10], "%Y-%m-%d") {
                    if date < cutoff {
                        let _ = tokio::fs::remove_file(entry.path()).await;
                    }
                }
            }
        }
    }

    /// 清理过期的 ShortTerm 记忆（超过 2 小时）
    pub async fn cleanup_short_term(&self) -> usize {
        let cutoff = Utc::now() - chrono::Duration::hours(2);
        let mut removed = Vec::new();

        {
            let entries = self.entries.read().await;
            for (id, entry) in entries.iter() {
                if entry.tier == MemoryTier::ShortTerm {
                    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&entry.created_at) {
                        if dt.with_timezone(&Utc) < cutoff {
                            removed.push(id.clone());
                        }
                    }
                }
            }
        }

        let count = removed.len();
        if !removed.is_empty() {
            let mut entries = self.entries.write().await;
            let mut idx = self.index.write().await;
            for id in &removed {
                entries.remove(id);
                idx.remove_document(id);
            }
            idx.rebuild_idf();
        }
        count
    }

    // ==================== 持久化 ====================

    /// 生成确定性 ID（基于内容 hash）
    fn make_id(content: &str) -> String {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        content.hash(&mut hasher);
        let now = Utc::now().timestamp_millis();
        format!("mem_{:016x}_{:x}", hasher.finish(), now & 0xFFFF)
    }

    /// 加载全部记忆条目
    async fn load_entries(memory_dir: &PathBuf) -> HashMap<String, MemoryEntry> {
        // 优先从 memory_index.json 快速恢复
        let index_path = memory_dir.join(INDEX_FILE);
        if let Ok(content) = tokio::fs::read_to_string(&index_path).await {
            if let Ok(entries) = serde_json::from_str::<Vec<MemoryEntry>>(&content) {
                return entries.into_iter().map(|e| (e.id.clone(), e)).collect();
            }
        }

        // fallback: 从 memory.md 迁移
        let memory_path = memory_dir.join("memory.md");
        if let Ok(content) = tokio::fs::read_to_string(&memory_path).await {
            let entries = Self::parse_memory_md(&content);
            if !entries.is_empty() {
                tracing::info!(
                    "[AgentMemory] Migrated {} entries from memory.md",
                    entries.len()
                );
            }
            return entries.into_iter().map(|e| (e.id.clone(), e)).collect();
        }

        HashMap::new()
    }

    /// 保存全部状态（memory_index.json + memory.md）
    async fn save_all(&self) {
        let entries = self.entries.read().await;

        // 1. memory_index.json（完整快速恢复）
        let all_entries: Vec<&MemoryEntry> = entries.values().collect();
        if let Ok(json) = serde_json::to_string_pretty(&all_entries) {
            let index_path = self.memory_dir.join(INDEX_FILE);
            let _ = tokio::fs::write(&index_path, json).await;
        }

        // 2. memory.md（人类可读 — 仅 LongTerm）
        let mut md = String::from("# Agent Long-term Memory\n\n");
        let mut long_term: Vec<&MemoryEntry> = entries
            .values()
            .filter(|e| e.tier == MemoryTier::LongTerm)
            .collect();
        long_term.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        for entry in long_term {
            let type_str = match entry.memory_type {
                MemoryType::Preference => "preference",
                MemoryType::Fact => "fact",
                MemoryType::Interaction => "interaction",
                MemoryType::Decision => "decision",
                MemoryType::SessionSummary => "session",
            };
            md.push_str(&format!(
                "- [{}] [{}] {}\n",
                entry.created_at, type_str, entry.content
            ));
        }

        let memory_path = self.memory_dir.join("memory.md");
        let _ = tokio::fs::write(&memory_path, md).await;
    }

    /// 解析旧版 memory.md 格式（迁移用）
    fn parse_memory_md(content: &str) -> Vec<MemoryEntry> {
        content
            .lines()
            .filter(|line| line.starts_with("- ["))
            .filter_map(|line| {
                let rest = line.strip_prefix("- [")?;
                let ts_end = rest.find(']')?;
                let created_at = rest[..ts_end].to_string();
                let rest = rest[ts_end + 1..].trim_start();

                let rest = rest.strip_prefix('[')?;
                let type_end = rest.find(']')?;
                let type_str = &rest[..type_end];
                let content = rest[type_end + 1..].trim().to_string();

                let memory_type = match type_str {
                    "preference" => MemoryType::Preference,
                    "fact" => MemoryType::Fact,
                    "interaction" => MemoryType::Interaction,
                    "decision" => MemoryType::Decision,
                    "session" => MemoryType::SessionSummary,
                    _ => MemoryType::Fact,
                };

                let id = Self::make_id(&content);

                Some(MemoryEntry {
                    id,
                    memory_type,
                    tier: MemoryTier::LongTerm,
                    content,
                    source: Some("file".to_string()),
                    importance: 0.5,
                    access_count: 0,
                    created_at,
                    last_accessed_at: None,
                })
            })
            .collect()
    }
}

// ==================== 全局实例 ====================

static AGENT_MEMORY: once_cell::sync::OnceCell<Arc<AgentMemory>> =
    once_cell::sync::OnceCell::new();

/// 初始化全局记忆管理器（含后台维护 worker）
pub async fn init_memory(memory_dir: PathBuf) {
    let memory = Arc::new(AgentMemory::new(memory_dir).await);
    let _ = AGENT_MEMORY.set(memory.clone());

    // 后台维护：每 10 分钟清理过期短期记忆 + 提升高频记忆
    tokio::spawn(async move {
        let interval = tokio::time::Duration::from_secs(10 * 60);
        loop {
            tokio::time::sleep(interval).await;
            let cleaned = memory.cleanup_short_term().await;
            let promoted = memory.promote_memories().await;
            if cleaned > 0 || promoted > 0 {
                tracing::info!(
                    cleaned = cleaned,
                    promoted = promoted,
                    "[Memory] Background maintenance completed"
                );
            }
        }
    });
}

/// 获取全局记忆管理器
pub fn get_memory() -> Option<&'static Arc<AgentMemory>> {
    AGENT_MEMORY.get()
}
