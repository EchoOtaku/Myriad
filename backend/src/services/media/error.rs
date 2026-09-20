//! Domain errors for the platform media service.
//!
//! Public labels never include filesystem paths, SQL, or credentials.

use myriad_error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MediaError {
    Invalid { label: String },
    TooLarge { max_bytes: usize },
    NotReady,
    InUse,
    PublicInUse,
    StoreFailed,
    Missing,
    Conflict { label: String },
}

impl MediaError {
    pub fn invalid(label: impl Into<String>) -> Self {
        Self::Invalid {
            label: label.into(),
        }
    }

    pub fn conflict(label: impl Into<String>) -> Self {
        Self::Conflict {
            label: label.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Invalid { .. } => "MEDIA_INVALID",
            Self::TooLarge { .. } => "MEDIA_TOO_LARGE",
            Self::NotReady => "MEDIA_NOT_READY",
            Self::InUse => "MEDIA_IN_USE",
            Self::PublicInUse => "MEDIA_PUBLIC_IN_USE",
            Self::StoreFailed => "MEDIA_STORE_FAILED",
            Self::Missing => "MEDIA_MISSING",
            Self::Conflict { .. } => "MEDIA_INVALID",
        }
    }

    pub fn into_app_error(self) -> AppError {
        let code = self.code();
        match self {
            Self::Invalid { label } | Self::Conflict { label } => {
                AppError::bad_request(label).with_code(code)
            }
            Self::TooLarge { max_bytes } => AppError::from_status_u16(413, "File too large")
                .with_code(code)
                .with_details(serde_json::json!({ "max_bytes": max_bytes })),
            Self::NotReady => AppError::conflict("Media is not ready").with_code(code),
            Self::InUse => AppError::conflict("This file is still in use and cannot be deleted.")
                .with_code(code),
            Self::PublicInUse => {
                AppError::conflict("This file is still published and cannot be made private.")
                    .with_code(code)
            }
            Self::StoreFailed => AppError::internal("Failed to store media").with_code(code),
            Self::Missing => AppError::not_found("Media not found").with_code(code),
        }
    }
}

impl std::fmt::Display for MediaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid { label } | Self::Conflict { label } => f.write_str(label),
            Self::TooLarge { .. } => f.write_str("File too large"),
            Self::NotReady => f.write_str("Media is not ready"),
            Self::InUse => f.write_str("This file is still in use and cannot be deleted."),
            Self::PublicInUse => {
                f.write_str("This file is still published and cannot be made private.")
            }
            Self::StoreFailed => f.write_str("Failed to store media"),
            Self::Missing => f.write_str("Media not found"),
        }
    }
}

impl From<MediaError> for AppError {
    fn from(error: MediaError) -> Self {
        error.into_app_error()
    }
}

impl From<sea_orm::DbErr> for MediaError {
    fn from(error: sea_orm::DbErr) -> Self {
        tracing::error!(%error, "media database error");
        Self::StoreFailed
    }
}

impl From<std::io::Error> for MediaError {
    fn from(error: std::io::Error) -> Self {
        tracing::error!(error = %error, "media store io error");
        Self::StoreFailed
    }
}
