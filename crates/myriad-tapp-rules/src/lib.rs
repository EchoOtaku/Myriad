//! Pure Tapp evaluators that depend on tapp-contract but not on backend I/O.
//!
//! HMAC and transform evaluation live here, not in the contract crate.
//! Backend services re-export moved symbols so existing imports compile.
