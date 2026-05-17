//! Preflight checks (spec §6 pre-check). Run BEFORE entering maintenance mode so failures
//! never cause downtime.

use std::sync::Arc;

use tracing::info;

use crate::env_file::EnvFile;
use crate::error::{Result, UpdaterError};
use crate::release::Manifest;
use crate::version::MyriadVersion;
use crate::worker::Worker;
use crate::SUPPORTED_RELEASE_SCHEMA;

pub struct PreflightReport {
    pub manifest: Manifest,
    pub from_version: Option<MyriadVersion>,
    pub backend_digest: String,
    pub frontend_digest: String,
}

pub async fn run(worker: Arc<Worker>, target: &MyriadVersion) -> Result<PreflightReport> {
    info!(target = %target, "preflight: fetching manifest");
    let gh = worker.github_client()?;
    let manifest = gh.fetch_manifest(target.as_str()).await?;

    // 1. schema_version
    if manifest.schema_version > SUPPORTED_RELEASE_SCHEMA {
        return Err(UpdaterError::Precondition(format!(
            "release schema_version {} exceeds updater support {}; upgrade updater first",
            manifest.schema_version, SUPPORTED_RELEASE_SCHEMA
        )));
    }

    // 2. min_updater_version
    let self_v = MyriadVersion::parse(crate::self_version()).map_err(|e| {
        UpdaterError::Precondition(format!(
            "could not parse own updater version {:?}: {e}",
            crate::self_version()
        ))
    })?;
    if self_v.older_than(&manifest.updater.min_updater_version) {
        return Err(UpdaterError::Precondition(format!(
            "this updater ({}) is older than required min_updater_version {}; self-update first",
            self_v, manifest.updater.min_updater_version
        )));
    }

    // 3. min_from_version
    let st = worker.state().read_updater()?;
    let from_version = st.current_version.clone();
    if let (Some(curr), Some(min_from)) = (&from_version, &manifest.min_from_version) {
        if curr.older_than(min_from) {
            return Err(UpdaterError::Precondition(format!(
                "current version {curr} is older than min_from_version {min_from}; \
                 upgrade to an intermediate release first"
            )));
        }
    }

    // 4. env file: required keys present
    let env = EnvFile::load(&worker.cli().env_file)?;
    let mut missing = Vec::new();
    for k in &manifest.env.required {
        if env.get(k).is_none() {
            missing.push(k.clone());
        }
    }
    for ne in &manifest.env.new {
        if ne.required && env.get(&ne.name).is_none() && ne.default.is_none() {
            missing.push(ne.name.clone());
        }
    }
    if !missing.is_empty() {
        return Err(UpdaterError::Precondition(format!(
            "missing required env keys: {}",
            missing.join(", ")
        )));
    }

    // 5. disk: free space ≥ pgdata_size × 1.5 + 1GiB headroom
    if let Ok(stat) = nix::sys::statvfs::statvfs(&worker.cli().pgdata) {
        let block = stat.fragment_size() as u64;
        let avail = block * (stat.blocks_available() as u64);
        let pgdata_size = fs_size(&worker.cli().pgdata).unwrap_or(0);
        let need = pgdata_size + (pgdata_size / 2) + (1024 * 1024 * 1024);
        if avail < need {
            return Err(UpdaterError::Precondition(format!(
                "insufficient disk for snapshot: have {} bytes, need ~{}",
                avail, need
            )));
        }
    }

    // 6. pull images & verify digests
    let backend = manifest
        .image("backend")
        .ok_or_else(|| UpdaterError::Precondition("manifest lacks backend image".into()))?;
    let frontend = manifest
        .image("frontend")
        .ok_or_else(|| UpdaterError::Precondition("manifest lacks frontend image".into()))?;

    // ":latest" never permitted; double-check.
    for img in [&backend.r#ref, &frontend.r#ref] {
        if img.ends_with(":latest") {
            return Err(UpdaterError::Precondition(format!(
                "image ref must use immutable tag, got: {img}"
            )));
        }
    }

    let backend_pulled = worker
        .docker_pull_with_mirror(&backend.r#ref)
        .await
        .map_err(|e| UpdaterError::Precondition(format!("pull backend: {e}")))?;
    let frontend_pulled = worker
        .docker_pull_with_mirror(&frontend.r#ref)
        .await
        .map_err(|e| UpdaterError::Precondition(format!("pull frontend: {e}")))?;

    if !digest_matches(&backend_pulled, &backend.digest) {
        return Err(UpdaterError::Precondition(format!(
            "backend digest mismatch: pulled {backend_pulled}, expected {}",
            backend.digest
        )));
    }
    if !digest_matches(&frontend_pulled, &frontend.digest) {
        return Err(UpdaterError::Precondition(format!(
            "frontend digest mismatch: pulled {frontend_pulled}, expected {}",
            frontend.digest
        )));
    }

    Ok(PreflightReport {
        manifest,
        from_version,
        backend_digest: backend_pulled,
        frontend_digest: frontend_pulled,
    })
}

fn digest_matches(pulled: &str, expected: &str) -> bool {
    // pulled may be either bare digest (sha256:...) or include image@digest
    pulled == expected || pulled.ends_with(expected)
}

fn fs_size(p: &std::path::Path) -> std::io::Result<u64> {
    let out = std::process::Command::new("du").args(["-sb", &p.to_string_lossy()]).output()?;
    if !out.status.success() {
        return Ok(0);
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0))
}
