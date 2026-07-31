//! Re-export of workspace crate [`myriad_image_proxy`].
//!
//! Call sites may use either `crate::services::image_proxy_urls::…` or
//! `myriad_image_proxy::…`. New code should prefer the workspace crate path.

pub use myriad_image_proxy::*;
