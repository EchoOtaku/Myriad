//! Skill 自我进化引擎
//!
//! Agent 不仅能使用 Skills，还能创建、改进、淘汰 Skills，
//! 形成"执行→评估→进化"闭环。
//!
//! 统计数据持久化到 `{skills_dir}/_stats.json`，服务重启后自动恢复。
//!
//! 安全约束：
//! - Agent 生成的 Skill 文件前缀固定为 `_auto_`
//! - Agent 不能修改手动创建的 Skill（origin: manual 只读）
//! - 自动创建的 Skill 需要通过 gating 校验
//! - 每日自动创建上限 10 个

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use super::capability;
use super::skill::{get_skill_registry, Skill, SkillOrigin};

/// 每日自动创建 Skill 上限
const DAILY_AUTO_CREATE_LIMIT: u32 = 10;

/// Skill 改进冷却时间（秒）— 同一 Skill 24 小时内最多改进 1 次
const IMPROVE_COOLDOWN_SECS: i64 = 86400;

/// 失败率阈值：超过此值触发自动改进
const FAILURE_RATE_THRESHOLD: f64 = 0.30;

/// 淘汰阈值：失败率超过此值的自动 Skill 被清理
const PRUNE_FAILURE_RATE: f64 = 0.70;

/// 连续失败次数阈值
const CONSECUTIVE_FAILURE_LIMIT: u32 = 5;

/// 触发改进所需的最小样本量
const MIN_SAMPLES_FOR_ACTION: u32 = 3;

/// 统计文件名
const STATS_FILE: &str = "_stats.json";

/// 能力缺口文件名
const GAPS_FILE: &str = "_gaps.json";

/// 能力缺口检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityGap {
    /// 用户想做什么
    pub description: String,
    /// 缺少什么能力
    pub missing_capability: String,
    /// 是否有 http.fetch 等变通方案
    pub workaround: Option<String>,
    /// 建议开发者添加什么
    pub suggestion: String,
    /// 置信度 (0.0 - 1.0)，随报告次数递增
    pub confidence: f64,
    /// 首次报告时间
    pub first_seen: String,
    /// 报告次数
    pub report_count: u32,
}

/// Skill 执行统计（持久化到文件）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillStats {
    pub success_count: u32,
    pub failure_count: u32,
    pub consecutive_failures: u32,
    pub last_failure_reason: Option<String>,
    pub last_improved_at: Option<chrono::DateTime<Utc>>,
}

impl SkillStats {
    fn total(&self) -> u32 {
        self.success_count + self.failure_count
    }

    fn failure_rate(&self) -> f64 {
        let total = self.total();
        if total == 0 {
            return 0.0;
        }
        self.failure_count as f64 / total as f64
    }
}

/// Skill 自我进化引擎
pub struct SkillEvolution {
    /// skills 目录
    skills_dir: PathBuf,
    /// 执行统计（skill_id -> stats）
    stats: Mutex<HashMap<String, SkillStats>>,
    /// 今日已创建的自动 Skill 数量
    daily_create_count: AtomicU32,
    /// 今日日期（用于重置计数器）
    daily_date: Mutex<NaiveDate>,
    /// 能力缺口累积
    capability_gaps: Mutex<Vec<CapabilityGap>>,
    /// 脏标记 — stats 发生变更但尚未写盘
    stats_dirty: std::sync::atomic::AtomicBool,
    /// gaps 脏标记
    gaps_dirty: std::sync::atomic::AtomicBool,
}

impl SkillEvolution {
    /// 创建新的进化引擎（从文件恢复统计）
    pub async fn new(skills_dir: PathBuf) -> Self {
        let stats = Self::load_stats_from_file(&skills_dir).await;
        let gaps = Self::load_gaps_from_file(&skills_dir).await;

        let stats_count = stats.len();
        let gaps_count = gaps.len();

        let engine = Self {
            skills_dir,
            stats: Mutex::new(stats),
            daily_create_count: AtomicU32::new(0),
            daily_date: Mutex::new(Utc::now().date_naive()),
            capability_gaps: Mutex::new(gaps),
            stats_dirty: std::sync::atomic::AtomicBool::new(false),
            gaps_dirty: std::sync::atomic::AtomicBool::new(false),
        };

        if stats_count > 0 || gaps_count > 0 {
            tracing::info!(
                stats = stats_count,
                gaps = gaps_count,
                "[SkillEvolution] Restored persisted state"
            );
        }

        engine
    }

    // ==================== 统计文件持久化 ====================

    /// 从文件加载统计
    async fn load_stats_from_file(skills_dir: &PathBuf) -> HashMap<String, SkillStats> {
        let path = skills_dir.join(STATS_FILE);
        match tokio::fs::read_to_string(&path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => HashMap::new(),
        }
    }

    /// 从文件加载能力缺口
    async fn load_gaps_from_file(skills_dir: &PathBuf) -> Vec<CapabilityGap> {
        let path = skills_dir.join(GAPS_FILE);
        match tokio::fs::read_to_string(&path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    /// 持久化统计到文件（仅当脏标记为 true）
    pub async fn flush(&self) {
        if self
            .stats_dirty
            .swap(false, std::sync::atomic::Ordering::Relaxed)
        {
            let stats = self.stats.lock().await;
            let path = self.skills_dir.join(STATS_FILE);
            if let Ok(json) = serde_json::to_string_pretty(&*stats) {
                if let Err(e) = tokio::fs::write(&path, json).await {
                    tracing::warn!("[SkillEvolution] Failed to write stats: {}", e);
                    self.stats_dirty
                        .store(true, std::sync::atomic::Ordering::Relaxed);
                }
            }
        }
        if self
            .gaps_dirty
            .swap(false, std::sync::atomic::Ordering::Relaxed)
        {
            let gaps = self.capability_gaps.lock().await;
            let path = self.skills_dir.join(GAPS_FILE);
            if let Ok(json) = serde_json::to_string_pretty(&*gaps) {
                if let Err(e) = tokio::fs::write(&path, json).await {
                    tracing::warn!("[SkillEvolution] Failed to write gaps: {}", e);
                    self.gaps_dirty
                        .store(true, std::sync::atomic::Ordering::Relaxed);
                }
            }
        }
    }

    fn mark_stats_dirty(&self) {
        self.stats_dirty
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }

    fn mark_gaps_dirty(&self) {
        self.gaps_dirty
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }

    // ==================== 核心回调 ====================

    /// 执行后回调：记录成功/失败，触发进化动作
    ///
    /// 由 Executor 在每个步骤完成后调用。
    /// 当失败率超阈值时自动触发改进流程。
    pub async fn on_execution_complete(
        &self,
        capability_id: &str,
        success: bool,
        failure_reason: Option<&str>,
    ) {
        let (should_improve, should_prune) = {
            let mut stats = self.stats.lock().await;
            let entry = stats.entry(capability_id.to_string()).or_default();

            if success {
                entry.success_count += 1;
                entry.consecutive_failures = 0;
            } else {
                entry.failure_count += 1;
                entry.consecutive_failures += 1;
                entry.last_failure_reason = failure_reason.map(String::from);
            }

            self.mark_stats_dirty();

            let total = entry.total();
            let failure_rate = entry.failure_rate();

            let should_improve = !success
                && failure_rate > FAILURE_RATE_THRESHOLD
                && total >= MIN_SAMPLES_FOR_ACTION
                && match entry.last_improved_at {
                    Some(last) => (Utc::now() - last).num_seconds() > IMPROVE_COOLDOWN_SECS,
                    None => true,
                };

            let should_prune = failure_rate > PRUNE_FAILURE_RATE && total >= MIN_SAMPLES_FOR_ACTION
                || entry.consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT;

            (should_improve, should_prune)
        };

        // 只对 Agent 生成的 Skill 触发自动进化
        if should_improve || should_prune {
            if let Some(registry) = get_skill_registry() {
                // capability_id 可能不是 skill，先检查
                let skill_id = capability_id.strip_prefix("skill:").unwrap_or(capability_id);
                if let Some(skill) = registry.get(skill_id).await {
                    if skill.origin == SkillOrigin::Manual {
                        // 手动 Skill 不自动修改，仅记录警告
                        if should_prune {
                            tracing::warn!(
                                skill_id = skill_id,
                                "[SkillEvolution] Manual skill has high failure rate, needs developer attention"
                            );
                        }
                        return;
                    }

                    if should_prune {
                        tracing::info!(
                            skill_id = skill_id,
                            "[SkillEvolution] Auto-pruning low-quality skill"
                        );
                        self.prune_single_skill(&skill).await;
                    } else if should_improve {
                        tracing::info!(
                            skill_id = skill_id,
                            failure_reason = failure_reason,
                            "[SkillEvolution] Triggering AI-powered improvement"
                        );
                        // 标记改进时间戳（防止重复触发）
                        {
                            let mut stats = self.stats.lock().await;
                            if let Some(entry) = stats.get_mut(capability_id) {
                                entry.last_improved_at = Some(Utc::now());
                            }
                            self.mark_stats_dirty();
                        }
                        // 后台 AI 改进
                        let skill_id_owned = skill_id.to_string();
                        let failure_reason_owned = failure_reason.map(String::from);
                        let old_instructions = skill.full_instructions.clone();
                        if let Some(evolution) = get_skill_evolution() {
                            let evo = evolution.clone();
                            tokio::spawn(async move {
                                if let Err(e) = Self::ai_improve_skill(
                                    &evo,
                                    &skill_id_owned,
                                    &old_instructions,
                                    failure_reason_owned.as_deref(),
                                ).await {
                                    tracing::warn!(
                                        skill_id = %skill_id_owned,
                                        error = %e,
                                        "[SkillEvolution] AI improvement failed"
                                    );
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    // ==================== AI 驱动的改进 ====================

    /// 使用 AI 生成改进后的 Skill 指令
    async fn ai_improve_skill(
        evolution: &Arc<SkillEvolution>,
        skill_id: &str,
        old_instructions: &str,
        failure_reason: Option<&str>,
    ) -> Result<(), String> {
        use crate::config::ModelTier;
        use crate::services::ai::create_ai_analyzer_for_tier;

        let analyzer = create_ai_analyzer_for_tier(ModelTier::Standard).await
            .ok_or("AI analyzer not available")?;

        let reason_ctx = failure_reason
            .map(|r| format!("\n最近失败原因：{}", r))
            .unwrap_or_default();

        let prompt = format!(
            "你是一个 Skill 优化专家。以下是一个执行 Skill 的指令，它最近频繁失败。\n\n\
            当前指令：\n{}\n{}\n\n\
            请改写这段指令，使其更健壮、更准确。改进要求：\n\
            1. 保持原有功能意图不变\n\
            2. 添加错误处理和边界条件检查\n\
            3. 使参数匹配更精确\n\
            4. 只输出改进后的指令文本，不要解释\n",
            old_instructions, reason_ctx
        );

        let new_instructions = analyzer
            .analyze(&prompt)
            .await
            .map_err(|e| format!("AI generation failed: {}", e))?;

        if new_instructions.len() < 20 {
            return Err("AI generated instructions too short".to_string());
        }

        evolution.improve_skill(skill_id, &new_instructions).await?;

        tracing::info!(
            skill_id = skill_id,
            "[SkillEvolution] AI improvement completed"
        );
        Ok(())
    }

    // ==================== 自动创建 ====================

    /// 自动创建 Skill：当某个 Recipe 执行成功且模式可复用时
    pub async fn auto_create_skill(
        &self,
        name: &str,
        description: &str,
        triggers: &[String],
        category: &str,
        instructions: &str,
        required_capabilities: &[String],
    ) -> Result<Skill, String> {
        // 检查每日限额
        self.reset_daily_counter_if_needed().await;
        let current = self.daily_create_count.load(Ordering::Relaxed);
        if current >= DAILY_AUTO_CREATE_LIMIT {
            return Err(format!(
                "Daily auto-create limit reached ({}/{})",
                current, DAILY_AUTO_CREATE_LIMIT
            ));
        }

        // 验证所需能力是否存在
        self.validate_capabilities(required_capabilities).await?;

        // 生成安全文件名
        let safe_name = name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
            .collect::<String>();
        let file_name = format!("_auto_{}.md", safe_name);
        let file_path = self.skills_dir.join(&file_name);

        // 构建 YAML frontmatter
        let triggers_yaml = triggers
            .iter()
            .map(|t| format!("\"{}\"", t))
            .collect::<Vec<_>>()
            .join(", ");
        let caps_yaml = required_capabilities
            .iter()
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");

        let content = format!(
            r#"---
name: {name}
description: "{description}"
category: {category}
triggers: [{triggers_yaml}]
tier_hint: standard
gating:
  capabilities: [{caps_yaml}]
origin: agent_generated
---

{instructions}
"#
        );

        // 原子写入
        let tmp_path = self.skills_dir.join(format!(".tmp_{}", file_name));
        tokio::fs::write(&tmp_path, &content)
            .await
            .map_err(|e| format!("Failed to write skill file: {}", e))?;
        tokio::fs::rename(&tmp_path, &file_path)
            .await
            .map_err(|e| format!("Failed to rename skill file: {}", e))?;

        self.daily_create_count.fetch_add(1, Ordering::Relaxed);

        // 重新加载 Skills
        if let Some(registry) = get_skill_registry() {
            registry.reload().await;
        }

        tracing::info!(
            name = name,
            file = %file_path.display(),
            "[SkillEvolution] Auto-created skill"
        );

        let skill = Skill {
            id: format!("_auto_{}", safe_name),
            name: name.to_string(),
            description: description.to_string(),
            full_instructions: instructions.to_string(),
            triggers: triggers.to_vec(),
            category: category.to_string(),
            gating: super::skill::SkillGating {
                platforms: Vec::new(),
                capabilities: required_capabilities.to_vec(),
            },
            tier_hint: Some(super::skill::ModelTierHint::Standard),
            origin: SkillOrigin::AgentGenerated,
            file_path,
            loaded_at: Some(std::time::Instant::now()),
        };

        Ok(skill)
    }

    // ==================== 改进 ====================

    /// 改进 Skill：更新指令内容（仅限 Agent 生成的 Skill）
    pub async fn improve_skill(
        &self,
        skill_id: &str,
        new_instructions: &str,
    ) -> Result<(), String> {
        let registry = get_skill_registry().ok_or("Skill registry not initialized")?;
        let skill = registry
            .get(skill_id)
            .await
            .ok_or_else(|| format!("Skill not found: {}", skill_id))?;

        if skill.origin == SkillOrigin::Manual {
            return Err("Cannot modify manual skills".to_string());
        }

        // 检查冷却时间
        {
            let stats = self.stats.lock().await;
            if let Some(stat) = stats.get(skill_id) {
                if let Some(last) = stat.last_improved_at {
                    let elapsed = (Utc::now() - last).num_seconds();
                    if elapsed < IMPROVE_COOLDOWN_SECS {
                        return Err(format!(
                            "Skill improvement on cooldown ({} seconds remaining)",
                            IMPROVE_COOLDOWN_SECS - elapsed
                        ));
                    }
                }
            }
        }

        // 备份原文件
        let bak_path = skill.file_path.with_extension("md.bak");
        if skill.file_path.exists() {
            tokio::fs::copy(&skill.file_path, &bak_path)
                .await
                .map_err(|e| format!("Failed to backup: {}", e))?;
        }

        // 读取原文件，替换 body 部分，保留 frontmatter
        let original = tokio::fs::read_to_string(&skill.file_path)
            .await
            .map_err(|e| format!("Failed to read skill file: {}", e))?;

        let new_content = if let Some(idx) = original.find("\n---\n") {
            let frontmatter = &original[..idx];
            let updated_fm = frontmatter.replace("agent_generated", "agent_improved");
            format!("{}\n---\n\n{}\n", updated_fm, new_instructions)
        } else {
            return Err("Invalid skill file format".to_string());
        };

        // 原子写入
        let tmp_path = skill.file_path.with_extension("md.tmp");
        tokio::fs::write(&tmp_path, &new_content)
            .await
            .map_err(|e| format!("Failed to write: {}", e))?;
        tokio::fs::rename(&tmp_path, &skill.file_path)
            .await
            .map_err(|e| format!("Failed to rename: {}", e))?;

        // 更新统计
        {
            let mut stats = self.stats.lock().await;
            let entry = stats.entry(skill_id.to_string()).or_default();
            entry.last_improved_at = Some(Utc::now());
            entry.consecutive_failures = 0;
            self.mark_stats_dirty();
        }

        // 重新加载
        if let Some(registry) = get_skill_registry() {
            registry.reload().await;
        }

        tracing::info!(skill_id = skill_id, "[SkillEvolution] Improved skill");
        Ok(())
    }

    // ==================== 能力缺口检测 ====================

    /// 能力缺口检测：当用户请求无法被任何能力/Skill 满足时
    ///
    /// 由 Planner 在返回 unsupported 或 Executor 找不到能力时调用。
    pub async fn detect_capability_gap(
        &self,
        user_request: &str,
        missing_description: &str,
    ) -> CapabilityGap {
        let has_http_fetch = {
            let registry = capability::get_registry().await;
            registry.get("http.fetch").is_some()
        };

        let workaround = if has_http_fetch {
            Some("可以尝试通过 http.fetch 调用外部 API 实现".to_string())
        } else {
            None
        };

        let mut gaps = self.capability_gaps.lock().await;

        // 查找已有的相同缺口
        let existing = gaps
            .iter_mut()
            .find(|g| g.missing_capability == missing_description);

        if let Some(existing) = existing {
            existing.report_count += 1;
            existing.confidence = (existing.confidence + 0.2).min(1.0);
            self.mark_gaps_dirty();
            return existing.clone();
        }

        // 新缺口
        let gap = CapabilityGap {
            description: user_request.to_string(),
            missing_capability: missing_description.to_string(),
            workaround,
            suggestion: format!("建议添加新的 handler 以支持: {}", missing_description),
            confidence: 0.3,
            first_seen: Utc::now().to_rfc3339(),
            report_count: 1,
        };
        gaps.push(gap.clone());

        // 保留最近 50 个缺口记录
        if gaps.len() > 50 {
            let excess = gaps.len() - 50;
            gaps.drain(0..excess);
        }

        self.mark_gaps_dirty();
        gap
    }

    // ==================== 淘汰 ====================

    /// 淘汰低质量 Skill（失败率 > 70%，或连续 5 次失败）
    ///
    /// 由后台定时任务（每日）调用。
    pub async fn prune_skills(&self) -> Vec<String> {
        let stats = self.stats.lock().await;
        let mut to_prune = Vec::new();

        for (skill_id, stat) in stats.iter() {
            if stat.total() < MIN_SAMPLES_FOR_ACTION {
                continue;
            }

            let should_prune = stat.failure_rate() > PRUNE_FAILURE_RATE
                || stat.consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT;

            if should_prune {
                to_prune.push(skill_id.clone());
            }
        }
        drop(stats);

        let mut pruned = Vec::new();
        for skill_id in to_prune {
            if let Some(registry) = get_skill_registry() {
                let lookup_id = skill_id.strip_prefix("skill:").unwrap_or(&skill_id);
                if let Some(skill) = registry.get(lookup_id).await {
                    if skill.origin == SkillOrigin::Manual {
                        continue;
                    }
                    if self.prune_single_skill(&skill).await {
                        pruned.push(skill_id);
                    }
                }
            }
        }

        // 重新加载
        if !pruned.is_empty() {
            // 从 stats 中移除已淘汰的条目
            {
                let mut stats = self.stats.lock().await;
                for id in &pruned {
                    stats.remove(id);
                }
                self.mark_stats_dirty();
            }
            if let Some(registry) = get_skill_registry() {
                registry.reload().await;
            }
        }

        // 写盘
        self.flush().await;

        pruned
    }

    /// 淘汰单个 Skill 文件
    async fn prune_single_skill(&self, skill: &Skill) -> bool {
        if !skill.file_path.exists() {
            return false;
        }
        match tokio::fs::remove_file(&skill.file_path).await {
            Ok(_) => {
                tracing::info!(
                    skill_id = %skill.id,
                    file = %skill.file_path.display(),
                    "[SkillEvolution] Pruned skill file"
                );
                true
            }
            Err(e) => {
                tracing::warn!(
                    skill_id = %skill.id,
                    error = %e,
                    "[SkillEvolution] Failed to prune skill file"
                );
                false
            }
        }
    }

    // ==================== 查询 ====================

    /// 获取高置信度的能力缺口（置信度 >= 0.7，即至少被报告 2+ 次）
    #[allow(dead_code)]
    pub async fn get_significant_gaps(&self) -> Vec<CapabilityGap> {
        let gaps = self.capability_gaps.lock().await;
        gaps.iter()
            .filter(|g| g.confidence >= 0.7)
            .cloned()
            .collect()
    }

    /// 获取 Skill 执行统计
    #[allow(dead_code)]
    pub async fn get_stats(&self, skill_id: &str) -> Option<SkillStats> {
        let stats = self.stats.lock().await;
        stats.get(skill_id).cloned()
    }

    /// 获取所有统计（用于调试/API）
    #[allow(dead_code)]
    pub async fn get_all_stats(&self) -> HashMap<String, SkillStats> {
        self.stats.lock().await.clone()
    }

    /// 获取所有能力缺口（用于调试/API）
    #[allow(dead_code)]
    pub async fn get_all_gaps(&self) -> Vec<CapabilityGap> {
        self.capability_gaps.lock().await.clone()
    }

    // ==================== 内部方法 ====================

    /// 如果日期变更，重置每日计数器
    async fn reset_daily_counter_if_needed(&self) {
        let today = Utc::now().date_naive();
        let mut date = self.daily_date.lock().await;
        if *date != today {
            *date = today;
            self.daily_create_count.store(0, Ordering::Relaxed);
        }
    }

    /// 验证所需能力是否全部存在
    async fn validate_capabilities(&self, required: &[String]) -> Result<(), String> {
        let registry = capability::get_registry().await;
        for cap_id in required {
            if registry.get(cap_id).is_none() {
                return Err(format!("Required capability not found: {}", cap_id));
            }
        }
        Ok(())
    }
}

/// 全局 SkillEvolution 实例
static SKILL_EVOLUTION: once_cell::sync::OnceCell<Arc<SkillEvolution>> =
    once_cell::sync::OnceCell::new();

/// 初始化全局 SkillEvolution（异步，从文件恢复状态）
///
/// 同时启动后台定时任务：
/// - 每 5 分钟 flush 脏数据到磁盘
/// - 每 24 小时执行一次 prune_skills
pub async fn init_skill_evolution(skills_dir: PathBuf) {
    let evolution = Arc::new(SkillEvolution::new(skills_dir).await);
    let _ = SKILL_EVOLUTION.set(evolution.clone());

    // 后台定时任务：定期 flush + 每日 prune
    tokio::spawn(async move {
        let flush_interval = tokio::time::Duration::from_secs(5 * 60); // 5 min
        let prune_interval_ticks = 288; // 288 * 5min = 24h
        let mut tick_count: u64 = 0;

        loop {
            tokio::time::sleep(flush_interval).await;
            tick_count += 1;

            // 每 5 分钟 flush
            evolution.flush().await;

            // 每 24 小时 prune
            if tick_count % prune_interval_ticks == 0 {
                let pruned = evolution.prune_skills().await;
                if !pruned.is_empty() {
                    tracing::info!(
                        count = pruned.len(),
                        skills = ?pruned,
                        "[SkillEvolution] Daily prune completed"
                    );
                }
            }
        }
    });
}

/// 获取全局 SkillEvolution
pub fn get_skill_evolution() -> Option<&'static Arc<SkillEvolution>> {
    SKILL_EVOLUTION.get()
}
