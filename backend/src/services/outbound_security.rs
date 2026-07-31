//! Re-export of workspace crate [`myriad_outbound`].
//!
//! Call sites may use either `crate::services::outbound_security::…` or
//! `myriad_outbound::…`. New code should prefer the workspace crate path.

pub use myriad_outbound::*;
