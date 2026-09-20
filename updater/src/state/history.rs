//! Append-only history.log writer.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use chrono::Utc;

use crate::error::Result;

pub fn append(path: &Path, line: &str) -> Result<()> {
    let ts = Utc::now().to_rfc3339();
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "[{ts}] {line}")?;
    f.flush()?;
    f.sync_data()?;
    Ok(())
}

pub fn tail(path: &Path, n: usize) -> Result<Vec<String>> {
    let s = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.into()),
    };
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.len().saturating_sub(n);
    Ok(lines[start..].iter().map(|s| s.to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn missing_history_is_empty_not_an_io_error() {
        let dir = tempdir().unwrap();
        let lines = tail(&dir.path().join("history.log"), 10).unwrap();
        assert!(lines.is_empty());
    }

    #[test]
    fn tail_does_not_treat_exists_false_as_absence() {
        let src = include_str!("history.rs");
        let body = src
            .split("pub fn tail(")
            .nth(1)
            .and_then(|rest| rest.split("#[cfg(test)]").next())
            .expect("tail");
        assert!(!body.contains("path.exists()"));
        assert!(body.contains("ErrorKind::NotFound"));
    }
}
