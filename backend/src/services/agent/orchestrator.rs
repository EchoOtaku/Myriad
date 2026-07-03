//! Multi-Agent Orchestrator
//!
//! 将多步骤 Recipe 按 Agent 角色分组，并行调度独立的角色组，
//! 合并结果，提供整体进度追踪。
//!
//! ```text
//! Recipe (N steps)
//!     ↓ group_by_role()
//! RoleGroup { DataWorker: [s1,s3], ContentWorker: [s2], CreativeWorker: [s4] }
//!     ↓ execute_groups()
//! 独立组并行 → 有依赖组串行
//!     ↓ merge_results()
//! OrchestratorResult
//! ```

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::identity::get_role_identity;
use super::notifications::get_notification_manager;
use super::routing::{get_router, AgentRole, TaskAssignment};
use super::types::Recipe;

/// 角色分组
#[derive(Debug, Clone)]
pub struct RoleGroup {
    pub role: AgentRole,
    /// 该角色负责的步骤索引
    pub step_indices: Vec<usize>,
    /// 是否依赖其他角色组的输出
    pub depends_on_roles: Vec<AgentRole>,
}

/// Orchestrator 执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorResult {
    /// 总步骤数
    pub total_steps: usize,
    /// 成功步骤数
    pub successful_steps: usize,
    /// 参与的角色
    pub participating_roles: Vec<String>,
    /// 是否使用了并行调度
    pub used_parallel: bool,
    /// 各角色的执行摘要
    pub role_summaries: Vec<RoleSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleSummary {
    pub role: String,
    pub icon: String,
    pub steps_count: usize,
    pub success_count: usize,
    pub identity_used: bool,
}

/// Multi-Agent Orchestrator
pub struct Orchestrator;

impl Orchestrator {
    /// 分析 Recipe 的角色分布
    pub fn analyze_recipe(recipe: &Recipe) -> (TaskAssignment, Vec<RoleGroup>) {
        let router = get_router();

        // 收集能力 ID 和角色映射
        let capability_ids: Vec<String> = recipe
            .steps
            .iter()
            .map(|s| s.capability_id.clone())
            .collect();
        let assignment = router.summarize_assignment(&capability_ids);

        // 按角色分组步骤
        let mut role_groups: HashMap<AgentRole, Vec<usize>> = HashMap::new();
        for (idx, step) in recipe.steps.iter().enumerate() {
            let role = router.route_capability(&step.capability_id);
            role_groups.entry(role).or_default().push(idx);
        }

        // 分析跨角色依赖
        let groups: Vec<RoleGroup> = role_groups
            .into_iter()
            .map(|(role, step_indices)| {
                let depends_on_roles = Self::find_cross_role_deps(recipe, &step_indices);
                RoleGroup {
                    role,
                    step_indices,
                    depends_on_roles,
                }
            })
            .collect();

        (assignment, groups)
    }

    /// 检查步骤的跨角色依赖
    fn find_cross_role_deps(recipe: &Recipe, step_indices: &[usize]) -> Vec<AgentRole> {
        let router = get_router();
        let mut deps = Vec::new();

        for &idx in step_indices {
            if let Some(step) = recipe.steps.get(idx) {
                // 检查 depends_on 引用的步骤是否属于其他角色
                for dep_id in &step.depends_on {
                    if let Some(dep_step) = recipe.steps.iter().find(|s| s.id == *dep_id) {
                        let dep_role = router.route_capability(&dep_step.capability_id);
                        let my_role = router.route_capability(&step.capability_id);
                        if dep_role != my_role && !deps.contains(&dep_role) {
                            deps.push(dep_role);
                        }
                    }
                }
            }
        }

        deps
    }

    /// 获取参与角色的 identity 上下文（注入到 AI 步骤的系统 prompt）
    pub async fn get_role_contexts(recipe: &Recipe) -> HashMap<AgentRole, String> {
        let router = get_router();
        let mut contexts = HashMap::new();

        let mut roles_seen = Vec::new();
        for step in &recipe.steps {
            let role = router.route_capability(&step.capability_id);
            if !roles_seen.contains(&role) {
                roles_seen.push(role);
            }
        }

        for role in roles_seen {
            if let Some(identity) = get_role_identity(role).await {
                contexts.insert(role, identity);
            }
        }

        contexts
    }

    /// 判断是否可以并行执行（无跨角色依赖的独立组）
    pub fn can_parallelize(groups: &[RoleGroup]) -> bool {
        // 至少有 2 个角色组且至少一个无跨角色依赖
        groups.len() >= 2 && groups.iter().any(|g| g.depends_on_roles.is_empty())
    }

    /// 发送多 Agent 协作开始通知
    pub async fn notify_multi_agent_start(assignment: &TaskAssignment, task_id: &str) {
        if !assignment.is_multi_agent {
            return;
        }

        if let Some(nm) = get_notification_manager() {
            let agent_names: Vec<&str> = assignment
                .agents
                .iter()
                .map(|a| a.display_name.as_str())
                .collect();
            nm.notify_system_info(
                "多 Agent 协作启动",
                &format!(
                    "任务 {} 分配给 {} 个 Agent: {}",
                    task_id,
                    assignment.total_agents,
                    agent_names.join(", ")
                ),
            )
            .await;
        }
    }

    /// 发送多 Agent 协作完成通知
    pub async fn notify_multi_agent_complete(result: &OrchestratorResult, task_id: &str) {
        if let Some(nm) = get_notification_manager() {
            let summary = format!(
                "任务 {} 完成: {}/{} 步骤成功, {} 个角色参与{}",
                task_id,
                result.successful_steps,
                result.total_steps,
                result.participating_roles.len(),
                if result.used_parallel {
                    " (并行执行)"
                } else {
                    ""
                },
            );
            let success = result.successful_steps == result.total_steps;
            nm.notify_task_completed(task_id, "多 Agent 任务完成", &summary, success)
                .await;
        }
    }
}
