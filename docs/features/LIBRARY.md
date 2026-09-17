# 资料库功能

## 概述

资料库页面（`/library`）展示从已连接平台同步的游戏、番剧、影视、书籍、音乐。布局有两种：**列表**（默认）和**无限画布**。低端设备即使偏好画布也会回退到列表（`libraryPreferences.ts` 的 `resolveLibraryLayoutMode`）。

## 功能特性

### 数据源

- **游戏**：Steam（以及各平台报告里落到资料库的游戏条目）
- **视频 / 番剧 / 影视**：Bilibili、Bangumi、MyAnimeList
- **书籍**：Bangumi、MyAnimeList
- **音乐**：网易云
- 每类来源可在模块设置里勾选

MyAnimeList：用户名必填即可同步；默认用公开列表，可选配置 Client ID 走官方 API。

### 布局

| 模式 | 行为 |
| --- | --- |
| `list` | 分页列表；卡片按类型有不同格子尺寸 |
| `canvas` | 无限画布：平移、缩放；低端硬件回退 `list` |

资料库列表与无限画布各有一套教程。画布套讲平移与缩放，不讲下拉加载。

### 筛选

按内容类型筛选（游戏 / 视频 / 音乐 / 动画 / 书籍等），来源集合由模块设置决定，不是写死的三栏。

入口在右上角智能岛（`NavigationIsland`），不是旧的左侧垂直导航。

## 技术实现

### 后端 API

**路由**: `GET /api/library`（`backend/src/api/profile.rs` 的 `get_library_data`）

1. 同一站长的组装结果可短时复用；偏好与分页每次重算，刷新路径会失效。
2. 优先从数据库（`platform_metadata`）读最新数据。
3. 库为空时再读平台缓存文件（`load_platform_data_cache`）。
4. `offset` / `limit` 分页；未带 `limit` 时默认 120，上限 200。不要一次把整库吐给客户端。

**数据结构**:

```rust
pub struct LibraryItem {
    pub id: String,
    pub item_type: String, // "game", "video", "music", "anime", "book", "tv_series" 等
    pub title: String,
    pub cover: Option<String>,
    pub platform: String,
    pub metadata: Value,
}
```

偏好：`GET /api/library/preferences` 公开读；`PUT` 需管理员。

### 前端

**页面**: `/library`  
**组件**: `LibraryGrid.tsx`（列表与画布）、`library/LibraryCanvasChrome.tsx`

- 类型筛选、分页、懒加载
- 画布空间分箱与可见卡绘制
- 错误与空状态

## 使用方法

1. **配置平台**：在 `/config` 填写各平台账号（Steam / Bilibili / Bangumi 等；MyAnimeList 用户名必填，Client ID 可选）
2. **同步数据**：生成报告会拉取平台数据并写入数据库
3. **资料库显示**：模块设置里按分类勾选来源
4. **访问**：智能岛 → 资料库

## 数据更新

资料库与报告读同一份平台数据。重新生成报告会刷新资料库内容。
