//! Persistent state on the bind-mounted /state directory.
//!
//! Layout (see docs/updater-spec.md §6):
//!   state/
//!     updater.json
//!     maintenance.json
//!     job.current
//!     job.<id>.json
//!     lock                  (flock-style process lock)
//!     manual-override       (touch to enable rescue endpoints)
//!     snapshots/            (pgdata snapshots)
//!     snapshots.json
//!     history.log           (append-only)
//!     env-probe.json
//!     cache/                (release.json ETag/cache)
//!
//! All structured writes go through [`atomic::write_atomic`] which writes to a temp file in the
//! same directory, fsyncs, renames, then fsyncs the directory.

pub mod atomic;
pub mod history;
pub mod lock;
pub mod types;

use std::path::{Path, PathBuf};

use crate::error::{Result, UpdaterError};

pub use types::*;

/// Owned handle to the state directory. Holds an exclusive process lock for the lifetime
/// of the handle so we cannot accidentally run two updaters against the same state.
pub struct StateDir {
    root: PathBuf,
    _lock: lock::ProcessLock,
}

impl StateDir {
    /// Open (and create if missing) the state directory.
    /// Fails fast if another updater already holds the lock.
    pub fn open(root: &Path) -> Result<Self> {
        std::fs::create_dir_all(root)?;
        for sub in ["snapshots", "cache"] {
            std::fs::create_dir_all(root.join(sub))?;
        }
        let lock = lock::ProcessLock::acquire(&root.join("lock"))?;
        Ok(Self {
            root: root.to_path_buf(),
            _lock: lock,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn snapshots_dir(&self) -> PathBuf {
        self.root.join("snapshots")
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.root.join("cache")
    }

    pub fn manual_override_enabled(&self) -> bool {
        self.root.join("manual-override").exists()
    }

    pub fn read_updater(&self) -> Result<UpdaterStateFile> {
        let path = self.root.join("updater.json");
        if !path.exists() {
            return Ok(UpdaterStateFile::default());
        }
        let bytes = std::fs::read(&path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn write_updater(&self, st: &UpdaterStateFile) -> Result<()> {
        atomic::write_atomic_json(&self.root.join("updater.json"), st)
    }

    pub fn read_maintenance(&self) -> Result<MaintenanceFile> {
        let path = self.root.join("maintenance.json");
        if !path.exists() {
            return Ok(MaintenanceFile::inactive());
        }
        let bytes = std::fs::read(&path)?;
        // Fail-open: a corrupt maintenance file should NOT block traffic.
        Ok(serde_json::from_slice(&bytes).unwrap_or_else(|_| MaintenanceFile::inactive()))
    }

    pub fn write_maintenance(&self, m: &MaintenanceFile) -> Result<()> {
        atomic::write_atomic_json(&self.root.join("maintenance.json"), m)
    }

    pub fn clear_maintenance(&self) -> Result<()> {
        self.write_maintenance(&MaintenanceFile::inactive())
    }

    pub fn read_current_job(&self) -> Result<Option<String>> {
        let path = self.root.join("job.current");
        if !path.exists() {
            return Ok(None);
        }
        let s = std::fs::read_to_string(&path)?;
        Ok(Some(s.trim().to_string()).filter(|s| !s.is_empty()))
    }

    pub fn set_current_job(&self, id: Option<&str>) -> Result<()> {
        let path = self.root.join("job.current");
        match id {
            Some(id) => atomic::write_atomic_bytes(&path, id.as_bytes()),
            None => {
                if path.exists() {
                    std::fs::remove_file(&path)?;
                }
                Ok(())
            }
        }
    }

    pub fn read_job(&self, id: &str) -> Result<Job> {
        let path = self.job_path(id);
        let bytes = std::fs::read(&path)
            .map_err(|_| UpdaterError::NotFound(format!("job {id}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn write_job(&self, job: &Job) -> Result<()> {
        atomic::write_atomic_json(&self.job_path(&job.id), job)
    }

    pub fn list_jobs(&self) -> Result<Vec<String>> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if let Some(id) = name.strip_prefix("job.").and_then(|s| s.strip_suffix(".json")) {
                if id != "current" {
                    out.push(id.to_string());
                }
            }
        }
        Ok(out)
    }

    fn job_path(&self, id: &str) -> PathBuf {
        self.root.join(format!("job.{id}.json"))
    }

    pub fn read_snapshots(&self) -> Result<SnapshotsFile> {
        let path = self.root.join("snapshots.json");
        if !path.exists() {
            return Ok(SnapshotsFile::default());
        }
        let bytes = std::fs::read(&path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn write_snapshots(&self, s: &SnapshotsFile) -> Result<()> {
        atomic::write_atomic_json(&self.root.join("snapshots.json"), s)
    }

    pub fn write_env_probe(&self, p: &crate::probe::EnvProbe) -> Result<()> {
        atomic::write_atomic_json(&self.root.join("env-probe.json"), p)
    }

    pub fn append_history(&self, line: &str) -> Result<()> {
        history::append(&self.root.join("history.log"), line)
    }
}
