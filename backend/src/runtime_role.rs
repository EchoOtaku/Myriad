//! Deployment roles are startup policy, never user permissions or DB defaults.
pub static PERSONA_RUNTIME_LOCAL: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(true);

pub static FEDERATION_HTTP_ISOLATED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub static PERSONA_HTTP_ISOLATED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
pub static PERSONA_WORKER: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeRole {
    Web,
    FederationWorker,
    PersonaWorker,
    /// Explicit developer convenience; production must use isolated processes.
    All,
}

impl RuntimeRole {
    pub fn from_env() -> anyhow::Result<Self> {
        let executable = std::env::args_os().next();
        match executable
            .as_deref()
            .and_then(|path| std::path::Path::new(path).file_name())
            .and_then(|name| name.to_str())
        {
            Some("myriad-federation-worker") => return Ok(Self::FederationWorker),
            Some("myriad-persona-worker") => return Ok(Self::PersonaWorker),
            _ => {}
        }
        match std::env::var("MYRIAD_PROCESS_ROLE") {
            Ok(value) => Self::parse(
                &value,
                crate::config::AppConfig::is_production_environment(),
            ),
            Err(std::env::VarError::NotPresent) => Self::missing_role(),
            Err(error) => Err(error.into()),
        }
    }

    fn missing_role() -> anyhow::Result<Self> {
        anyhow::bail!(
            "MYRIAD_PROCESS_ROLE is required: migrate Compose and updater/Guard to the split \
             topology and set the backend role to web before upgrading; for local development \
             select all explicitly. Implicit combined execution is no longer supported"
        )
    }

    fn parse(value: &str, production: bool) -> anyhow::Result<Self> {
        match value {
            "web" => Ok(Self::Web),
            "federation-worker" => Ok(Self::FederationWorker),
            "persona-worker" => Ok(Self::PersonaWorker),
            "all" if !production => Ok(Self::All),
            "all" => anyhow::bail!(
                "MYRIAD_PROCESS_ROLE=all is development-only; deploy separate workers"
            ),
            _ => anyhow::bail!(
                "MYRIAD_PROCESS_ROLE must be web, federation-worker, persona-worker, or development-only all"
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_never_silently_combines_roles() {
        assert!(RuntimeRole::missing_role().is_err());
        assert_eq!(RuntimeRole::parse("web", true).unwrap(), RuntimeRole::Web);
        assert_eq!(
            RuntimeRole::parse("federation-worker", true).unwrap(),
            RuntimeRole::FederationWorker
        );
        assert_eq!(
            RuntimeRole::parse("persona-worker", true).unwrap(),
            RuntimeRole::PersonaWorker
        );
        assert!(RuntimeRole::parse("all", true).is_err());
        assert!(RuntimeRole::parse("federaton-worker", false).is_err());
        assert_eq!(RuntimeRole::parse("all", false).unwrap(), RuntimeRole::All);
    }
}
