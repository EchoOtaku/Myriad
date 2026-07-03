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
    if !path.exists() {
        return Ok(vec![]);
    }
    let s = std::fs::read_to_string(path)?;
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.len().saturating_sub(n);
    Ok(lines[start..].iter().map(|s| s.to_string()).collect())
}
