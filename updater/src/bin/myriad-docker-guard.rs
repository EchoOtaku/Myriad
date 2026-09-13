use anyhow::Result;
use myriad_updater::docker::guard::{GuardConfig, run};

#[tokio::main]
async fn main() -> Result<()> {
    myriad_updater::log::init();
    run(GuardConfig::load_from_env()?).await
}
