# 配置系统集成说明

## ⚠️ 重要提示

配置系统重构已完成基础架构，但需要在应用中集成使用。当前代码仍在使用旧的配置方式。

## 🔄 集成步骤

### 1. 更新 main.rs

在 `main.rs` 中添加全局动态配置：

```rust
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::RwLock;

// 保留原有的 GLOBAL_CONFIG（向后兼容）
pub static GLOBAL_CONFIG: Lazy<Arc<RwLock<AppConfig>>> =
    Lazy::new(|| Arc::new(RwLock::new(AppConfig::default())));

// 新增：全局动态配置（从数据库读取）
pub static GLOBAL_DYNAMIC_CONFIG: Lazy<Arc<RwLock<DynamicConfig>>> =
    Lazy::new(|| Arc::new(RwLock::new(DynamicConfig::default())));
```

### 2. 在启动时加载动态配置

```rust
#[tokio::main]
async fn main() -> Result<()> {
    // ... 现有代码 ...

    // 加载核心配置
    let config = AppConfig::from_env()?;
    config.validate()?;

    // 连接数据库
    let db = db::connection::establish_connection(&config.database_url).await?;

    // 加载动态配置
    let config_service = ConfigService::new(db.clone());
    let dynamic_config = config_service.load_config().await?;
    *GLOBAL_DYNAMIC_CONFIG.write().await = dynamic_config;

    tracing::info!("✅ Dynamic configuration loaded from database");

    // ... 其余启动代码 ...
}
```

### 3. 更新使用配置的代码

在需要访问 AI 配置、平台配置等地方，从 `GLOBAL_DYNAMIC_CONFIG` 读取：

```rust
// 旧代码（profile.rs 第627行）：
let config = crate::GLOBAL_CONFIG.read().await.clone();
let provider = crate::services::analyzer::AiProvider::from_str(&config.ai_provider);

// 新代码：
let dynamic_config = crate::GLOBAL_DYNAMIC_CONFIG.read().await.clone();
let provider = crate::services::analyzer::AiProvider::from_str(&dynamic_config.ai_provider);

// 后续使用
let (api_key, model, base_url) = match provider {
    crate::services::analyzer::AiProvider::Gemini => {
        let api_key = dynamic_config.gemini_api_key
            .ok_or_else(|| anyhow::anyhow!("Gemini API key not configured"))?;
        (api_key, dynamic_config.gemini_model.clone(), None)
    }
    crate::services::analyzer::AiProvider::OpenAI => {
        let api_key = dynamic_config.openai_api_key
            .ok_or_else(|| anyhow::anyhow!("OpenAI API key not configured"))?;
        (
            api_key,
            dynamic_config.openai_model.clone(),
            Some(dynamic_config.openai_base_url.clone())
        )
    }
};
```

### 4. 添加配置刷新端点

```rust
// 在 api/config.rs 中添加
pub async fn reload_config(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let config_service = ConfigService::new(state.db.clone());

    match config_service.load_config().await {
        Ok(config) => {
            *crate::GLOBAL_DYNAMIC_CONFIG.write().await = config;
            Ok(Json(json!({
                "success": true,
                "message": "Configuration reloaded from database"
            })))
        }
        Err(e) => {
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "error": e.to_string()
                }))
            ))
        }
    }
}
```

### 5. 需要修改的文件清单

1. **backend/src/main.rs**

   - 添加 `GLOBAL_DYNAMIC_CONFIG`
   - 在启动时加载动态配置
   - 在配置热重载时同时刷新动态配置

2. **backend/src/api/profile.rs**

   - 第 627-663 行：使用 `GLOBAL_DYNAMIC_CONFIG`
   - 所有访问 AI 配置的地方

3. **backend/src/api/config.rs**

   - 添加配置管理端点
   - 实现配置的 CRUD 操作

4. **backend/src/services/analyzer.rs**

   - 如果有硬编码的配置读取，改为参数传递

5. **backend/src/services/fetcher.rs**
   - 平台 API 密钥读取改为从动态配置

## 🎯 快速修复方案（临时）

如果希望快速让代码编译通过，可以在 `config.rs` 中为 `AppConfig` 保留旧字段（但标记为 deprecated）：

```rust
impl AppConfig {
    // 临时兼容方法 - 从环境变量读取（将被废弃）
    #[deprecated(note = "Use DynamicConfig from database instead")]
    pub fn with_legacy_fields() -> anyhow::Result<Self> {
        let mut config = Self::from_env()?;
        // 这些字段应该从数据库读取，这里只是临时兼容
        Ok(config)
    }
}
```

但这不是推荐的方案，建议按照上述步骤完整集成。

## 📋 检查清单

- [ ] 在 main.rs 添加 GLOBAL_DYNAMIC_CONFIG
- [ ] 启动时加载动态配置
- [ ] 更新 profile.rs 使用动态配置
- [ ] 添加配置管理 API 端点
- [ ] 更新其他使用配置的模块
- [ ] 测试配置热重载
- [ ] 测试配置迁移脚本
- [ ] 更新文档

## 🔗 相关文件

- `docs/CONFIGURATION.md` - 完整配置系统文档
- `CONFIG_REFACTOR_SUMMARY.md` - 重构总结
- `scripts/migrate-config.ps1` - 配置迁移脚本

---

**状态**: 基础架构完成，等待集成
**优先级**: 高 - 需要在下次提交前完成集成
