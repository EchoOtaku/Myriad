//! Recipe 步骤校验与转换
//!
//! 提供 `validate_and_convert_steps`：校验 AI/Planner 生成的步骤并转换为 RecipeStep。

use super::tier_router::TierRouter;
use super::types::*;
use crate::config::ModelTier;
use std::collections::HashMap;

/// 根据 capability_id 建议 model_tier（复用 TierRouter 逻辑）
fn suggest_tier(capability_id: &str) -> Option<ModelTier> {
    Some(TierRouter::resolve_with_override(capability_id, None))
}

/// 步骤数量上限
const MAX_STEPS: usize = 12;

/// 校验 AI 生成的步骤并转换为 RecipeStep（供 Planner 复用）
pub fn validate_and_convert_steps(
    ai_steps: Vec<AiRecipeStep>,
    reasoning: Option<String>,
    cap_schemas: &[Capability],
) -> Result<Vec<RecipeStep>, String> {
    if ai_steps.is_empty() {
        return Err("AI generated zero steps".to_string());
    }

    if ai_steps.len() > MAX_STEPS {
        tracing::warn!(
            count = ai_steps.len(),
            max = MAX_STEPS,
            "[validate_and_convert] Too many steps, truncating"
        );
    }
    let ai_steps: Vec<AiRecipeStep> = ai_steps.into_iter().take(MAX_STEPS).collect();

    let cap_ids: std::collections::HashSet<&str> =
        cap_schemas.iter().map(|c| c.id.as_str()).collect();
    let step_ids: std::collections::HashSet<String> =
        ai_steps.iter().map(|s| s.id.clone()).collect();

    // step_id 唯一性检查
    if step_ids.len() != ai_steps.len() {
        return Err("Duplicate step IDs detected".to_string());
    }

    let mut steps = Vec::new();

    for (idx, ai_step) in ai_steps.into_iter().enumerate() {
        // capability_id 验证（允许 skill: 和 mcp. 前缀通过）
        let is_skill = ai_step.capability_id.starts_with("skill:");
        let is_mcp = ai_step.capability_id.starts_with("mcp.");
        if !is_skill && !is_mcp && !cap_ids.contains(ai_step.capability_id.as_str()) {
            tracing::warn!(
                capability_id = %ai_step.capability_id,
                "[validate_and_convert] Unknown capability_id"
            );
            return Err(format!("Unknown capability_id: {}", ai_step.capability_id));
        }

        // depends_on 引用验证
        for dep in &ai_step.depends_on {
            if !step_ids.contains(dep) {
                return Err(format!(
                    "Step '{}' depends on non-existent step '{}'",
                    ai_step.id, dep
                ));
            }
        }

        // 参数验证（包括 required 字段检查）
        if let Some(cap) = cap_schemas.iter().find(|c| c.id == ai_step.capability_id) {
            // 检查 required params 是否存在
            if let Some(required) = cap.input_schema.get("required").and_then(|v| v.as_array()) {
                for req_val in required {
                    if let Some(req_name) = req_val.as_str() {
                        let has_direct = ai_step.params.contains_key(req_name);
                        let has_from = ai_step.params.contains_key(&format!("{}From", req_name));
                        if !has_direct && !has_from {
                            tracing::warn!(
                                capability = %ai_step.capability_id,
                                missing_param = %req_name,
                                "[validate_and_convert] Missing required parameter"
                            );
                        }
                    }
                }
            }
            // 检查多余参数
            if let Some(props) = cap.input_schema.get("properties") {
                for key in ai_step.params.keys() {
                    if key.ends_with("From") {
                        continue;
                    }
                    if props.get(key).is_none() {
                        tracing::warn!(
                            capability = %ai_step.capability_id,
                            param = %key,
                            "[validate_and_convert] Unknown param (not in schema)"
                        );
                    }
                }
            }
        }

        // timeout_ms 范围钳制
        let tier = suggest_tier(&ai_step.capability_id);
        let mut recipe_step = ai_step.into_recipe_step(idx as u32, tier);
        if let Some(timeout) = recipe_step.timeout_ms {
            recipe_step.timeout_ms = Some(timeout.clamp(1_000, 120_000));
        }
        steps.push(recipe_step);
    }

    // DAG 环检测
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    for step in &steps {
        in_degree.entry(step.id.as_str()).or_insert(0);
        for dep in &step.depends_on {
            *in_degree.entry(dep.as_str()).or_insert(0) += 0;
            *in_degree.entry(step.id.as_str()).or_insert(0) += 1;
        }
    }
    let mut queue: Vec<&str> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();
    let mut visited = 0;
    while let Some(node) = queue.pop() {
        visited += 1;
        for step in &steps {
            if step.depends_on.iter().any(|d| d == node) {
                let deg = in_degree.get_mut(step.id.as_str()).unwrap();
                *deg -= 1;
                if *deg == 0 {
                    queue.push(step.id.as_str());
                }
            }
        }
    }
    if visited < steps.len() {
        return Err("Circular dependency detected in AI-generated steps".to_string());
    }

    if let Some(reasoning) = &reasoning {
        tracing::info!(reasoning = %reasoning, "[validate_and_convert] Recipe reasoning");
    }

    Ok(steps)
}
