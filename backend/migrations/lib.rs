pub use sea_orm_migration::prelude::*;

// 单一统一的数据库结构定义
#[path = "001_initial_schema.rs"]
mod initial_schema;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(initial_schema::Migration),
        ]
    }
}
