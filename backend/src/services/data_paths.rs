//! 数据路径配置模块
//!
//! 统一管理应用程序中所有数据目录的路径配置
//! 支持从环境变量覆盖默认值，便于容器化部署

use once_cell::sync::Lazy;
use std::env;
use std::path::PathBuf;

/// 数据路径配置
#[allow(dead_code)]
pub struct DataPaths {
    /// 应用数据根目录（默认: "data"）
    pub root: PathBuf,
    /// Brew 订阅源数据目录（默认: "data/brew"）
    pub brew: PathBuf,
    /// Brew 图标目录（默认: "data/brew/icons"）
    pub brew_icons: PathBuf,
    /// Tapp 应用数据目录（默认: "data/tapps"）
    pub tapps: PathBuf,
    /// 缓存目录（默认: "cache"）
    pub cache: PathBuf,
    /// 平台数据缓存目录（默认: "cache/platforms"）
    pub cache_platforms: PathBuf,
    /// 原始数据缓存目录（默认: "cache/raw"）
    pub cache_raw: PathBuf,
    /// 图片缓存目录（默认: "cache/images"）
    pub cache_images: PathBuf,
}

#[allow(dead_code)]
impl DataPaths {
    /// 从环境变量加载配置
    pub fn from_env() -> Self {
        let root = PathBuf::from(env::var("DATA_DIR").unwrap_or_else(|_| "data".to_string()));
        let cache_root =
            PathBuf::from(env::var("CACHE_DIR").unwrap_or_else(|_| "cache".to_string()));

        Self {
            brew: root.join("brew"),
            brew_icons: root.join("brew/icons"),
            tapps: root.join("tapps"),
            cache_platforms: cache_root.join("platforms"),
            cache_raw: cache_root.join("raw"),
            cache_images: cache_root.join("images"),
            root,
            cache: cache_root,
        }
    }

    /// 获取 Brew 文章 TTS 目录
    /// 结构: {brew}/{source_id}/{article_id}/tts/
    pub fn brew_tts_dir(&self, source_id: i32, article_id: &str) -> PathBuf {
        self.brew
            .join(source_id.to_string())
            .join(article_id)
            .join("tts")
    }

    /// 获取 Brew 独立 TTS 目录（非文章关联）
    /// 结构: {brew}/standalone_tts/{text_hash}/
    pub fn brew_standalone_tts_dir(&self, text_hash: &str) -> PathBuf {
        self.brew.join("standalone_tts").join(text_hash)
    }

    /// 获取用户 Tapp 目录
    /// 结构: {tapps}/{user_id}/
    pub fn tapp_user_dir(&self, user_id: i32) -> PathBuf {
        self.tapps.join(user_id.to_string())
    }

    /// 获取 Tapp 代码目录
    /// 结构: {tapps}/{user_id}/{tapp_id}/
    pub fn tapp_code_dir(&self, user_id: i32, tapp_id: i32) -> PathBuf {
        self.tapps
            .join(user_id.to_string())
            .join(tapp_id.to_string())
    }

    /// 获取 Agent RSSHub 路由缓存文件路径
    pub fn rsshub_routes_cache(&self) -> PathBuf {
        self.cache.join("rsshub_routes.json")
    }

    /// 确保目录存在
    pub async fn ensure_dir(&self, path: &PathBuf) -> std::io::Result<()> {
        tokio::fs::create_dir_all(path).await
    }

    /// 确保所有基础目录存在
    pub async fn ensure_all(&self) -> std::io::Result<()> {
        tokio::fs::create_dir_all(&self.root).await?;
        tokio::fs::create_dir_all(&self.brew).await?;
        tokio::fs::create_dir_all(&self.brew_icons).await?;
        tokio::fs::create_dir_all(&self.tapps).await?;
        tokio::fs::create_dir_all(&self.cache).await?;
        tokio::fs::create_dir_all(&self.cache_platforms).await?;
        tokio::fs::create_dir_all(&self.cache_raw).await?;
        tokio::fs::create_dir_all(&self.cache_images).await?;
        Ok(())
    }
}

impl Default for DataPaths {
    fn default() -> Self {
        Self::from_env()
    }
}

/// 全局数据路径配置（惰性初始化）
pub static DATA_PATHS: Lazy<DataPaths> = Lazy::new(DataPaths::from_env);

/// 便捷访问函数
pub fn paths() -> &'static DataPaths {
    &DATA_PATHS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_paths() {
        let paths = DataPaths::from_env();
        assert_eq!(paths.root, PathBuf::from("data"));
        assert_eq!(paths.brew, PathBuf::from("data/brew"));
        assert_eq!(paths.tapps, PathBuf::from("data/tapps"));
    }

    #[test]
    fn test_brew_tts_dir() {
        let paths = DataPaths::from_env();
        let tts_dir = paths.brew_tts_dir(123, "article_456");
        assert_eq!(tts_dir, PathBuf::from("data/brew/123/article_456/tts"));
    }

    #[test]
    fn test_tapp_user_dir() {
        let paths = DataPaths::from_env();
        let user_dir = paths.tapp_user_dir(42);
        assert_eq!(user_dir, PathBuf::from("data/tapps/42"));
    }
}
