//! Pure Tapp evaluators that depend on tapp-contract but not on backend I/O.
//!
//! HMAC and transform evaluation live here, not in the contract crate.
//! Backend services re-export moved symbols so existing imports compile.

pub mod hmac;
pub mod transform;

pub use hmac::{encode_hmac, hmac_matches, hmac_sha256};
pub use transform::{
    apply_map_op, apply_pipeline, apply_process_step, DataTransformError, MapOp, ProcessStep,
    MAX_MAP_OPERATIONS, MAX_PIPELINE_STEPS,
};
