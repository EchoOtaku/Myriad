// Service layer modules
pub mod agent; // 🤖 AI Agent 自然语言任务编排系统
pub mod ai; // 🤖 AI 服务工厂（统一创建 AI 分析器）
pub mod analyzer;
pub mod background_processor; // ✅ 后台任务处理系统（异步处理、任务队列）
pub mod batch_saver; // ✅ 批量数据保存服务（分批异步写入）
pub mod bilibili_utils; // ✅ Bilibili 工具函数（IP伪装、防封技术）
pub mod config_service;
pub mod content_databases; // ✅ 预置内容数据库（番剧/游戏/歌手）
pub mod data_paths; // 📁 数据路径配置（统一管理所有数据目录）
pub mod enka_assets; // 🎮 Enka 角色元数据（名字/图标/稀有度，米哈游游戏卡片用）
pub mod fetcher;
pub mod http_client; // ✅ 统一 HTTP 客户端（代理支持）
pub mod kugou_service; // ✅ 酷狗音乐服务（逐字歌词 KRC 补充源）
pub mod metadata_filter; // ✅ 5W元数据过滤器（旧版）
pub mod metadata_service;
pub mod netease_service; // ✅ 网易云音乐统一服务层
pub mod netease_utils; // ✅ 网易云音乐工具函数
pub mod oauth; // 🔐 OAuth Provider 抽象（GitHub / OIDC / ...）
pub mod outbound_security; // 🔒 Outbound URL validation, DNS pinning, and redirect policy
pub mod permission_service; // ✅ 权限服务（细粒度权限配置）
pub mod smart_filter; // ✅ 智能内容过滤器（新版，使用数据库）
pub mod spoof_utils; // ✅ 请求伪装工具（区域IP/UA伪装，绕过地区限制）
pub mod tapp_api_service; // ✅ Tapp API 声明执行服务（public/protected 两级权限）
pub mod tapp_scheduler; // ✅ Tapp 定时任务调度引擎
pub mod tencent_speech_service;
pub mod updater_client; // 🚀 Updater HTTP client (admin proxy) // 🎙️ 腾讯云语音服务（TTS/ASR）

// Brew 阅读系统
pub mod brew_parser; // 🍵 RSS/Atom/JSON Feed 解析器
pub mod brew_scheduler; // 🍵 订阅调度引擎（后端独立运行）
pub mod icon_service; // 🍵 图标下载与缓存服务
pub mod image_cache; // 🍵 图片缓存服务（Notion 临时 URL 等）
pub mod notion_service; // 🍵 Notion 集成服务（数据库/页面订阅）
pub mod rsshub_service; // 🍵 RSSHub 实例管理服务（健康检查/故障转移）
