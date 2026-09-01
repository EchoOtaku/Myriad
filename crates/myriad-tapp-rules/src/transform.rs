//! Transform pipeline types and caps. Evaluation lands in later slices.

use serde::Deserialize;
use serde_json::Value;

pub const MAX_PIPELINE_STEPS: usize = 20;
pub const MAX_MAP_OPERATIONS: usize = 50;

/// Domain errors for pure pipeline evaluation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataTransformError {
    TooManySteps,
    TooManyMapOps,
}

impl DataTransformError {
    #[allow(dead_code)] // Stable machine code for future API adapters.
    pub fn code(&self) -> &'static str {
        match self {
            Self::TooManySteps => "TRANSFORM_TOO_MANY_STEPS",
            Self::TooManyMapOps => "TRANSFORM_TOO_MANY_MAP_OPS",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::TooManySteps => "Too many pipeline steps (max 20)",
            Self::TooManyMapOps => "Too many map operations (max 50)",
        }
    }

    pub fn status_hint(&self) -> u16 {
        400
    }
}

impl std::fmt::Display for DataTransformError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for DataTransformError {}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum ProcessStep {
    #[serde(rename = "filter")]
    Filter {
        field: String,
        operator: String,
        value: Value,
    },
    #[serde(rename = "sort")]
    Sort {
        field: String,
        order: Option<String>,
    },
    #[serde(rename = "limit")]
    Limit { count: usize },
    #[serde(rename = "offset")]
    Offset { count: usize },
    #[serde(rename = "select")]
    Select { fields: Vec<String> },
    #[serde(rename = "group")]
    Group { by: String },
    #[serde(rename = "aggregate")]
    Aggregate {
        operation: String,
        field: Option<String>,
    },
    #[serde(rename = "dedupe")]
    Dedupe { key: String },
    #[serde(rename = "map")]
    Map { operations: Vec<MapOp> },
}

/// 声明式字段映射操作（纯数据驱动，无表达式求值，杜绝注入风险）
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op")]
pub enum MapOp {
    /// 重命名字段：`{ "op": "rename", "from": "old", "to": "new" }`
    #[serde(rename = "rename")]
    Rename { from: String, to: String },
    /// 删除字段：`{ "op": "remove", "field": "name" }`
    #[serde(rename = "remove")]
    Remove { field: String },
    /// 设置静态值：`{ "op": "set", "field": "status", "value": "active" }`
    #[serde(rename = "set")]
    Set { field: String, value: Value },
    /// 复制字段：`{ "op": "copy", "from": "title", "to": "name" }`
    #[serde(rename = "copy")]
    Copy { from: String, to: String },
    /// 模板插值：`{ "op": "template", "field": "label", "template": "{title} - {artist}" }`
    /// 仅支持 `{fieldName}` 占位符，不执行任何表达式
    #[serde(rename = "template")]
    Template { field: String, template: String },
    /// 转小写：`{ "op": "lower", "field": "name" }`
    #[serde(rename = "lower")]
    Lower { field: String },
    /// 转大写：`{ "op": "upper", "field": "name" }`
    #[serde(rename = "upper")]
    Upper { field: String },
    /// 转字符串：`{ "op": "to_string", "field": "count" }`
    #[serde(rename = "to_string")]
    ToString { field: String },
    /// 转数字：`{ "op": "to_number", "field": "score" }`
    #[serde(rename = "to_number")]
    ToNumber { field: String },
    /// 取默认值：`{ "op": "default", "field": "cover", "value": "/placeholder.png" }`
    #[serde(rename = "default")]
    Default { field: String, value: Value },
    /// 字段拼接：`{ "op": "concat", "fields": ["first", "last"], "separator": " ", "to": "name" }`
    #[serde(rename = "concat")]
    Concat {
        fields: Vec<String>,
        separator: Option<String>,
        to: String,
    },
    /// 多字段取优先非空值：`{ "op": "coalesce", "fields": ["name_cn", "name_en", "id"], "to": "display_name" }`
    #[serde(rename = "coalesce")]
    Coalesce { fields: Vec<String>, to: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn transform_caps_and_error_codes() {
        assert_eq!(MAX_PIPELINE_STEPS, 20);
        assert_eq!(MAX_MAP_OPERATIONS, 50);
        let steps = DataTransformError::TooManySteps;
        assert_eq!(steps.code(), "TRANSFORM_TOO_MANY_STEPS");
        assert_eq!(steps.message(), "Too many pipeline steps (max 20)");
        assert_eq!(steps.status_hint(), 400);
        assert_eq!(steps.to_string(), steps.message());
        let maps = DataTransformError::TooManyMapOps;
        assert_eq!(maps.code(), "TRANSFORM_TOO_MANY_MAP_OPS");
        assert_eq!(maps.message(), "Too many map operations (max 50)");
        assert_eq!(maps.status_hint(), 400);
    }

    #[test]
    fn process_step_and_map_op_deserialize() {
        let filter: ProcessStep = serde_json::from_value(json!({
            "type": "filter",
            "field": "score",
            "operator": "eq",
            "value": 2
        }))
        .unwrap();
        match filter {
            ProcessStep::Filter {
                field,
                operator,
                value,
            } => {
                assert_eq!(field, "score");
                assert_eq!(operator, "eq");
                assert_eq!(value, json!(2));
            }
            _ => panic!("expected filter"),
        }

        let rename: MapOp = serde_json::from_value(json!({
            "op": "rename",
            "from": "old",
            "to": "new"
        }))
        .unwrap();
        match rename {
            MapOp::Rename { from, to } => {
                assert_eq!(from, "old");
                assert_eq!(to, "new");
            }
            _ => panic!("expected rename"),
        }
    }
}
