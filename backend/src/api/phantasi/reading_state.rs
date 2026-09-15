//! Phantasi reading-state facade: re-export mark / sync / stats handlers.
pub(crate) use super::reading_mark::{
    mark_all_read, mark_read, mark_unread, star_item, unstar_item, update_item_state,
};
pub(crate) use super::reading_stats::get_stats;
pub(crate) use super::reading_sync::sync_states;
