//! Tapp UI notification enqueue (host NotificationManager).
//!
//! Domain normalizes type/title/message and queues through the shared manager so
//! API handlers and future agent/scheduler paths do not re-implement bounds.
//! The HTTP layer maps [`TappNotificationError`] and owns grant/permission checks.

use crate::services::agent::notifications::get_notification_manager;

const MAX_TITLE_CHARS: usize = 200;
const MAX_MESSAGE_CHARS: usize = 4000;

/// Domain errors for Tapp notification enqueue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TappNotificationError {
    ManagerUnavailable,
}

impl TappNotificationError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ManagerUnavailable => "NOTIFICATION_SYSTEM_UNAVAILABLE",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::ManagerUnavailable => "Notification system not initialized",
        }
    }

    pub fn status_hint(&self) -> u16 {
        match self {
            Self::ManagerUnavailable => 503,
        }
    }
}

impl std::fmt::Display for TappNotificationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for TappNotificationError {}

/// Normalize a client-supplied notification type to the allowed host set.
pub fn normalize_notification_type(value: &str) -> &'static str {
    match value {
        "success" | "warning" | "error" | "danger" | "info" => match value {
            "success" => "success",
            "warning" => "warning",
            "error" => "error",
            "danger" => "danger",
            _ => "info",
        },
        _ => "info",
    }
}

/// Truncate title/message to the host UI contract (Unicode scalar chars).
pub fn sanitize_title(title: Option<&str>) -> Option<String> {
    title.map(|value| value.chars().take(MAX_TITLE_CHARS).collect())
}

pub fn sanitize_message(message: &str) -> String {
    message.chars().take(MAX_MESSAGE_CHARS).collect()
}

/// Enqueue a Tapp-originated notification for the subject user.
pub async fn create_tapp_notification(
    user_id: i32,
    tapp_id: &str,
    title: Option<&str>,
    message: &str,
    notification_type: &str,
) -> Result<String, TappNotificationError> {
    let manager = get_notification_manager().ok_or(TappNotificationError::ManagerUnavailable)?;
    let kind = normalize_notification_type(notification_type);
    let title = sanitize_title(title);
    let message = sanitize_message(message);
    let notification_id = manager
        .notify_tapp(user_id, tapp_id, title.as_deref(), &message, kind)
        .await;
    Ok(notification_id)
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_notification_type, sanitize_message, sanitize_title, TappNotificationError,
    };

    #[test]
    fn notification_types_are_whitelisted() {
        assert_eq!(normalize_notification_type("success"), "success");
        assert_eq!(normalize_notification_type("warning"), "warning");
        assert_eq!(normalize_notification_type("error"), "error");
        assert_eq!(normalize_notification_type("danger"), "danger");
        assert_eq!(normalize_notification_type("info"), "info");
        assert_eq!(normalize_notification_type("toast"), "info");
        assert_eq!(normalize_notification_type(""), "info");
    }

    #[test]
    fn title_and_message_are_bounded() {
        let long_title: String = "题".repeat(250);
        let title = sanitize_title(Some(&long_title)).unwrap();
        assert_eq!(title.chars().count(), 200);

        let long_msg: String = "a".repeat(5000);
        let msg = sanitize_message(&long_msg);
        assert_eq!(msg.len(), 4000);

        assert!(sanitize_title(None).is_none());
    }

    #[test]
    fn error_codes_preserve_api_contract() {
        assert_eq!(
            TappNotificationError::ManagerUnavailable.code(),
            "NOTIFICATION_SYSTEM_UNAVAILABLE"
        );
        assert_eq!(
            TappNotificationError::ManagerUnavailable.message(),
            "Notification system not initialized"
        );
        assert_eq!(TappNotificationError::ManagerUnavailable.status_hint(), 503);
    }
}
