use sea_orm::{Database, DatabaseConnection, DbErr};

pub async fn establish_connection(database_url: &str) -> Result<DatabaseConnection, DbErr> {
    let db = Database::connect(database_url).await?;
    Ok(db)
}
