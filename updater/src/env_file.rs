//! Minimal `.env` parser/writer that preserves comments and blank-line layout.
//!
//! We deliberately do NOT support every shell quoting rule — only what we write ourselves.
//! Values may be unquoted (no spaces/quotes), single-quoted, or double-quoted.
//! Round-tripping unknown quoting is best-effort: we keep the raw line as-is and never
//! modify keys we don't explicitly touch.

use std::path::{Path, PathBuf};

use chrono::Utc;

use crate::error::{Result, UpdaterError};
use crate::state::atomic;

#[derive(Debug, Clone)]
pub struct EnvFile {
    path: PathBuf,
    lines: Vec<Line>,
}

#[derive(Debug, Clone)]
enum Line {
    Blank,
    Comment(String),
    KeyValue {
        key: String,
        // Raw RHS as it appears, minus leading/trailing whitespace.
        raw: String,
        // Parsed value, after stripping matching quotes.
        value: String,
    },
    /// Lines we don't understand. Preserved verbatim.
    Other(String),
}

impl EnvFile {
    pub fn load(path: &Path) -> Result<Self> {
        let s = std::fs::read_to_string(path)?;
        let mut lines = Vec::new();
        let mut seen_keys = std::collections::HashSet::new();
        for raw in s.lines() {
            let t = raw.trim();
            if t.is_empty() {
                lines.push(Line::Blank);
                continue;
            }
            if t.starts_with('#') {
                lines.push(Line::Comment(raw.to_string()));
                continue;
            }
            if let Some((k, rest)) = t.split_once('=') {
                let key = k.trim().to_string();
                if !is_valid_key(&key) {
                    lines.push(Line::Other(raw.to_string()));
                    continue;
                }
                if !seen_keys.insert(key.clone()) {
                    return Err(UpdaterError::Precondition(format!(
                        "duplicate key {key} in {}",
                        path.display()
                    )));
                }
                let raw_rhs = rest.trim().to_string();
                let value = strip_quotes(&raw_rhs);
                lines.push(Line::KeyValue {
                    key,
                    raw: raw_rhs,
                    value,
                });
            } else {
                lines.push(Line::Other(raw.to_string()));
            }
        }
        Ok(Self {
            path: path.to_path_buf(),
            lines,
        })
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.lines.iter().find_map(|l| match l {
            Line::KeyValue { key: k, value, .. } if k == key => Some(value.as_str()),
            _ => None,
        })
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.lines.iter().filter_map(|l| match l {
            Line::KeyValue { key, .. } => Some(key.as_str()),
            _ => None,
        })
    }

    /// Set the value of `key`. If the key doesn't exist, append at the end.
    /// Value is serialized with safe quoting.
    pub fn set(&mut self, key: &str, value: &str) -> Result<()> {
        if !is_valid_key(key) {
            return Err(UpdaterError::InvalidInput(format!(
                "invalid env key: {key}"
            )));
        }
        let quoted = quote_if_needed(value);
        for l in self.lines.iter_mut() {
            if let Line::KeyValue {
                key: k,
                raw,
                value: v,
            } = l
                && k == key {
                    *raw = quoted.clone();
                    *v = value.to_string();
                    return Ok(());
                }
        }
        self.lines.push(Line::KeyValue {
            key: key.to_string(),
            raw: quoted,
            value: value.to_string(),
        });
        Ok(())
    }

    /// Persist `.env`.
    ///
    /// If the parent directory allows sibling creates, use tmp+rename (crash-safe).
    /// Official compose bind-mounts `.env` over a read-only deploy root — there
    /// we snapshot into `UPDATER_STATE_DIR` and write the existing inode in place.
    /// Rename onto a file bind can still return EBUSY; that falls back in place.
    pub fn save(&self) -> Result<()> {
        persist_env_bytes(&self.path, self.render().as_bytes())
    }

    /// Preserve live Docker file bind mounts when synchronizing metadata without
    /// recreating their containers. Keep a backup before changing the inode.
    pub(crate) fn save_preserving_inode(&self) -> Result<()> {
        snapshot_before_save(&self.path)?;
        write_existing_file_in_place(&self.path, self.render().as_bytes())
    }

    fn render(&self) -> String {
        let mut s = String::new();
        for l in &self.lines {
            match l {
                Line::Blank => s.push('\n'),
                Line::Comment(c) => {
                    s.push_str(c);
                    s.push('\n');
                }
                Line::Other(o) => {
                    s.push_str(o);
                    s.push('\n');
                }
                Line::KeyValue { key, raw, .. } => {
                    s.push_str(key);
                    s.push('=');
                    s.push_str(raw);
                    s.push('\n');
                }
            }
        }
        s
    }
}

/// Write raw env-file bytes with the same probe-first policy as [`EnvFile::save`].
///
/// TCB rollback restores the exact pre-handoff snapshot and must not take a
/// sibling tmp+rename path that official RO deploy roots cannot complete.
pub(crate) fn persist_env_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    if parent_allows_sibling_creates(path) {
        if crate::probe::filesystem::path_is_present(path)? {
            snapshot_before_save(path)?;
        }
        return match atomic::write_atomic_bytes(path, bytes) {
            Ok(()) => Ok(()),
            Err(e) if needs_in_place_env_write(&e) => write_existing_file_in_place(path, bytes),
            Err(e) => Err(e),
        };
    }
    if crate::probe::filesystem::path_is_present(path)? {
        snapshot_into_state_dir(path)?;
    }
    write_existing_file_in_place(path, bytes)
}

fn is_valid_key(k: &str) -> bool {
    !k.is_empty()
        && k.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && k.chars().next().is_some_and(|c| !c.is_ascii_digit())
}

fn strip_quotes(s: &str) -> String {
    if s.len() >= 2 {
        let bytes = s.as_bytes();
        if (bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\'')
        {
            return s[1..s.len() - 1].to_string();
        }
    }
    s.to_string()
}

fn quote_if_needed(v: &str) -> String {
    let needs_quotes = v.is_empty()
        || v.chars()
            .any(|c| c.is_whitespace() || matches!(c, '#' | '"' | '\'' | '=' | '$'));
    if !needs_quotes {
        return v.to_string();
    }
    if !v.contains('\'') {
        return format!("'{v}'");
    }
    // Fall back to double-quoting with minimal escaping.
    let escaped = v.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn parent_allows_sibling_creates(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    nix::unistd::access(parent, nix::unistd::AccessFlags::W_OK).is_ok()
}

fn needs_in_place_env_write(err: &UpdaterError) -> bool {
    match err {
        UpdaterError::Io(error) => {
            matches!(
                error.kind(),
                std::io::ErrorKind::ReadOnlyFilesystem
                    | std::io::ErrorKind::PermissionDenied
                    | std::io::ErrorKind::ResourceBusy
            ) || matches!(error.raw_os_error(), Some(30) | Some(16))
        }
        _ => false,
    }
}

fn snapshot_before_save(path: &Path) -> Result<()> {
    let sibling = path.with_extension(format!("bak.{}", Utc::now().format("%Y%m%dT%H%M%SZ")));
    match std::fs::copy(path, &sibling) {
        Ok(_) => rotate_backups(path, 5),
        Err(error) => {
            let wrapped = UpdaterError::from(error);
            if !needs_in_place_env_write(&wrapped) {
                return Err(wrapped);
            }
            snapshot_into_state_dir(path)
        }
    }
}

fn snapshot_into_state_dir(path: &Path) -> Result<()> {
    let Some(state) = std::env::var_os("UPDATER_STATE_DIR") else {
        return Ok(());
    };
    let dir = PathBuf::from(state).join("env-backups");
    std::fs::create_dir_all(&dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or(".env");
    let backup = dir.join(format!(
        "{name}.bak.{}",
        Utc::now().format("%Y%m%dT%H%M%SZ")
    ));
    std::fs::copy(path, &backup)?;
    rotate_backups(&dir.join(name), 5)?;
    Ok(())
}

fn write_existing_file_in_place(path: &Path, data: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)?;
    file.write_all(data)?;
    file.flush()?;
    file.sync_all()?;
    Ok(())
}

fn rotate_backups(env_path: &Path, keep: usize) -> Result<()> {
    let parent = env_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = env_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(".env");
    let mut backups: Vec<PathBuf> = std::fs::read_dir(parent)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|n| n.starts_with(&format!("{stem}.bak.")))
        })
        .collect();
    backups.sort();
    while backups.len() > keep {
        let oldest = backups.remove(0);
        let _ = std::fs::remove_file(&oldest);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_preserves_order() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(".env");
        std::fs::write(
            &p,
            "# header\n\nMYRIAD_TAG=v0.1.0\nPROXY_TAG='v0.1.0'\nFOO=bar\n",
        )
        .unwrap();
        let e = EnvFile::load(&p).unwrap();
        assert_eq!(e.get("MYRIAD_TAG"), Some("v0.1.0"));
        assert_eq!(e.get("PROXY_TAG"), Some("v0.1.0"));
        assert_eq!(e.get("FOO"), Some("bar"));
    }

    #[test]
    fn set_existing_and_new() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(".env");
        std::fs::write(&p, "MYRIAD_TAG=v0.1.0\n").unwrap();
        let mut e = EnvFile::load(&p).unwrap();
        e.set("MYRIAD_TAG", "v0.2.0").unwrap();
        e.set("NEW_VAR", "hello world").unwrap();
        e.save().unwrap();
        let s = std::fs::read_to_string(&p).unwrap();
        assert!(s.contains("MYRIAD_TAG=v0.2.0"));
        assert!(s.contains("NEW_VAR='hello world'"));
    }

    /// MYR-040: `save` must go through atomic write (tmp + rename), not truncate-in-place.
    #[test]
    fn save_is_atomic_and_preserves_content() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(".env");
        std::fs::write(&p, "MYRIAD_TAG=v0.1.0\n# keep me\n").unwrap();
        let mut e = EnvFile::load(&p).unwrap();
        e.set("MYRIAD_TAG", "v0.3.0").unwrap();
        e.save().unwrap();
        let s = std::fs::read_to_string(&p).unwrap();
        assert!(s.contains("MYRIAD_TAG=v0.3.0"));
        assert!(s.contains("# keep me"));
        // Backup rotation leaves a .bak.* snapshot of the pre-save file.
        let backups: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(".env.bak."))
            })
            .collect();
        assert!(
            !backups.is_empty(),
            "atomic save should rotate a .env.bak.* before replace"
        );
    }

    #[test]
    fn save_over_read_only_parent_updates_the_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().join("ro");
        std::fs::create_dir(&parent).unwrap();
        let p = parent.join(".env");
        std::fs::write(&p, "MYRIAD_TAG=v0.1.0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut ro = std::fs::metadata(&parent).unwrap().permissions();
            ro.set_mode(0o555);
            std::fs::set_permissions(&parent, ro).unwrap();
        }
        let saved = (|| {
            let mut env = EnvFile::load(&p)?;
            env.set("MYRIAD_TAG", "dev-7a7f66e")?;
            env.save()
        })();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut rw = std::fs::metadata(&parent).unwrap().permissions();
            rw.set_mode(0o755);
            std::fs::set_permissions(&parent, rw).unwrap();
        }
        saved.unwrap();
        assert!(
            std::fs::read_to_string(&p)
                .unwrap()
                .contains("MYRIAD_TAG=dev-7a7f66e")
        );
    }

    #[test]
    fn persist_env_bytes_over_read_only_parent_keeps_existing_inode() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().join("ro");
        std::fs::create_dir(&parent).unwrap();
        let p = parent.join(".env");
        std::fs::write(&p, "UPDATER_TAG=v0.3.37\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut ro = std::fs::metadata(&parent).unwrap().permissions();
            ro.set_mode(0o555);
            std::fs::set_permissions(&parent, ro).unwrap();
        }
        let wrote = persist_env_bytes(&p, b"UPDATER_TAG=v0.3.38\nUPDATER_IMAGE_REF=x\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut rw = std::fs::metadata(&parent).unwrap().permissions();
            rw.set_mode(0o755);
            std::fs::set_permissions(&parent, rw).unwrap();
        }
        wrote.unwrap();
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            "UPDATER_TAG=v0.3.38\nUPDATER_IMAGE_REF=x\n"
        );
    }

    #[test]
    fn file_bind_style_io_errors_use_in_place_write() {
        for (kind, code) in [
            (std::io::ErrorKind::ReadOnlyFilesystem, 30),
            (std::io::ErrorKind::PermissionDenied, 13),
            (std::io::ErrorKind::ResourceBusy, 16),
        ] {
            let err = UpdaterError::from(std::io::Error::from_raw_os_error(code));
            assert!(
                needs_in_place_env_write(&err),
                "{kind:?} / os {code} should fall back to in-place write"
            );
        }
        let other = UpdaterError::from(std::io::Error::from(std::io::ErrorKind::NotFound));
        assert!(!needs_in_place_env_write(&other));
    }

    #[test]
    fn rejects_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(".env");
        std::fs::write(&p, "A=1\nA=2\n").unwrap();
        assert!(EnvFile::load(&p).is_err());
    }
}
