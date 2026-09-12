//! PostgreSQL is the durable source; NOTIFY carries only a row identity, never
//! notification bodies. INSERT/UPDATE and wakeup commit in one statement. LISTEN
//! reconnects and periodic resync recover missed wakeups (NOTIFY is not a queue).
use super::*;
use sea_orm::DatabaseBackend;
use std::time::Duration;

const CHANNEL: &str = "myriad_notification_changes";
static ORIGIN: OnceLock<String> = OnceLock::new();

fn origin() -> &'static str {
    ORIGIN.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

#[derive(Serialize, Deserialize)]
struct Change {
    origin: String,
    id: String,
    user_id: i32,
}

pub(super) async fn persist(
    db: &DatabaseConnection,
    notification: &Notification,
    upsert: bool,
) -> Result<(), sea_orm::DbErr> {
    let user_id = notification
        .user_id
        .expect("owner validated before persistence");
    let change = serde_json::to_string(&Change {
        origin: origin().into(),
        id: notification.id.clone(),
        user_id,
    })
    .expect("scalar notification identity");
    let conflict = if upsert {
        "ON CONFLICT (id) DO UPDATE SET notification_type = EXCLUDED.notification_type,
         priority = EXCLUDED.priority, title = EXCLUDED.title, body = EXCLUDED.body,
         metadata = EXCLUDED.metadata, read = EXCLUDED.read, created_at = EXCLUDED.created_at
         WHERE agent_notifications.user_id = EXCLUDED.user_id"
    } else {
        ""
    };
    db.execute_raw(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        format!(
            "WITH written AS (
            INSERT INTO agent_notifications
                (id, notification_type, priority, title, body, user_id, metadata, read, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) {conflict} RETURNING id
        ) SELECT pg_notify($10, $11) FROM written"
        ),
        vec![
            notification.id.clone().into(),
            notification.notification_type.as_str().into(),
            notification.priority.as_str().into(),
            notification.title.clone().into(),
            notification.body.clone().into(),
            user_id.into(),
            notification.metadata.clone().into(),
            notification.read.into(),
            notification.created_at.fixed_offset().into(),
            CHANNEL.into(),
            change.into(),
        ],
    ))
    .await?;
    Ok(())
}

pub(super) fn spawn(manager: Arc<NotificationManager>) {
    let Some(db) = manager.db.as_ref() else {
        return;
    };
    let pool = db.get_postgres_connection_pool().clone();
    tokio::spawn(async move {
        loop {
            match sea_orm::sqlx::postgres::PgListener::connect_with(&pool).await {
                Ok(mut listener) => {
                    if listener.listen(CHANNEL).await.is_ok() {
                        // Clear cached data from before a reconnect; DB reads are authoritative.
                        manager.history.write().await.clear();
                        let _ = manager.tx.send(NotificationEvent::Resync { lagged_by: 0 });
                        // try_recv returns None after a connection loss, so silent reconnects
                        // also generate resync instead of losing the gap invisibly.
                        loop {
                            match listener.try_recv().await {
                                Ok(Some(message)) => {
                                    if let Ok(change) =
                                        serde_json::from_str::<Change>(message.payload())
                                    {
                                        if change.origin != origin() && change.id.len() <= 512 {
                                            manager.receive_external(change).await;
                                        }
                                    }
                                }
                                Ok(None) => {
                                    manager.history.write().await.clear();
                                    let _ =
                                        manager.tx.send(NotificationEvent::Resync { lagged_by: 0 });
                                }
                                Err(_) => break,
                            }
                        }
                    }
                }
                Err(error) => tracing::warn!(%error, "notification listener unavailable"),
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

impl NotificationManager {
    async fn receive_external(&self, change: Change) {
        let Some(db) = &self.db else { return };
        match notif_entity::Entity::find_by_id(&change.id)
            .filter(notif_entity::Column::UserId.eq(change.user_id))
            .one(db)
            .await
        {
            Ok(Some(model)) => {
                let notification = Self::model_to_notification(model);
                if !self.notification_is_enabled(&notification).await {
                    return;
                }
                let mut history = self.history.write().await;
                history.retain(|entry| entry.id != notification.id);
                if history.len() >= self.max_history {
                    history.pop_front();
                }
                history.push_back(notification.clone());
                drop(history);
                let _ = self
                    .tx
                    .send(NotificationEvent::NewNotification { notification });
            }
            Ok(None) => {
                // Deleted between commit and consumption; never resurrect the old body.
                self.history
                    .write()
                    .await
                    .retain(|entry| entry.id != change.id);
                let _ = self.tx.send(NotificationEvent::NotificationDeleted {
                    id: change.id,
                    user_id: change.user_id,
                });
            }
            Err(error) => tracing::warn!(%error, "notification bridge row read failed"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ConnectOptions, Database};

    #[tokio::test]
    #[ignore = "requires a disposable MYRIAD_NOTIFICATION_BRIDGE_TEST_DB"]
    async fn committed_changes_cross_connections_without_reassigning_owners() {
        let url = std::env::var("MYRIAD_NOTIFICATION_BRIDGE_TEST_DB")
            .expect("disposable test DB required");
        let admin = Database::connect(&url).await.unwrap();
        let schema = format!("notification_bridge_{}", uuid::Uuid::new_v4().simple());
        admin
            .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
            .await
            .unwrap();
        let mut options = ConnectOptions::new(url);
        options.max_connections(4).map_sqlx_postgres_opts({
            let schema = schema.clone();
            move |options| options.options([("search_path", schema.as_str())])
        });
        let db = Database::connect(options).await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE agent_notifications (
            id TEXT PRIMARY KEY, notification_type TEXT NOT NULL, priority TEXT NOT NULL,
            title TEXT NOT NULL, body TEXT NOT NULL, user_id INTEGER, metadata JSONB,
            read BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL)",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, notification_preferences JSONB)",
        )
        .await
        .unwrap();
        let mut listener =
            sea_orm::sqlx::postgres::PgListener::connect_with(db.get_postgres_connection_pool())
                .await
                .unwrap();
        listener.listen(CHANNEL).await.unwrap();
        let (tx, _) = broadcast::channel(8);
        let manager = NotificationManager {
            tx,
            history: RwLock::new(VecDeque::new()),
            max_history: 8,
            db: Some(db.clone()),
        };
        let mut events = manager.subscribe();
        let mut notification = Notification::new(
            7654321,
            NotificationType::SystemInfo,
            NotificationPriority::Normal,
            "private title",
            "private body",
        );
        persist(&db, &notification, false).await.unwrap();
        let received = tokio::time::timeout(Duration::from_secs(2), listener.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(!received.payload().contains("private"));
        let change: Change = serde_json::from_str(received.payload()).unwrap();
        assert_eq!(change.user_id, 7654321);
        manager.receive_external(change).await;
        let event = events.recv().await.unwrap();
        assert!(event_is_for_user(&event, 7654321));
        assert!(!event_is_for_user(&event, 7654322));

        notification.body = "updated".into();
        persist(&db, &notification, true).await.unwrap();
        let received = tokio::time::timeout(Duration::from_secs(2), listener.recv())
            .await
            .unwrap()
            .unwrap();
        manager
            .receive_external(serde_json::from_str(received.payload()).unwrap())
            .await;
        assert_eq!(
            manager.get_history_for_user(7654321, 8).await[0].body,
            "updated"
        );
        assert_eq!(manager.history.read().await.len(), 1);
        let _ = events.recv().await.unwrap();

        // The same stable row ID cannot transfer a notification to another owner.
        notification.user_id = Some(7654322);
        persist(&db, &notification, true).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.recv())
                .await
                .is_err()
        );
        assert!(manager.get_history_for_user(7654322, 8).await.is_empty());
        // A deletion racing the listener must not resurrect a private body.
        db.execute_unprepared("DELETE FROM agent_notifications")
            .await
            .unwrap();
        manager
            .receive_external(Change {
                origin: "other".into(),
                id: notification.id,
                user_id: 7654321,
            })
            .await;
        assert!(matches!(
            events.recv().await.unwrap(),
            NotificationEvent::NotificationDeleted { .. }
        ));
        assert!(manager.history.read().await.is_empty());
        drop(listener);
        db.close().await.unwrap();
        admin
            .execute_unprepared(&format!("DROP SCHEMA {schema} CASCADE"))
            .await
            .unwrap();
    }
}
