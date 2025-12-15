// Service layer modules
pub mod analyzer;
pub mod background_processor; // ✅ 后台任务处理系统（异步处理、任务队列）
pub mod batch_saver; // ✅ 批量数据保存服务（分批异步写入）
pub mod bilibili_utils; // ✅ Bilibili 工具函数（IP伪装、防封技术）
pub mod config_service;
pub mod content_databases; // ✅ 预置内容数据库（番剧/游戏/歌手）
pub mod fetcher;
pub mod http_client; // ✅ 统一 HTTP 客户端（代理支持）
pub mod imaginepro;
pub mod metadata_filter; // ✅ 5W元数据过滤器（旧版）
pub mod metadata_service;
pub mod netease_service; // ✅ 网易云音乐统一服务层
pub mod netease_utils; // ✅ 网易云音乐工具函数
pub mod permission_service; // ✅ 权限服务（细粒度权限配置）
pub mod smart_filter; // ✅ 智能内容过滤器（新版，使用数据库）
pub mod spoof_utils; // ✅ 请求伪装工具（区域IP/UA伪装，绕过地区限制）
pub mod tapp_api_service; // ✅ Tapp API 声明执行服务（public/protected 两级权限）
pub mod tapp_scheduler; // ✅ Tapp 定时任务调度引擎
