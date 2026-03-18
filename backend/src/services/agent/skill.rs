//! 动态 Skill 系统
//!
//! Skills 是 Markdown 文件定义的能力编排模板。
//! 支持热加载、渐进式披露、以及未来的 Agent 自动创建。
//!
//! Skill 本质是已有能力（68 个硬编码 + http.fetch 扩展）的编排模板，
//! 不创建新能力，而是定义如何组合现有能力完成特定任务。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;

use crate::config::ModelTier;

/// Skill 定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    /// 唯一 ID（即文件名去掉 .md，frontmatter 中可省略）
    #[serde(default)]
    pub id: String,
    /// 显示名称
    #[serde(default)]
    pub name: String,
    /// 一句话描述（用于 compact index）
    #[serde(default)]
    pub description: String,
    /// 完整 Markdown 指令内容（按需加载）
    #[serde(skip)]
    pub full_instructions: String,
    /// 触发关键词
    #[serde(default)]
    pub triggers: Vec<String>,
    /// 分类
    #[serde(default)]
    pub category: String,
    /// 前置条件
    #[serde(default)]
    pub gating: SkillGating,
    /// 建议使用的模型层级
    #[serde(default)]
    pub tier_hint: Option<ModelTierHint>,
    /// 来源
    #[serde(default)]
    pub origin: SkillOrigin,
    /// 文件路径
    #[serde(skip)]
    pub file_path: PathBuf,
    /// 加载时间
    #[serde(skip)]
    pub loaded_at: Option<Instant>,
}

/// Skill 前置条件
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillGating {
    /// 需要用户已绑定的平台
    #[serde(default)]
    pub platforms: Vec<String>,
    /// 依赖的能力 ID
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// Skill 来源
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SkillOrigin {
    /// 开发者手写
    #[default]
    Manual,
    /// Agent 自动创建
    AgentGenerated,
    /// Agent 基于反馈改进
    AgentImproved,
}

/// ModelTier 提示（序列化友好版）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelTierHint {
    Pro,
    Standard,
}

impl ModelTierHint {
    #[allow(dead_code)]
    pub fn to_model_tier(&self) -> ModelTier {
        match self {
            ModelTierHint::Pro => ModelTier::Pro,
            ModelTierHint::Standard => ModelTier::Standard,
        }
    }
}

/// Skill 注册表
pub struct SkillRegistry {
    /// id -> Skill
    skills: RwLock<HashMap<String, Skill>>,
    /// skills 目录路径
    skills_dir: PathBuf,
}

impl SkillRegistry {
    /// 创建并从目录加载所有 Skills
    pub async fn new(skills_dir: PathBuf) -> Self {
        let registry = Self {
            skills: RwLock::new(HashMap::new()),
            skills_dir,
        };
        registry.load_all().await;
        registry
    }

    /// 从目录加载所有 .md 文件
    async fn load_all(&self) {
        let dir = &self.skills_dir;
        if !dir.exists() {
            tracing::debug!("[SkillRegistry] Skills directory not found: {}", dir.display());
            return;
        }

        let mut entries = match tokio::fs::read_dir(dir).await {
            Ok(entries) => entries,
            Err(e) => {
                tracing::warn!("[SkillRegistry] Failed to read skills dir: {}", e);
                return;
            }
        };

        let mut count = 0;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Some(skill) = Self::parse_skill_file(&path).await {
                    let mut skills = self.skills.write().await;
                    tracing::debug!("[SkillRegistry] Loaded skill: {}", skill.id);
                    skills.insert(skill.id.clone(), skill);
                    count += 1;
                }
            }
        }

        tracing::info!("[SkillRegistry] Loaded {} skills from {}", count, dir.display());
    }

    /// 解析单个 Skill 文件（YAML frontmatter + Markdown body）
    async fn parse_skill_file(path: &Path) -> Option<Skill> {
        let content = tokio::fs::read_to_string(path).await.ok()?;
        let id = path.file_stem()?.to_str()?.to_string();

        // 解析 YAML frontmatter（--- 分隔）
        let (frontmatter, body) = Self::split_frontmatter(&content)?;

        // 反序列化 frontmatter
        let mut skill: Skill = match serde_yaml::from_str(&frontmatter) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(
                    "[SkillRegistry] Failed to parse frontmatter in {}: {}",
                    path.display(),
                    e
                );
                return None;
            }
        };

        skill.id = id;
        skill.full_instructions = body;
        skill.file_path = path.to_path_buf();
        skill.loaded_at = Some(Instant::now());

        Some(skill)
    }

    /// 分割 YAML frontmatter 和 Markdown body
    fn split_frontmatter(content: &str) -> Option<(String, String)> {
        let trimmed = content.trim_start();
        if !trimmed.starts_with("---") {
            return None;
        }

        // 跳过第一个 ---
        let after_first = &trimmed[3..];
        let end_idx = after_first.find("\n---")?;
        let frontmatter = after_first[..end_idx].trim().to_string();
        let body = after_first[end_idx + 4..].trim().to_string();

        Some((frontmatter, body))
    }

    /// 获取所有 Skill 的紧凑索引（用于 AI 提示）
    pub async fn get_compact_index(&self) -> Vec<Value> {
        let skills = self.skills.read().await;
        skills
            .values()
            .map(|s| {
                json!({
                    "id": format!("skill:{}", s.id),
                    "h": s.description,
                })
            })
            .collect()
    }

    /// 根据 ID 获取完整 Skill
    #[allow(dead_code)]
    pub async fn get(&self, id: &str) -> Option<Skill> {
        let skills = self.skills.read().await;
        skills.get(id).cloned()
    }

    /// 获取所有 Skills
    #[allow(dead_code)]
    pub async fn get_all(&self) -> Vec<Skill> {
        let skills = self.skills.read().await;
        skills.values().cloned().collect()
    }

    /// 根据触发词匹配 Skill
    #[allow(dead_code)]
    pub async fn match_by_trigger(&self, input: &str) -> Vec<Skill> {
        let input_lower = input.to_lowercase();
        let skills = self.skills.read().await;
        skills
            .values()
            .filter(|s| {
                s.triggers
                    .iter()
                    .any(|t| input_lower.contains(&t.to_lowercase()))
            })
            .cloned()
            .collect()
    }

    /// 重新加载所有 Skills
    #[allow(dead_code)]
    pub async fn reload(&self) {
        let mut skills = self.skills.write().await;
        skills.clear();
        drop(skills);
        self.load_all().await;
    }

    /// Skill 数量
    #[allow(dead_code)]
    pub async fn count(&self) -> usize {
        self.skills.read().await.len()
    }
}

/// 全局 Skill 注册表
static SKILL_REGISTRY: once_cell::sync::OnceCell<Arc<SkillRegistry>> =
    once_cell::sync::OnceCell::new();

/// 初始化全局 Skill 注册表
pub async fn init_skills(skills_dir: PathBuf) {
    let registry = Arc::new(SkillRegistry::new(skills_dir).await);
    let _ = SKILL_REGISTRY.set(registry);
}

/// 获取全局 Skill 注册表
pub fn get_skill_registry() -> Option<&'static Arc<SkillRegistry>> {
    SKILL_REGISTRY.get()
}
