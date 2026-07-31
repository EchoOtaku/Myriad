//! Platform request helpers: Bilibili / Netease anti-block utilities and
//! regional IP/UA spoofing for outbound fetchers.
//!
//! Workspace crate so music/platform fetchers share one implementation without
//! depending on the HTTP API layer.

pub mod bilibili;
pub mod netease;
pub mod spoof;

// Convenience re-exports for the most common call sites (optional).
pub use bilibili::{
    generate_bilibili_cookie, generate_buvid3, generate_device_id as bilibili_generate_device_id,
    get_random_china_ip as bilibili_random_china_ip, get_random_user_agent as bilibili_random_ua,
};
pub use netease::{
    convert_http_to_https, ensure_https_url, generate_device_id as netease_generate_device_id,
    get_random_china_ip as netease_random_china_ip, get_random_user_agent as netease_random_ua,
};
pub use spoof::{generate_spoof_headers, SpoofConfig, SpoofHeaders};
