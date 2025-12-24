// SeaORM entities will be generated here
// Run: sea-orm-cli generate entity -o src/models/entities

#![allow(clippy::empty_docs)]

pub mod metadata_history;
pub mod platform_metadata;
pub mod platform_reports;
pub mod platforms;

// Tapp 系统实体
pub mod tapp_storage;
pub mod tapp_store_sources;
pub mod tapp_user_activities;
pub mod tapp_widgets;
pub mod tapps;

// Tapp 定时任务系统
pub mod tapp_scheduled_tasks;
pub mod tapp_task_executions;

// Brew 阅读系统实体
pub mod brew_annotations;
pub mod brew_categories;
pub mod brew_comments;
pub mod brew_items;
pub mod brew_podcasts;
pub mod brew_sources;
pub mod brew_user_states;
pub mod rsshub_instances;
