pub use sea_orm_migration::prelude::*;

// Database migration modules - organized by creation order
#[path = "001_create_platforms_table.rs"]
mod create_platforms;

#[path = "002_create_user_profiles_table.rs"]
mod create_user_profiles;

#[path = "003_create_user_activities_table.rs"]
mod create_user_activities;

#[path = "004_create_analysis_results_table.rs"]
mod create_analysis_results;

#[path = "005_create_configurations_table.rs"]
mod create_configurations;

#[path = "006_create_api_keys_table.rs"]
mod create_api_keys;

#[path = "007_create_fetch_jobs_table.rs"]
mod create_fetch_jobs;

#[path = "008_create_reports_table.rs"]
mod create_reports;

#[path = "009_create_users_table.rs"]
mod create_users;

#[path = "010_add_local_auth.rs"]
mod add_local_auth;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(create_platforms::Migration),
            Box::new(create_users::Migration),
            Box::new(create_user_profiles::Migration),
            Box::new(create_user_activities::Migration),
            Box::new(create_analysis_results::Migration),
            Box::new(create_configurations::Migration),
            Box::new(create_api_keys::Migration),
            Box::new(create_fetch_jobs::Migration),
            Box::new(create_reports::Migration),
            Box::new(add_local_auth::Migration),
        ]
    }
}
