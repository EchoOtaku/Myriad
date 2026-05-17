//! release.json schema (deserialization).
//!
//! Forward-compatible: unknown fields are ignored. Updaters must accept any
//! release.json with `schema_version <= SUPPORTED_RELEASE_SCHEMA` and reject higher.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{Result, UpdaterError};
use crate::version::MyriadVersion;
use crate::SUPPORTED_RELEASE_SCHEMA;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: u32,
    pub version: MyriadVersion,
    pub channel: String,
    pub released_at: DateTime<Utc>,
    #[serde(default)]
    pub min_from_version: Option<MyriadVersion>,
    pub images: HashMap<String, ImageRef>,
    pub env: EnvSpec,
    pub migrations: Migrations,
    pub updater: UpdaterReq,
    pub postgres: PostgresReq,
    pub notes_url: String,
    #[serde(default)]
    pub signature: Option<String>,
    /// Catch-all for forward-compat fields.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageRef {
    pub r#ref: String,
    pub digest: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnvSpec {
    #[serde(default)]
    pub required: Vec<String>,
    #[serde(default)]
    pub new: Vec<NewEnv>,
    #[serde(default)]
    pub removed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewEnv {
    pub name: String,
    pub required: bool,
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Migrations {
    pub irreversible: bool,
    pub estimated_seconds: u32,
    #[serde(default = "default_true")]
    pub requires_full_backup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdaterReq {
    pub min_updater_version: MyriadVersion,
    #[serde(default)]
    pub self_update_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostgresReq {
    pub min_pg_version: String,
    pub max_pg_version: String,
}

fn default_true() -> bool {
    true
}

impl Manifest {
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        let m: Self = serde_json::from_slice(bytes)?;
        m.validate()?;
        Ok(m)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version > SUPPORTED_RELEASE_SCHEMA {
            return Err(UpdaterError::Precondition(format!(
                "release.json schema_version {} > supported {}: please update the updater first",
                self.schema_version, SUPPORTED_RELEASE_SCHEMA
            )));
        }
        for required in ["backend", "frontend"] {
            if !self.images.contains_key(required) {
                return Err(UpdaterError::Precondition(format!(
                    "release.json missing required image: {required}"
                )));
            }
        }
        for (name, img) in &self.images {
            if !img.digest.starts_with("sha256:") || img.digest.len() != 71 {
                return Err(UpdaterError::Precondition(format!(
                    "image {name} has invalid digest: {}",
                    img.digest
                )));
            }
        }
        Ok(())
    }

    pub fn image(&self, comp: &str) -> Option<&ImageRef> {
        self.images.get(comp)
    }
}
