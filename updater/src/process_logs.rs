use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use bollard::container::LogOutput;
use bollard::query_parameters::{ListContainersOptionsBuilder, LogsOptionsBuilder};
use chrono::{DateTime, Utc};
use futures::{StreamExt, stream};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

use crate::docker::client::DockerClient;
use crate::redact::redact_secrets;

const CORE_SERVICES: &[&str] = &[
    "backend",
    "backend-volume-init",
    "federation-worker",
    "persona-worker",
    "frontend",
    "postgres",
    "proxy",
    "docker-guard",
    "updater",
    "updater-gateway",
];
const MAX_SCANNED_LINES_PER_SOURCE: usize = 10_000;
const MAX_ENTRIES_PER_SOURCE: usize = 200;
const MAX_ENTRY_BYTES: usize = 2_048;
const MAX_CONCURRENT_SOURCES: usize = 3;
const SOURCE_TIMEOUT: Duration = Duration::from_secs(10);

static ANSI_ESCAPE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").expect("valid ANSI regex"));
static LOG_LEVEL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\s\[\]:])(?P<level>trace|debug|info|notice|log|warn|warning|error|fatal|panic)(?:$|[\s\[\]:])")
        .expect("valid log level regex")
});
static JSON_SECRET: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?i)(?P<prefix>["']?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|password|passwd|secret)["']?\s*[:=]\s*["']?)[^"'\s,}&]+"#,
    )
    .expect("valid JSON secret regex")
});
static CREDENTIAL_URL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?P<prefix>\b(?:postgres(?:ql)?|mysql|redis)://[^:\s/@]+:)[^@\s/]+@")
        .expect("valid credential URL regex")
});
static JWT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
        .expect("valid JWT regex")
});

#[derive(Debug, Serialize)]
pub struct ProcessLogExport {
    format: &'static str,
    schema_version: u32,
    generated_at: DateTime<Utc>,
    scope: &'static str,
    limits: ExportLimits,
    sources: Vec<ProcessLogSource>,
    collection_errors: Vec<CollectionError>,
    omitted_sources: Vec<OmittedSource>,
}

#[derive(Debug, Serialize)]
struct ExportLimits {
    scanned_lines_per_source: usize,
    retained_entries_per_source: usize,
    entry_bytes: usize,
}

#[derive(Debug, Serialize)]
struct ProcessLogSource {
    service: String,
    container: String,
    state: Option<String>,
    entries: Vec<ProcessLogEntry>,
    scanned_lines: usize,
    matched_lines: usize,
    truncated: bool,
    complete: bool,
}

#[derive(Debug, Serialize)]
struct ProcessLogEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<String>,
    stream: LogStream,
    level: ExportLevel,
    message: String,
    truncated: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum LogStream {
    Stdout,
    Stderr,
    Console,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum ExportLevel {
    Warning,
    Error,
    UnclassifiedStderr,
}

#[derive(Debug, Serialize)]
struct CollectionError {
    service: String,
    container: String,
    error: String,
}

#[derive(Debug, Serialize)]
struct OmittedSource {
    service: &'static str,
    reason: &'static str,
}

#[derive(Debug)]
struct ContainerSource {
    id: String,
    service: String,
    container: String,
    state: Option<String>,
}

pub async fn export(docker: Arc<DockerClient>) -> ProcessLogExport {
    let mut report = empty_export();
    let project = std::env::var("COMPOSE_PROJECT_NAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "myriad".to_string());
    let options = ListContainersOptionsBuilder::default().all(true).build();
    let containers = match docker.raw().list_containers(Some(options)).await {
        Ok(containers) => containers,
        Err(error) => {
            report.collection_errors.push(CollectionError {
                service: "docker".into(),
                container: String::new(),
                error: sanitize_message(&format!("list containers: {error}")),
            });
            report.omitted_sources = CORE_SERVICES
                .iter()
                .map(|service| OmittedSource {
                    service,
                    reason: "inventory_unavailable",
                })
                .collect();
            return report;
        }
    };

    let mut discovered = Vec::new();
    let mut discovered_services = HashSet::new();
    for container in containers {
        let labels = container.labels.unwrap_or_default();
        if labels.get("com.docker.compose.project").map(String::as_str) != Some(project.as_str()) {
            continue;
        }
        let Some(service) = labels
            .get("com.docker.compose.service")
            .filter(|service| CORE_SERVICES.contains(&service.as_str()))
            .cloned()
        else {
            continue;
        };
        let Some(id) = container.id else {
            report.collection_errors.push(CollectionError {
                service,
                container: String::new(),
                error: "container inventory did not include an id".into(),
            });
            continue;
        };
        let name = container
            .names
            .unwrap_or_default()
            .into_iter()
            .next()
            .map(|name| name.trim_start_matches('/').to_string())
            .unwrap_or_else(|| id.chars().take(12).collect());
        discovered_services.insert(service.clone());
        discovered.push(ContainerSource {
            id,
            service,
            container: name,
            state: container.state.map(|state| state.to_string()),
        });
    }
    discovered.sort_by(|left, right| {
        left.service
            .cmp(&right.service)
            .then_with(|| left.container.cmp(&right.container))
    });

    report.omitted_sources = CORE_SERVICES
        .iter()
        .filter(|service| !discovered_services.contains(**service))
        .map(|service| OmittedSource {
            service,
            reason: "not_present",
        })
        .collect();

    let results = stream::iter(discovered.into_iter().map(|source| {
        let docker = docker.clone();
        async move {
            let service = source.service.clone();
            let container = source.container.clone();
            match tokio::time::timeout(SOURCE_TIMEOUT, collect_source(docker, source)).await {
                Ok(Ok(source)) => Ok(source),
                Ok(Err(error)) => Err(CollectionError {
                    service,
                    container,
                    error: sanitize_message(&error),
                }),
                Err(_) => Err(CollectionError {
                    service,
                    container,
                    error: format!(
                        "log collection timed out after {}s",
                        SOURCE_TIMEOUT.as_secs()
                    ),
                }),
            }
        }
    }))
    .buffer_unordered(MAX_CONCURRENT_SOURCES)
    .collect::<Vec<_>>()
    .await;

    for result in results {
        match result {
            Ok(source) => report.sources.push(source),
            Err(error) => report.collection_errors.push(error),
        }
    }
    report.sources.sort_by(|left, right| {
        left.service
            .cmp(&right.service)
            .then_with(|| left.container.cmp(&right.container))
    });
    report.collection_errors.sort_by(|left, right| {
        left.service
            .cmp(&right.service)
            .then_with(|| left.container.cmp(&right.container))
    });
    report
}

fn empty_export() -> ProcessLogExport {
    ProcessLogExport {
        format: "myriad-process-log-export",
        schema_version: 1,
        generated_at: Utc::now(),
        scope: "core-compose-services",
        limits: ExportLimits {
            scanned_lines_per_source: MAX_SCANNED_LINES_PER_SOURCE,
            retained_entries_per_source: MAX_ENTRIES_PER_SOURCE,
            entry_bytes: MAX_ENTRY_BYTES,
        },
        sources: Vec::new(),
        collection_errors: Vec::new(),
        omitted_sources: Vec::new(),
    }
}

async fn collect_source(
    docker: Arc<DockerClient>,
    source: ContainerSource,
) -> Result<ProcessLogSource, String> {
    let tail = MAX_SCANNED_LINES_PER_SOURCE.to_string();
    let options = LogsOptionsBuilder::default()
        .stdout(true)
        .stderr(true)
        .timestamps(true)
        .tail(&tail)
        .build();
    let mut logs = docker.raw().logs(&source.id, Some(options));
    let mut entries = Vec::new();
    let mut scanned_lines = 0;
    let mut matched_lines = 0;

    while let Some(output) = logs.next().await {
        let output = output.map_err(|error| format!("read logs: {error}"))?;
        let (stream, bytes) = match output {
            LogOutput::StdOut { message } => (LogStream::Stdout, message),
            LogOutput::StdErr { message } => (LogStream::Stderr, message),
            LogOutput::Console { message } => (LogStream::Console, message),
            LogOutput::StdIn { .. } => continue,
        };
        let chunk = String::from_utf8_lossy(&bytes);
        for raw_line in chunk.lines() {
            scanned_lines += 1;
            let line = normalize_line(raw_line);
            if line.is_empty() {
                continue;
            }
            let (timestamp, message) = split_timestamp(&line);
            let Some(level) = classify_line(message, stream) else {
                continue;
            };
            matched_lines += 1;
            if entries.len() >= MAX_ENTRIES_PER_SOURCE {
                continue;
            }
            let sanitized = sanitize_message(message);
            let (message, truncated) = truncate_utf8(&sanitized, MAX_ENTRY_BYTES);
            entries.push(ProcessLogEntry {
                timestamp,
                stream,
                level,
                message,
                truncated,
            });
        }
    }

    let scan_limited = scanned_lines >= MAX_SCANNED_LINES_PER_SOURCE;
    let entry_limited = matched_lines > entries.len();
    Ok(ProcessLogSource {
        service: source.service,
        container: source.container,
        state: source.state,
        entries,
        scanned_lines,
        matched_lines,
        truncated: scan_limited || entry_limited,
        complete: !scan_limited && !entry_limited,
    })
}

fn normalize_line(line: &str) -> String {
    let without_ansi = ANSI_ESCAPE.replace_all(line, "");
    without_ansi
        .chars()
        .filter(|character| !character.is_control() || *character == '\t')
        .collect::<String>()
        .trim()
        .to_string()
}

fn split_timestamp(line: &str) -> (Option<String>, &str) {
    let Some((candidate, message)) = line.split_once(' ') else {
        return (None, line);
    };
    if DateTime::parse_from_rfc3339(candidate).is_ok() {
        (Some(candidate.to_string()), message.trim_start())
    } else {
        (None, line)
    }
}

fn classify_line(line: &str, stream: LogStream) -> Option<ExportLevel> {
    let lower = line.to_ascii_lowercase();
    if lower.contains("panicked at") || lower.starts_with("panic:") {
        return Some(ExportLevel::Error);
    }
    if let Some(captures) = LOG_LEVEL.captures(line) {
        return match captures
            .name("level")
            .map(|level| level.as_str().to_ascii_lowercase())
            .as_deref()
        {
            Some("warn" | "warning") => Some(ExportLevel::Warning),
            Some("error" | "fatal" | "panic") => Some(ExportLevel::Error),
            _ => None,
        };
    }
    match stream {
        LogStream::Stderr => Some(ExportLevel::UnclassifiedStderr),
        LogStream::Stdout | LogStream::Console => None,
    }
}

fn sanitize_message(message: &str) -> String {
    let redacted = redact_secrets(message);
    let redacted = JSON_SECRET.replace_all(&redacted, "${prefix}[REDACTED]");
    let redacted = CREDENTIAL_URL.replace_all(&redacted, "${prefix}[REDACTED]@");
    JWT.replace_all(&redacted, "[JWT_REDACTED]").into_owned()
}

fn truncate_utf8(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (format!("{}…", &value[..end]), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_explicit_levels_without_promoting_info_messages() {
        assert!(matches!(
            classify_line("2026-01-01T00:00:00Z WARN retrying", LogStream::Stdout),
            Some(ExportLevel::Warning)
        ));
        assert!(matches!(
            classify_line("ERROR: relation missing", LogStream::Stderr),
            Some(ExportLevel::Error)
        ));
        assert!(classify_line("INFO no error was found", LogStream::Stdout).is_none());
        assert!(matches!(
            classify_line("request handler failed", LogStream::Stderr),
            Some(ExportLevel::UnclassifiedStderr)
        ));
    }

    #[test]
    fn strips_timestamp_ansi_and_control_characters() {
        let line = normalize_line("\u{1b}[31m2026-01-01T00:00:00Z ERROR bad\u{0}\u{1b}[0m");
        let (timestamp, message) = split_timestamp(&line);
        assert_eq!(timestamp.as_deref(), Some("2026-01-01T00:00:00Z"));
        assert_eq!(message, "ERROR bad");
    }

    #[test]
    fn redacts_structured_credentials_and_database_urls() {
        let line = r#"error {"access_token":"secret-value"} postgres://user:pass@db/app eyJabcdefgh.abcdefgh.abcdefgh"#;
        let sanitized = sanitize_message(line);
        assert!(!sanitized.contains("secret-value"));
        assert!(!sanitized.contains(":pass@"));
        assert!(!sanitized.contains("eyJabcdefgh"));
        assert!(sanitized.contains("[REDACTED]"));
    }

    #[test]
    fn truncates_only_at_utf8_boundaries() {
        assert_eq!(truncate_utf8("abc", 3), ("abc".into(), false));
        assert_eq!(truncate_utf8("a界b", 3), ("a…".into(), true));
    }
}
