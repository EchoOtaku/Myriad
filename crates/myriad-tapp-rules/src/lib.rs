//! Pure Tapp evaluators that depend on tapp-contract but not on backend I/O.
//!
//! HMAC and transform evaluation live here, not in the contract crate.
//! Backend services re-export moved symbols so existing imports compile.

pub mod hmac;
pub mod package;
pub mod transform;

pub use hmac::{encode_hmac, hmac_matches, hmac_sha256};
pub use package::{
    filter_widget_paths, installed_core_entry, installed_layer_entries, installed_page_entry,
    installed_text_resource_plan, installed_widget_ids, installed_widget_layer_paths,
    installed_widget_template_paths, manifest_declares_core, manifest_declares_page,
    manifest_declares_widgets, require_known_widget_id, InstalledTextResourcePlan,
    InstalledWidgetTemplatePath, UnknownWidgetId,
};
pub use transform::{
    apply_map_op, apply_pipeline, apply_process_step, items_from_agent_input, items_from_value,
    parse_pipeline_steps_lenient, DataTransformError, MapOp, ProcessStep, MAX_MAP_OPERATIONS,
    MAX_PIPELINE_STEPS,
};
