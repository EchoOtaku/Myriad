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
//! Restore is the reverse: stop postgres, then put the snapshot back into `pgdata`.
//!
//! **Bind-mount caveat**: production compose mounts `./pgdata` at `/host/pgdata`. That path
//! is a *mount point* inside the updater container, so `rename(pgdata, pgdata.broken…)` returns
//! `EBUSY (os error 16)`. When rename fails that way we fall back to in-place content replace
//! (clear children of the mount, copy snapshot contents in), and keep a safety copy under
//! `state/snapshots/`.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use chrono::Utc;
use sha2::{Digest, Sha256};
use tokio::process::Command;
use tracing::{info, warn};
use walkdir::WalkDir;

use crate::error::{Result, UpdaterError};
use crate::state::{SnapshotMeta, StateDir};
use crate::version::DeployTag;

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
        source_version: Option<DeployTag>,
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

        // 2. cp -a (--reflink=auto on Linux; plain -a elsewhere / on fallback)
        if let Err(e) = copy_tree(&self.pgdata, &tmp).await {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(UpdaterError::Internal(anyhow::anyhow!(
                "cp pgdata → snapshot failed: {e}"
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
    ///
    /// Strategy:
    /// 1. Prefer renaming the existing pgdata directory aside (fast, clean).
    /// 2. If rename fails with EBUSY (typical for bind-mount points like `/host/pgdata`),
    ///    fall back to in-place content replace: safety-copy current contents under
    ///    `state/snapshots/`, wipe children of the mount, then copy snapshot contents in.
    ///
    /// The snapshot itself is always *copied* (never renamed away) so retry remains possible.
    pub async fn restore(&self, snapshot_id: &str) -> Result<()> {
        let snap_path = self.state.snapshots_dir().join(snapshot_id);
        if !snap_path.exists() {
            return Err(UpdaterError::NotFound(format!(
                "snapshot {snapshot_id} does not exist on disk"
            )));
        }

        let ts = Utc::now().format("%Y%m%dT%H%M%SZ");
        let broken_sibling = self.pgdata.with_extension(format!("broken.{ts}"));

        if self.pgdata.exists() {
            match std::fs::rename(&self.pgdata, &broken_sibling) {
                Ok(()) => {
                    info!(
                        from = %self.pgdata.display(),
                        to = %broken_sibling.display(),
                        "pgdata moved aside via rename"
                    );
                    if let Err(e) = copy_tree(&snap_path, &self.pgdata).await {
                        // Best-effort undo of the rename.
                        if broken_sibling.exists() && !self.pgdata.exists() {
                            let _ = std::fs::rename(&broken_sibling, &self.pgdata);
                        }
                        return Err(e);
                    }
                    fsync_dir(&self.pgdata)?;
                    info!(snapshot = %snapshot_id, "pgdata restored from snapshot (rename path)");
                    return Ok(());
                }
                Err(e) if is_busy(&e) => {
                    warn!(
                        err = %e,
                        path = %self.pgdata.display(),
                        "rename of pgdata failed (likely bind-mount point); using in-place restore"
                    );
                    return self
                        .restore_in_place(&snap_path, snapshot_id, &ts.to_string())
                        .await;
                }
                Err(e) => {
                    return Err(UpdaterError::Internal(anyhow::anyhow!(
                        "rename pgdata aside failed: {e}"
                    )));
                }
            }
        }

        // No existing pgdata — just materialize the snapshot.
        copy_tree(&snap_path, &self.pgdata).await?;
        fsync_dir(&self.pgdata)?;
        info!(snapshot = %snapshot_id, "pgdata restored from snapshot (empty target)");
        Ok(())
    }

    /// In-place restore when `pgdata` cannot be renamed (mount point / EBUSY).
    async fn restore_in_place(&self, snap_path: &Path, snapshot_id: &str, ts: &str) -> Result<()> {
        std::fs::create_dir_all(&self.pgdata)?;

        // Safety copy of current (possibly half-upgraded) contents so operators can recover.
        let safety = self
            .state
            .snapshots_dir()
            .join(format!("broken-inplace-{ts}"));
        if safety.exists() {
            std::fs::remove_dir_all(&safety)?;
        }
        if dir_has_entries(&self.pgdata)? {
            info!(
                safety = %safety.display(),
                "copying current pgdata contents aside before in-place restore"
            );
            if let Err(e) = copy_tree(&self.pgdata, &safety).await {
                warn!(err = %e, "safety copy of current pgdata failed; continuing with restore");
                let _ = std::fs::remove_dir_all(&safety);
            }
        }

        // Wipe children of the mount point (cannot remove the mount itself).
        clear_dir_contents(&self.pgdata)?;

        // `cp -a snap/. dest/` copies *contents* into the existing mount directory.
        copy_tree_into(snap_path, &self.pgdata).await?;
        fsync_dir(&self.pgdata)?;
        info!(
            snapshot = %snapshot_id,
            safety = %safety.display(),
            "pgdata restored from snapshot (in-place / mount-point path)"
        );
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

fn is_busy(e: &std::io::Error) -> bool {
    // Linux: EBUSY = 16. Also accept ErrorKind::ResourceBusy / Other with "busy" text
    // for portability across libc wrappers.
    e.raw_os_error() == Some(16)
        || e.kind() == ErrorKind::ResourceBusy
        || e.to_string().to_ascii_lowercase().contains("busy")
}

fn dir_has_entries(dir: &Path) -> Result<bool> {
    let mut rd = std::fs::read_dir(dir)?;
    Ok(rd.next().is_some())
}

fn clear_dir_contents(dir: &Path) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let ft = entry.file_type()?;
        if ft.is_dir() {
            std::fs::remove_dir_all(&path)?;
        } else {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}

/// Copy `src` directory to a new `dst` path (`cp -a src dst`).
/// Tries `--reflink=auto` first (cheap on btrfs/xfs); falls back to plain `-a`
/// for macOS / filesystems that reject the flag.
async fn copy_tree(src: &Path, dst: &Path) -> Result<()> {
    cp_a(&[src.as_os_str()], dst).await
}

/// Copy *contents* of `src` into existing directory `dst` (`cp -a src/. dst/`).
async fn copy_tree_into(src: &Path, dst: &Path) -> Result<()> {
    let src_dot = src.join(".");
    cp_a(&[src_dot.as_os_str()], dst).await
}

async fn cp_a(srcs: &[&std::ffi::OsStr], dst: &Path) -> Result<()> {
    // Prefer reflink when available.
    let mut args: Vec<std::ffi::OsString> = vec!["-a".into(), "--reflink=auto".into()];
    for s in srcs {
        args.push((*s).to_os_string());
    }
    args.push(dst.as_os_str().to_os_string());
    let status = Command::new("cp")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .await
        .map_err(|e| UpdaterError::Internal(anyhow::anyhow!("spawn cp: {e}")))?;
    if status.success() {
        return Ok(());
    }

    // Fallback without reflink (macOS BSD cp, older coreutils, etc.).
    let mut args: Vec<std::ffi::OsString> = vec!["-a".into()];
    for s in srcs {
        args.push((*s).to_os_string());
    }
    args.push(dst.as_os_str().to_os_string());
    let status = Command::new("cp")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .await
        .map_err(|e| UpdaterError::Internal(anyhow::anyhow!("spawn cp: {e}")))?;
    if !status.success() {
        return Err(UpdaterError::Internal(anyhow::anyhow!(
            "cp → {} failed: {:?}",
            dst.display(),
            status
        )));
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::StateDir;
    use tempfile::tempdir;

    fn write_file(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    #[tokio::test]
    async fn restore_via_rename_when_possible() {
        let dir = tempdir().unwrap();
        let state = StateDir::open(&dir.path().join("state")).unwrap();
        let pgdata = dir.path().join("pgdata");
        write_file(&pgdata.join("PG_VERSION"), "18\n");
        write_file(&pgdata.join("base/1"), "live\n");

        let mgr = SnapshotManager {
            state: &state,
            pgdata: pgdata.clone(),
        };
        mgr.create("snap-a", None).await.unwrap();

        // Mutate live data after snapshot.
        write_file(&pgdata.join("base/1"), "mutated\n");

        mgr.restore("snap-a").await.unwrap();
        assert_eq!(
            std::fs::read_to_string(pgdata.join("base/1")).unwrap(),
            "live\n"
        );
    }

    #[tokio::test]
    async fn restore_in_place_when_rename_busy() {
        // Call restore_in_place directly after planting a snapshot.
        let dir = tempdir().unwrap();
        let state = StateDir::open(&dir.path().join("state")).unwrap();
        let pgdata = dir.path().join("pgdata");
        write_file(&pgdata.join("PG_VERSION"), "18\n");
        write_file(&pgdata.join("base/1"), "live\n");

        let mgr = SnapshotManager {
            state: &state,
            pgdata: pgdata.clone(),
        };
        mgr.create("snap-b", None).await.unwrap();
        write_file(&pgdata.join("base/1"), "mutated\n");
        write_file(&pgdata.join("extra"), "should-go\n");

        let snap = state.snapshots_dir().join("snap-b");
        mgr.restore_in_place(&snap, "snap-b", "testts")
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(pgdata.join("base/1")).unwrap(),
            "live\n"
        );
        assert!(!pgdata.join("extra").exists());
        // Safety copy retained.
        let safety = state.snapshots_dir().join("broken-inplace-testts");
        assert!(safety.join("extra").exists());
    }

    #[test]
    fn is_busy_detects_ebusy() {
        let e = std::io::Error::from_raw_os_error(16);
        assert!(is_busy(&e));
        let e2 = std::io::Error::other("Device or resource busy");
        assert!(is_busy(&e2));
        let e3 = std::io::Error::new(ErrorKind::NotFound, "no such file");
        assert!(!is_busy(&e3));
    }
}
