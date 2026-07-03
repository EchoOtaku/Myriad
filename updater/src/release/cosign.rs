//! cosign 签名验证。Spec §15.4 (M2)。
//!
//! 我们走 keyless 验证：release.yml 在 GitHub Actions 里用 OIDC token 签 release.json，
//! cosign 把签名/证书写到 Rekor 透明日志并产出 .sig + .pem。验证时通过 issuer + subject
//! 白名单确认签名来自我们仓库的 Actions workflow。
//!
//! 设计上把 cosign CLI 当外部进程调用（updater 镜像里已经装了 cosign 二进制）。把验证封装
//! 进一个小函数，配置由 `CosignPolicy` 控制：
//!
//!   Off    — 完全不验，跳过下载 .sig/.pem（向后兼容老 release）。
//!   Soft   — 拉签名失败 / 验证失败 → 仅打 warning，更新照常进行。
//!   Strict — 失败 → 拒绝继续，主流程报 Precondition 错误。

use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;
use tracing::{info, warn};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum CosignPolicy {
    Off,
    Soft,
    Strict,
}

impl CosignPolicy {
    pub fn from_env(raw: Option<&str>) -> Self {
        match raw.unwrap_or("").trim().to_ascii_lowercase().as_str() {
            "" | "off" | "false" | "0" => Self::Off,
            "soft" | "warn" => Self::Soft,
            "strict" | "true" | "1" | "require" => Self::Strict,
            _ => Self::Off,
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum VerifyOutcome {
    Skipped,
    Verified,
    /// Verification was attempted but failed. Contains the reason.
    Failed(String),
    /// Cosign returned successfully but the OIDC subject didn't match the expected pattern.
    PolicyMismatch(String),
}

impl VerifyOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(self, Self::Skipped | Self::Verified)
    }
}

/// Verify `manifest_bytes` against `signature_bytes` + `cert_bytes`.
///
/// `expected_repo` is the `owner/repo` (e.g. `Myriad-You/Myriad`); we enforce that the
/// signing cert's OIDC `Subject` URL starts with `https://github.com/<repo>/`.
/// The `Issuer` is fixed to GitHub Actions (`https://token.actions.githubusercontent.com`).
pub async fn verify(
    manifest_path: &Path,
    signature_path: &Path,
    cert_path: &Path,
    expected_repo: &str,
) -> VerifyOutcome {
    let issuer = "https://token.actions.githubusercontent.com";
    let subject_re = format!(
        "^https://github\\.com/{}/\\.github/workflows/.+@refs/tags/v[0-9].+$",
        regex::escape(expected_repo)
    );

    let mut cmd = Command::new("cosign");
    cmd.arg("verify-blob")
        .arg("--signature")
        .arg(signature_path)
        .arg("--certificate")
        .arg(cert_path)
        .arg("--certificate-identity-regexp")
        .arg(&subject_re)
        .arg("--certificate-oidc-issuer")
        .arg(issuer)
        .arg(manifest_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let out = match cmd.output().await {
        Ok(o) => o,
        Err(e) => return VerifyOutcome::Failed(format!("spawn cosign: {e}")),
    };

    if out.status.success() {
        info!(
            manifest = %manifest_path.display(),
            "cosign verify-blob OK"
        );
        return VerifyOutcome::Verified;
    }

    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    // cosign 返回 "no matching signatures" → policy mismatch；其他都按一般失败处理。
    if stderr.contains("no matching signatures") || stderr.contains("certificate identity") {
        return VerifyOutcome::PolicyMismatch(stderr);
    }
    VerifyOutcome::Failed(stderr)
}

/// Apply policy: convert outcome + policy into a `Result` for the caller's flow.
pub fn enforce(outcome: &VerifyOutcome, policy: CosignPolicy) -> Result<(), String> {
    match (policy, outcome) {
        (CosignPolicy::Off, _) => Ok(()),
        (CosignPolicy::Soft, VerifyOutcome::Skipped | VerifyOutcome::Verified) => Ok(()),
        (CosignPolicy::Soft, VerifyOutcome::Failed(e) | VerifyOutcome::PolicyMismatch(e)) => {
            warn!(error = %e, "cosign verification failed (policy=soft); continuing");
            Ok(())
        }
        (CosignPolicy::Strict, VerifyOutcome::Skipped) => {
            Err("cosign policy=strict but no signature available for this release".into())
        }
        (CosignPolicy::Strict, VerifyOutcome::Verified) => Ok(()),
        (CosignPolicy::Strict, VerifyOutcome::Failed(e) | VerifyOutcome::PolicyMismatch(e)) => {
            Err(format!("cosign verification failed: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_from_env_normalises() {
        assert_eq!(CosignPolicy::from_env(None), CosignPolicy::Off);
        assert_eq!(CosignPolicy::from_env(Some("")), CosignPolicy::Off);
        assert_eq!(CosignPolicy::from_env(Some("off")), CosignPolicy::Off);
        assert_eq!(CosignPolicy::from_env(Some("Soft")), CosignPolicy::Soft);
        assert_eq!(CosignPolicy::from_env(Some("STRICT")), CosignPolicy::Strict);
        assert_eq!(CosignPolicy::from_env(Some("garbage")), CosignPolicy::Off);
    }

    #[test]
    fn enforce_combinations() {
        assert!(enforce(&VerifyOutcome::Failed("x".into()), CosignPolicy::Off).is_ok());
        assert!(enforce(&VerifyOutcome::Verified, CosignPolicy::Soft).is_ok());
        assert!(enforce(&VerifyOutcome::Failed("x".into()), CosignPolicy::Soft).is_ok());
        assert!(enforce(&VerifyOutcome::Verified, CosignPolicy::Strict).is_ok());
        assert!(enforce(&VerifyOutcome::Skipped, CosignPolicy::Strict).is_err());
        assert!(enforce(&VerifyOutcome::Failed("x".into()), CosignPolicy::Strict).is_err());
    }
}
