//! Filesystem probes: pgdata layout, .env existence and structural validity.

use std::collections::HashSet;
use std::path::Path;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgdataProbe {
    pub exists: bool,
    pub is_named_volume: bool,
    pub fs_type: Option<String>,
    pub device_id: Option<u64>,
    /// True if pgdata is on a different filesystem from snapshots dir.
    pub cross_device: bool,
    pub size_bytes: Option<u64>,
    pub free_bytes_on_fs: Option<u64>,
    pub error: Option<String>,
}

pub async fn probe_pgdata(path: &Path) -> PgdataProbe {
    let mut out = PgdataProbe {
        exists: false,
        is_named_volume: false,
        fs_type: None,
        device_id: None,
        cross_device: false,
        size_bytes: None,
        free_bytes_on_fs: None,
        error: None,
    };

    if !path.exists() {
        out.error = Some(format!("{} not present", path.display()));
        return out;
    }
    out.exists = true;

    // Heuristic: a docker named volume mounted as /var/lib/docker/volumes/<name>/_data is
    // a *bind* from updater's POV but the host path is inside docker's volume root.
    // We can't reliably detect from inside the container; instead rely on user contract:
    // we expect the user to bind-mount a host-side directory. If the host dir doesn't exist
    // at the expected path (./pgdata), the migration script flags it.
    // For now: assume bind mount unless explicitly disabled via env.
    out.is_named_volume = std::env::var("UPDATER_PGDATA_IS_NAMED_VOLUME")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    // Filesystem type via `stat -f -c %T` (linux). Fallback: skip.
    if let Ok(o) = Command::new("stat")
        .args(["-f", "-c", "%T", path.to_str().unwrap_or(".")])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
    {
        if o.status.success() {
            out.fs_type = Some(String::from_utf8_lossy(&o.stdout).trim().to_string());
        }
    }

    // Device id for cross-device detection.
    let dev_pgdata = device_id(path).ok();
    let dev_snapshots = device_id(Path::new("/state/snapshots")).ok();
    out.device_id = dev_pgdata;
    if let (Some(a), Some(b)) = (dev_pgdata, dev_snapshots) {
        out.cross_device = a != b;
    }

    // Size via du; cap timeout. Not critical to startup, swallow errors.
    if let Ok(Ok(o)) = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        Command::new("du")
            .args(["-sb", path.to_str().unwrap_or(".")])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output(),
    )
    .await
    {
        if o.status.success() {
            if let Some(first) = String::from_utf8_lossy(&o.stdout).split_whitespace().next() {
                out.size_bytes = first.parse().ok();
            }
        }
    }

    // Free space on the fs containing pgdata, via statvfs.
    if let Ok(stat) = nix::sys::statvfs::statvfs(path) {
        let block_size = stat.fragment_size();
        let free_blocks = stat.blocks_available() as u64;
        out.free_bytes_on_fs = Some(block_size * free_blocks);
    }

    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvFileProbe {
    pub exists: bool,
    pub duplicate_keys: bool,
    pub has_required_tag_vars: bool,
    pub known_required_present: Vec<String>,
    pub known_required_missing: Vec<String>,
    pub error: Option<String>,
}

pub async fn probe_env_file(path: &Path) -> EnvFileProbe {
    if !path.exists() {
        return EnvFileProbe {
            exists: false,
            duplicate_keys: false,
            has_required_tag_vars: false,
            known_required_present: vec![],
            known_required_missing: vec![],
            error: Some(format!("{} not found", path.display())),
        };
    }

    let s = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            return EnvFileProbe {
                exists: true,
                duplicate_keys: false,
                has_required_tag_vars: false,
                known_required_present: vec![],
                known_required_missing: vec![],
                error: Some(format!("read: {e}")),
            }
        }
    };

    let mut seen: HashSet<String> = HashSet::new();
    let mut dup = false;
    let mut keys: HashSet<String> = HashSet::new();
    for line in s.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        if let Some((k, _)) = t.split_once('=') {
            let k = k.trim().to_string();
            if !seen.insert(k.clone()) {
                dup = true;
            }
            keys.insert(k);
        }
    }

    let need_tag_vars = ["MYRIAD_TAG", "PROXY_TAG", "UPDATER_TAG"];
    let has_required_tag_vars = need_tag_vars.iter().all(|k| keys.contains(*k));

    let known_required = ["POSTGRES_PASSWORD", "JWT_SECRET", "CORS_ORIGINS"];
    let (present, missing): (Vec<_>, Vec<_>) = known_required
        .iter()
        .map(|s| s.to_string())
        .partition(|k| keys.contains(k));

    EnvFileProbe {
        exists: true,
        duplicate_keys: dup,
        has_required_tag_vars,
        known_required_present: present,
        known_required_missing: missing,
        error: None,
    }
}

#[cfg(unix)]
fn device_id(p: &Path) -> std::io::Result<u64> {
    use std::os::unix::fs::MetadataExt;
    Ok(std::fs::metadata(p)?.dev())
}

#[cfg(not(unix))]
fn device_id(_p: &Path) -> std::io::Result<u64> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "device_id unsupported on this platform",
    ))
}
