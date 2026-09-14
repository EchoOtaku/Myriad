//! 能力定义模块
//!
//! 按类别组织所有能力定义

mod ai;
mod phantasi;
mod external;
mod model3d;
mod platform;
mod report;
mod system;
mod tapp;
mod ui;

use super::CapabilityRegistry;

/// 注册所有内置能力
pub fn register_all(registry: &mut CapabilityRegistry) {
    platform::register(registry);
    phantasi::register(registry);
    ai::register(registry);
    model3d::register(registry);
    tapp::register(registry);
    report::register(registry);
    system::register(registry);
    external::register(registry);
    ui::register(registry);
}
