//! One-shot helper: recreate docker-guard + updater, roll back UPDATER_TAG on failure.
//!
//! Invoked by docker-guard as a short-lived container entrypoint (network=none,
//! no-new-privileges, fixed env). Not for interactive use.

use std::process::ExitCode;

fn main() -> ExitCode {
    myriad_updater::log::init();
    match myriad_updater::docker::self_update_helper::main_from_env() {
        Ok(()) => {
            tracing::info!("TCB self-update helper completed successfully");
            ExitCode::SUCCESS
        }
        Err(e) => {
            tracing::error!(err = %e, "TCB self-update helper failed");
            ExitCode::FAILURE
        }
    }
}
