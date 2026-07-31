//! Re-export of workspace crate [`myriad_json_schema`].
//!
//! Call sites may use either `crate::services::json_schema_subset::…` or
//! `myriad_json_schema::…`. New code should prefer the workspace crate path.

pub use myriad_json_schema::*;
