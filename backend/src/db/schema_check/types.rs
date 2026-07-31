//! Schema check type definitions.

/// 列定义
#[derive(Debug, Clone)]
pub(crate) struct ColumnDef {
    pub name: String,
    pub data_type: String,
    #[allow(dead_code)]
    pub is_nullable: bool,
    pub default_value: Option<String>,
}

/// 表定义
#[derive(Debug, Clone)]
pub(crate) struct TableDef {
    pub name: String,
    pub columns: Vec<ColumnDef>,
}

/// 索引定义
#[derive(Debug, Clone)]
pub(crate) struct IndexDef {
    pub name: String,
    pub table: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
}
