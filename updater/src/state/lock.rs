//! Exclusive file lock for the state directory.

use std::fs::{File, OpenOptions};
use std::path::Path;

use fs2::FileExt;

use crate::error::{Result, UpdaterError};

pub struct ProcessLock {
    file: File,
}

impl ProcessLock {
    pub fn acquire(path: &Path) -> Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(path)?;
        file.try_lock_exclusive().map_err(|e| {
            UpdaterError::State(format!(
                "another updater process holds the state lock ({:?}): {e}",
                path
            ))
        })?;
        Ok(Self { file })
    }
}

impl Drop for ProcessLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}
