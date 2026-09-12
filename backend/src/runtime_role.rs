//! Deployment roles are startup policy, never user permissions or DB defaults.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeRole {
    Web,
    /// Compatibility for existing compose files without a process-role setting.
    LegacyCombined,
    FederationWorker,
    /// Explicit developer convenience; production must use isolated processes.
    All,
}

impl RuntimeRole {
    pub fn from_env() -> anyhow::Result<Self> {
        if std::env::args_os()
            .next()
            .as_deref()
            .and_then(|path| std::path::Path::new(path).file_name())
            .is_some_and(|name| name == "myriad-federation-worker")
        {
            return Ok(Self::FederationWorker);
        }
        match std::env::var("MYRIAD_PROCESS_ROLE") {
            Ok(value) => Self::parse(
                &value,
                crate::config::AppConfig::is_production_environment(),
            ),
            Err(std::env::VarError::NotPresent) => {
                tracing::warn!("legacy combined runtime: upgrade compose and updater/Guard to deploy separate workers");
                Ok(Self::LegacyCombined)
            }
            Err(error) => Err(error.into()),
        }
    }

    fn parse(value: &str, production: bool) -> anyhow::Result<Self> {
        match value {
            "web" => Ok(Self::Web),
            "federation-worker" => Ok(Self::FederationWorker),
            "all" if !production => Ok(Self::All),
            "all" => anyhow::bail!(
                "MYRIAD_PROCESS_ROLE=all is development-only; deploy separate workers"
            ),
            _ => anyhow::bail!(
                "MYRIAD_PROCESS_ROLE must be web, federation-worker, or development-only all"
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_never_silently_combines_roles() {
        assert_eq!(RuntimeRole::parse("web", true).unwrap(), RuntimeRole::Web);
        assert_eq!(
            RuntimeRole::parse("federation-worker", true).unwrap(),
            RuntimeRole::FederationWorker
        );
        assert!(RuntimeRole::parse("all", true).is_err());
        assert!(RuntimeRole::parse("federaton-worker", false).is_err());
        assert_eq!(RuntimeRole::parse("all", false).unwrap(), RuntimeRole::All);
    }
}
