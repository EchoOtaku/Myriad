// Service layer modules
pub mod activity_event_service;
pub mod agent; // 🤖 AI Agent 自然语言任务编排系统
pub mod agent_interaction; // 🤝 Agent ↔ Tapp interaction create surface
pub mod tapp_agent_interaction; // 🤝 Agent interaction registry + state machine
pub mod ai; // 🤖 AI 服务工厂（统一创建 AI 分析器）
pub mod ai_config; // 🤖 Cached AI provider config (text + image tiers)
pub mod ai_cost_ledger; // 📒 Append-only AI cost ledger writes
pub mod ai_quota; // 📊 AI daily quota reserve/settle/usage ledger
pub mod ai_task_context; // 📎 AI Task context refs resolve (platform/report/profile)
pub mod ai_task_execute; // ▶️ AI Task run loop (provider + quota + ledger)
pub mod ai_task_prepare; // 📝 AI Task prompt assemble + structured-output normalize
pub mod ai_task_provider; // 🤖 Text/image provider execution for AI Tasks
pub mod ai_task_registry; // 📋 Cross-replica AI task register/persist
pub mod ai_task_runtime; // ⚙️ Process-local AI_TASKS map + state transitions
pub mod analyzer;
pub mod json_schema_subset; // 📐 Shared JSON Schema subset validator
pub mod platform_cache; // 📦 Platform filtered-JSON cache
pub mod platform_items; // 📋 Platform cache → uniform items[] projection
pub mod background_processor; // ✅ 后台任务处理系统（异步处理、任务队列）
pub mod bilibili_utils; // ✅ Bilibili 工具函数（IP伪装、防封技术）
pub mod config_service;
pub mod content_databases; // ✅ 预置内容数据库（番剧/游戏/歌手）
pub mod data_key; // 🔐 数据加密密钥（配置密钥 / 联邦私钥信封）
pub mod data_paths; // 📁 数据路径配置（统一管理所有数据目录）
pub mod tapp_data_exchange; // 🔄 One-shot consent-gated Tapp data exchange
pub mod tapp_data_transform; // 🔧 Pure declarative data.transform pipeline
pub mod tapp_declared_api; // 📜 Manifest declared-API catalog + parse cache
pub mod tapp_events; // 📣 Manifest-scoped at-most-once event broker
pub mod tapp_components; // 🧩 Host-managed component registry (_component:)
pub mod tapp_context; // 🧭 Runtime context payloads + subject role projection
pub mod tapp_credentials; // 🔐 Installation-scoped write-only credential bindings
pub mod tapp_catalog; // 🗂️ Catalog/detail list projection (role-filtered)
pub mod tapp_lifecycle; // ♻️ Start/stop/uninstall decisions + recent/widget pure rules
pub mod tapp_validation; // ✅ Manifest/package pure validators (id/path/settings/…)
pub mod tapp_package_fs; // 📁 Install dir lifecycle artifacts + orphan/path pure rules
pub mod tapp_package_read; // 📖 Installed package resource path plans (GET resources/asset)
pub mod tapp_prepared_package; // 📦 Prepared package validate + resource overrides
pub mod tapp_install; // 📥 Install/update source mode + CSS channels + approved perms
pub mod tapp_install_resources; // ✅ Post-stage declared resource + archive entry checks
pub mod tapp_store_package; // 🏪 Remote store path/index pure mapping
pub mod tapp_store_sources; // 🗂️ Store source admin policy + projection
pub mod tapp_federation_feed; // 🌐 Federation feed merge + item projection
pub mod tapp_notification; // 🔔 Tapp UI notification enqueue
pub mod tapp_reports; // 📊 Platform report catalog + payload projection
pub mod tapp_shortcuts; // ⌨️ Host-managed shortcut registry (_shortcut:)
pub mod enka_assets; // 🎮 Enka 角色元数据（名字/图标/稀有度，米哈游游戏卡片用）
pub mod fetcher;
pub mod governed_text; // 🤖 Governed AI text sink (scheduler + declared-API builtins)
pub mod http_client; // ✅ 统一 HTTP 客户端（代理支持）
pub mod kugou_service; // ✅ 酷狗音乐服务（逐字歌词 KRC 补充源）
pub mod metadata_service;
pub mod module_visibility; // 👁️ Module visibility for Agent (no api::config import)
pub mod netease_service; // ✅ 网易云音乐统一服务层
pub mod netease_utils; // ✅ 网易云音乐工具函数
pub mod oauth; // 🔐 OAuth Provider 抽象（GitHub / OIDC / ...）
pub mod outbound_security; // 🔒 Outbound URL validation, DNS pinning, and redirect policy
pub mod tapp_registry; // 📦 Tapp runtime registry/mailbox (workspace crate + DB adapter)
pub mod permission_service; // ✅ 权限服务（细粒度权限配置）
pub mod platform_auto_refresh; // Core 平台自动刷新任务（复用 Tapp 调度引擎）
pub mod platform_refresh; // 🔄 平台数据抓取/缓存（profile HTTP + scheduler）
pub mod site_owner; // 👤 站点 owner 解析（reports/config/profile）
pub mod image_proxy_urls; // 🖼️ Shared image proxy URL rewrite (profile/export)
pub mod library_items; // 📚 Library item pure builders (Bangumi/MAL/preferences)
pub mod server_location; // 🌍 服务器出口位置双源直连审查
pub mod smart_filter; // ✅ 智能内容过滤器（新版，使用数据库）
pub mod spoof_utils; // ✅ 请求伪装工具（区域IP/UA伪装，绕过地区限制）
pub mod tapp_api_service; // ✅ Tapp API 声明执行服务（public/protected 两级权限）
pub mod tapp_ownership; // 🔐 Tapp install ownership / access resolution
pub mod tapp_playground_knowledge; // Playground Agent 只读 Tapp 契约检索
pub mod tapp_rate_limit; // ⏱️ Tapp shared rate limiter (registry-backed)
pub mod tapp_host_attribution; // 🏷️ Host-proxied route→permission maps (speech/brew/federation)
pub mod tapp_runtime_grant; // 🎫 Short-lived Tapp runtime grants (registry-backed)
pub mod tapp_ws_ticket; // 🎟️ One-time federation WS tickets (registry-backed)
pub mod tapp_scheduler; // ✅ Tapp 定时任务调度引擎
pub mod tapp_storage; // 📦 Tapp sandbox storage validators + IO
pub mod standalone_tts; // 🎙️ Standalone TTS (cache + Tencent) for HTTP + agent
pub mod tencent_speech_service; // 🎙️ 腾讯云语音服务（TTS/ASR）
pub mod updater_client; // 🚀 Updater HTTP client (admin proxy)

// Brew 阅读系统
pub mod brew_parser; // 🍵 RSS/Atom/JSON Feed 解析器
pub mod brew_scheduler; // 🍵 订阅调度引擎（后端独立运行）
pub mod icon_service; // 🍵 图标下载与缓存服务
pub mod image_cache; // 🍵 图片缓存服务（Notion 临时 URL 等）
pub mod notion_service; // 🍵 Notion 集成服务（数据库/页面订阅）
pub mod rsshub_service; // 🍵 RSSHub 实例管理服务（健康检查/故障转移）
