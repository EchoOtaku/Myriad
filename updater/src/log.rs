//! Logging initialisation. Honours RUST_LOG and defaults to info.

use std::sync::Once;

use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

static INIT: Once = Once::new();

pub fn init() {
    INIT.call_once(|| {
        let filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info,bollard=warn,hyper=warn,reqwest=warn"));
        let _ = tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer().with_target(false).with_level(true))
            .try_init();
    });
}
