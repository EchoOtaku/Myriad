---
name: 最新订阅文章
description: 跨所有订阅源取最近文章列表（本地 phantasi.items），不使用 webSearch
category: phantasi
triggers:
  - 最新文章
  - 最近文章
  - 看看订阅
  - 订阅更新
  - latest posts
  - latest articles
  - recent posts
  - recent articles
  - what's new
  - 有什么新的
  - 未读文章
  - unread
  - 今天更新
tier_hint: standard
origin: manual
gating:
  capabilities:
    - phantasi.items
    - phantasi.page
    - phantasi.sources
---

# 目标

汇总用户**所有本地订阅源**中最近的文章，快速回答「有什么新文章 / 订阅更新了什么」。

# 硬性约束

1. **禁止**使用 `ai.webSearch`。这是纯本地阅读列表，不是新闻搜索。
2. 不要按站外关键词去搜互联网；关键词筛选仅用于本地 `phantasi.items` 的 `keyword`（用户指定主题时）。
3. 跨源列表时**不要**伪造 `sourceId`；无源过滤即可。
4. 若用户其实点名了某个源（「看看 akiday」），改走 skill `phantasi-source-latest`（sources → sourceId → items），不要用本 Skill 的全局列表糊弄。

# 推荐步骤

## 步骤 1：拉取最近文章

调用 `phantasi.items`：

```json
{
  "limit": 15
}
```

说明：

- 不传 `sourceId` / `sourceName` / `query`，即跨所有源按发布时间倒序。
- 若用户要未读：`"unreadOnly": true`。
- 若用户限定数量（「5 篇」），设置对应 `limit`。
- 「最新/最近/latest/recent」是**泛化意图**，不要把这些词当成源名过滤（handler 也会把这类词当 generic latest）。

可选：`phantasi.page` + `level: "items"` 仅在已有 `sourceId` 时使用；跨源场景优先 `phantasi.items`。

## 步骤 2（可选）：需要源目录时

仅当用户同时问「我订了哪些」时，再调 `phantasi.sources`（可无 `query`，返回 `sources`/`total`/`totalInSystem`）。平时拉最新文章不必先 list 源。

## 步骤 3：展示

按时间倒序：标题、源名称（`_feedTitle` 等）、发布时间、链接。用户要总结时再另开 `ai.summarize`（不在本 Skill 默认路径）。

# 与相近 Skill 的区分

| 用户意图 | Skill |
|----------|--------|
| 友链目录 | `phantasi-friend-links`（`phantasi.sources` + `category`） |
| 某个具体源的最新 | `phantasi-source-latest`（`query` → `sourceId` → `phantasi.items`） |
| 全局最近文章 | **本 Skill** |
