//! Append-only audit log for security-relevant update lifecycle events.
//!
//! Lines are human- and machine-readable, matching the `audit: …` style used in
//! `history.log`, but persisted separately under `state/audit.log` so operators
//! can retain them independently of the noisier history stream.

use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use chrono::Utc;

use crate::error::Result;

/// Soft max size before a simple one-file rotate (`audit.log` → `audit.log.1`).
const MAX_AUDIT_BYTES: u64 = 8 * 1024 * 1024;

/// Append one audit line with timestamp. Fsyncs after write. Rotates when the
/// file exceeds [`MAX_AUDIT_BYTES`] (best-effort; rotation failure is ignored
/// so the primary append still proceeds when possible).
pub fn append(path: &Path, line: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    rotate_if_needed(path);

    let ts = Utc::now().to_rfc3339();
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "[{ts}] {line}")?;
    f.flush()?;
    f.sync_data()?;
    Ok(())
}

fn rotate_if_needed(path: &Path) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if meta.len() < MAX_AUDIT_BYTES {
        return;
    }
    let rotated = path.with_extension("log.1");
    let _ = std::fs::rename(path, &rotated);
}

/// Read the last `n` lines (for diagnostics / tests).
pub fn tail(path: &Path, n: usize) -> Result<Vec<String>> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut f = OpenOptions::new().read(true).open(path)?;
    let mut buf = String::new();
    // Prefer reading from the end for large files, but audit logs are small;
    // full read is fine under the soft cap.
    f.seek(SeekFrom::Start(0))?;
    f.read_to_string(&mut buf)?;
    let lines: Vec<&str> = buf.lines().collect();
    let start = lines.len().saturating_sub(n);
    Ok(lines[start..].iter().map(|s| s.to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn append_and_tail() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("audit.log");
        append(&path, "audit: test_event job=abc").unwrap();
        append(&path, "audit: another").unwrap();
        let lines = tail(&path, 10).unwrap();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("audit: test_event job=abc"));
        assert!(lines[1].contains("audit: another"));
    }

    #[test]
    fn rotates_when_large() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("audit.log");
        // Write a chunk past the soft limit by temporarily using a small file
        // then calling rotate logic via a large synthetic file.
        {
            let mut f = OpenOptions::new()
                .create(true)
                .write(true)
                .open(&path)
                .unwrap();
            let chunk = vec![b'x'; MAX_AUDIT_BYTES as usize + 1];
            f.write_all(&chunk).unwrap();
        }
        append(&path, "audit: after_rotate").unwrap();
        assert!(path.exists());
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("audit: after_rotate"));
        assert!(path.with_extension("log.1").exists());
    }
}
