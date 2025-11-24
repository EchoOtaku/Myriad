// Service layer modules
pub mod analyzer;
pub mod bilibili_utils;    // ✅ Bilibili 工具函数（IP伪装、防封技术）
pub mod config_service;
pub mod content_databases; // ✅ 预置内容数据库（番剧/游戏/歌手）
pub mod fetcher;
pub mod imaginepro;
pub mod metadata_filter;   // ✅ 5W元数据过滤器（旧版）
pub mod metadata_service;
pub mod netease_service;  // ✅ 网易云音乐统一服务层
pub mod netease_utils;     // ✅ 网易云音乐工具函数
pub mod smart_filter;      // ✅ 智能内容过滤器（新版，使用数据库）
