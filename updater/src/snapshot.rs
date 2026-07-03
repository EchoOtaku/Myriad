//! pgdata file-level snapshots. See spec §9.
//!
//! Steps (caller must ensure postgres is stopped before invoking `create`):
//!
//! 1. `sync -f pgdata`
//! 2. `cp -a --reflink=auto pgdata snapshots/<id>.tmp`
//! 3. fsync the snapshot
//! 4. rename to `snapshots/<id>`
//! 5. fsync snapshots dir
//! 6. record SnapshotMeta in snapshots.json
//!
//! Restore is the reverse: stop postgres, move pgdata aside, copy/rename snapshot back.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use chrono::Utc;
use sha2::{Digest, Sha256};
use tokio::process::Command;
use tracing::info;
use walkdir::WalkDir;

use crate::error::{Result, UpdaterError};
use crate::state::{SnapshotMeta, StateDir};
use crate::version::MyriadVersion;

pub struct SnapshotManager<'a> {
    pub state: &'a StateDir,
    pub pgdata: PathBuf,
}

impl<'a> SnapshotManager<'a> {
    /// Snapshot pgdata. Returns the snapshot id (matches caller-supplied job id for traceability).
    /// Caller is responsible for stopping postgres beforehand.
    pub async fn create(
        &self,
        snapshot_id: &str,
        source_version: Option<MyriadVersion>,
    ) -> Result<SnapshotMeta> {
        let snapshots_dir = self.state.snapshots_dir();
        std::fs::create_dir_all(&snapshots_dir)?;

        let tmp = snapshots_dir.join(format!("{snapshot_id}.tmp"));
        let final_path = snapshots_dir.join(snapshot_id);

        if final_path.exists() {
            return Err(UpdaterError::Precondition(format!(
                "snapshot {snapshot_id} already exists"
            )));
        }
        if tmp.exists() {
            std::fs::remove_dir_all(&tmp)?;
        }

        // 1. sync -f pgdata: best-effort.
        let _ = Command::new("sync")
            .arg("-f")
            .arg(&self.pgdata)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;

        // 2. cp -a --reflink=auto
        let status = Command::new("cp")
            .arg("-a")
            .arg("--reflink=auto")
            .arg(&self.pgdata)
            .arg(&tmp)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .status()
            .await
            .map_err(|e| UpdaterError::Internal(anyhow::anyhow!("spawn cp: {e}")))?;
        if !status.success() {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(UpdaterError::Internal(anyhow::anyhow!(
                "cp pgdata → snapshot failed: {:?}",
                status
            )));
        }

        // 3 + 4. fsync tmp dir then rename.
        fsync_dir(&tmp)?;
        std::fs::rename(&tmp, &final_path)?;
        // 5. fsync snapshots dir.
        fsync_dir(&snapshots_dir)?;

        // 6. record metadata.
        let (size, count, sample) = measure_and_sample(&final_path)?;
        let meta = SnapshotMeta {
            id: snapshot_id.to_string(),
            created_at: Utc::now(),
            source_version,
            size_bytes: size,
            file_count: count,
            keep: false,
            sample_sha256: Some(sample),
        };
        let mut sf = self.state.read_snapshots()?;
        sf.items.push(meta.clone());
        self.state.write_snapshots(&sf)?;
        info!(snapshot = %snapshot_id, size, count, "snapshot created");
        Ok(meta)
    }

    /// Restore pgdata from snapshot. Caller must stop postgres first.
    /// Strategy: rename the existing pgdata to pgdata.broken.<ts>, then copy snapshot into place.
    /// We deliberately use copy (not rename) of the snapshot so subsequent rollback attempts
    /// remain possible.
    pub async fn restore(&self, snapshot_id: &str) -> Result<()> {
        let snap_path = self.state.snapshots_dir().join(snapshot_id);
        if !snap_path.exists() {
            return Err(UpdaterError::NotFound(format!(
                "snapshot {snapshot_id} does not exist on disk"
            )));
        }

        // Move existing pgdata aside.
        let broken = self
            .pgdata
            .with_extension(format!("broken.{}", Utc::now().format("%Y%m%dT%H%M%SZ")));
        if self.pgdata.exists() {
            std::fs::rename(&self.pgdata, &broken)?;
        }

        let status = Command::new("cp")
            .arg("-a")
            .arg("--reflink=auto")
            .arg(&snap_path)
            .arg(&self.pgdata)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .status()
            .await
            .map_err(|e| UpdaterError::Internal(anyhow::anyhow!("spawn cp: {e}")))?;
        if !status.success() {
            // Try to roll back the rename.
            if broken.exists() && !self.pgdata.exists() {
                let _ = std::fs::rename(&broken, &self.pgdata);
            }
            return Err(UpdaterError::Internal(anyhow::anyhow!(
                "cp snapshot → pgdata failed: {:?}",
                status
            )));
        }
        fsync_dir(&self.pgdata)?;
        info!(snapshot = %snapshot_id, "pgdata restored from snapshot");
        Ok(())
    }

    /// Apply the keep-N retention policy described in spec §9.3.
    pub fn prune(&self, keep_n: usize) -> Result<Vec<String>> {
        let mut sf = self.state.read_snapshots()?;
        let cutoff = Utc::now() - chrono::Duration::hours(24);
        let mut keepers: Vec<&SnapshotMeta> = sf
            .items
            .iter()
            .filter(|m| m.keep || m.created_at >= cutoff)
            .collect();
        // Among the rest, keep the most recent N.
        let mut others: Vec<&SnapshotMeta> = sf
            .items
            .iter()
            .filter(|m| !m.keep && m.created_at < cutoff)
            .collect();
        others.sort_by_key(|m| std::cmp::Reverse(m.created_at));
        keepers.extend(others.iter().take(keep_n));
        let keep_ids: std::collections::HashSet<String> =
            keepers.iter().map(|m| m.id.clone()).collect();

        let mut removed = Vec::new();
        sf.items.retain(|m| {
            if keep_ids.contains(&m.id) {
                true
            } else {
                let p = self.state.snapshots_dir().join(&m.id);
                let _ = std::fs::remove_dir_all(&p);
                removed.push(m.id.clone());
                false
            }
        });
        self.state.write_snapshots(&sf)?;
        Ok(removed)
    }
}

fn fsync_dir(p: &Path) -> Result<()> {
    let f = std::fs::File::open(p)?;
    f.sync_all()?;
    Ok(())
}

/// Walk the snapshot tree to compute size, file count, and a sample digest covering the
/// first 4KB of up to 64 deterministic paths.
fn measure_and_sample(root: &Path) -> Result<(u64, u64, String)> {
    let mut size: u64 = 0;
    let mut count: u64 = 0;
    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            count += 1;
            if let Ok(meta) = entry.metadata() {
                size += meta.len();
            }
            paths.push(entry.path().to_path_buf());
        }
    }
    paths.sort();
    let mut hasher = Sha256::new();
    let sample_step = (paths.len().max(1) / 64).max(1);
    for p in paths.iter().step_by(sample_step).take(64) {
        if let Ok(bytes) = std::fs::read(p) {
            let head = &bytes[..bytes.len().min(4096)];
            hasher.update(p.to_string_lossy().as_bytes());
            hasher.update(b"\0");
            hasher.update(head);
        }
    }
    Ok((size, count, hex::encode(hasher.finalize())))
}
