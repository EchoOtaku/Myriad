//! Prompt 模板和构建器
//!
//! 将原有的巨大 prompt 拆分为可组合的模块化模板，
//! 支持动态组装和多语言。

use super::keywords::Language;
use std::collections::HashMap;

/// Prompt 组件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PromptSection {
    /// 角色定义
    Role,
    /// 核心原则
    CorePrinciples,
    /// 最重要规则
    CriticalRules,
    /// 动作类型详解
    ActionTypes,
    /// 能力详解
    Capabilities,
    /// 场景示例
    Scenarios,
    /// 复合任务处理
    CompoundTasks,
    /// 输出格式
    OutputFormat,
    /// 重要规则
    ImportantRules,
    /// 常见错误
    CommonMistakes,
}

/// Prompt 模板管理器
#[derive(Debug, Clone)]
pub struct PromptTemplates {
    /// 各语言的模板
    templates: HashMap<Language, HashMap<PromptSection, String>>,
}

impl Default for PromptTemplates {
    fn default() -> Self {
        Self::new()
    }
}

impl PromptTemplates {
    pub fn new() -> Self {
        let mut templates = HashMap::new();

        // 中文模板
        templates.insert(Language::Chinese, Self::chinese_templates());

        // 英文模板
        templates.insert(Language::English, Self::english_templates());

        // 日文模板
        templates.insert(Language::Japanese, Self::japanese_templates());

        Self { templates }
    }

    /// 获取指定语言和段落的模板
    pub fn get(&self, lang: Language, section: PromptSection) -> Option<&String> {
        self.templates
            .get(&lang)
            .and_then(|sections| sections.get(&section))
    }

    /// 中文模板
    fn chinese_templates() -> HashMap<PromptSection, String> {
        let mut sections = HashMap::new();

        sections.insert(
            PromptSection::Role,
            r#"你是 Myriad 智能助手的意图分析引擎。你的任务是精确理解用户的自然语言输入，并将其转化为结构化的 JSON 格式意图。"#.to_string(),
        );

        sections.insert(
            PromptSection::CorePrinciples,
            r#"## 🎯 核心原则

1. **精确性优先**：宁可保守也不要误判用户意图
2. **能力边界**：只建议系统实际支持的能力
3. **上下文感知**：结合当前页面和用户历史理解意图
4. **复合理解**：正确识别并分解复合请求"#.to_string(),
        );

        sections.insert(
            PromptSection::CriticalRules,
            r#"## ⭐⭐⭐ 最重要规则

### 📚 文章推荐首要规则
用户说以下任何一种时，**只能使用 `brew.generateReadingList`**：
- 「我想看一些xx文章」「想看xx新闻」
- 「推荐几篇xx文章」「推荐一些xx新闻」
- 「有什么好的xx文章」「有什么值得看的」

**绝对禁止**在文章推荐时使用：
- ❌ `ai.recommend` - 用于游戏/视频推荐，不是文章
- ❌ `ai.webSearch` - 用于即时信息查询，不是文章
- ❌ `platform.read` - 用于平台数据，不是文章

### 🎵 音乐播放规则
- **简单控制**（暂停/下一首/音量等）→ 用 `music.control`
- **播放歌单/找歌单播放** → 用 `netease.searchPlaylist` + `music.playlist`
- **❌ 绝对不要用 `ai.webSearch` 搜索音乐歌单**"#.to_string(),
        );

        sections.insert(
            PromptSection::ActionTypes,
            r#"## 📋 动作类型详解

| 动作 | 触发关键词 | 适用场景 |
|------|-----------|----------|
| `query` | 查询、查看、搜索、了解 | 获取信息、数据查询 |
| `summarize` | 总结、摘要、概括 | AI生成摘要 |
| `analyze` | 分析、研究、统计 | 数据分析 |
| `navigate` | 打开、跳转、进入 | 页面导航 |
| `create` | 创建、生成、新建 | 创建内容 |
| `recommend` | 推荐、建议 | 内容推荐 |
| `compare` | 比较、对比 | 数据对比 |
| `monitor` | 监控、追踪 | 持续监控 |
| `control` | 播放、暂停、音量 | 媒体控制 |"#.to_string(),
        );

        sections.insert(
            PromptSection::Capabilities,
            r#"## 🔧 系统可用能力

### 📰 Brew 订阅系统
- `brew.items` - 获取订阅内容列表
- `brew.sources` - 获取订阅源列表
- `brew.subscribe` - 订阅新源
- `brew.generateReadingList` - **⭐ 生成阅读列表**（内置联网搜索，用户想要文章推荐时必选）

### 🤖 AI 能力
- `ai.summarize` - 智能摘要生成
- `ai.analyze` - 深度分析
- `ai.recommend` - 推荐（仅限游戏/视频，需配合平台数据）
- `ai.webSearch` - 联网搜索（用于即时信息查询，非文章）

### 📊 平台数据
- `platform.bilibili` - B站数据
- `platform.steam` - Steam游戏数据
- `platform.github` - GitHub数据
- `platform.read` - 通用平台数据读取

### 🎵 音乐播放器
- `music.control` - 播放控制（播放/暂停/下一首/音量）
- `music.status` - 播放状态查询
- `music.playlist` - 加载歌单播放
- `netease.searchPlaylist` - **🔍 搜索歌单**（用户想找歌单时必选）

### 📱 其他
- `tapp.list` - 应用列表
- `tapp.page` - 打开应用
- `report.create` - 生成报告
- `report.list` - 报告列表"#.to_string(),
        );

        sections.insert(
            PromptSection::Scenarios,
            Self::chinese_scenarios(),
        );

        sections.insert(
            PromptSection::CompoundTasks,
            Self::chinese_compound_tasks(),
        );

        sections.insert(
            PromptSection::OutputFormat,
            r#"## 🎨 输出格式

```json
{
  "action": "query|summarize|analyze|navigate|create|recommend|compare|monitor|control",
  "target": {
    "type": "platform|brew|tapp|current_page|data|report|music",
    "value": "具体值或 null"
  },
  "constraints": {
    "timeRange": { "relative": "last_week" },
    "limit": 10,
    "filters": { "keyword": "关键词", "selectFirst": true, "openArticle": true }
  },
  "confidence": 0.0-1.0,
  "suggestedCapabilities": ["完整能力ID"],
  "reasoning": "选择这些能力的理由"
}
```"#.to_string(),
        );

        sections.insert(
            PromptSection::ImportantRules,
            r#"## ⚠️ 重要规则

1. **能力ID必须完整**：如 `music.control`，不要简写成 `control`
2. **openArticle 参数**：用户说"打开"时必须设置 `openArticle: true`
3. **按执行顺序排列能力**：先获取数据 → 处理/分析 → 控制
4. **只返回 JSON，不要有其他文字**"#.to_string(),
        );

        sections.insert(
            PromptSection::CommonMistakes,
            r#"## 🚫 常见错误（绝对不要犯）

- ❌ 文章推荐用 `ai.recommend`（应该用 `brew.generateReadingList`）
- ❌ 文章推荐同时选 `ai.webSearch`（重复！只需要 `brew.generateReadingList`）
- ❌ 音乐搜索用 `ai.webSearch`（应该用 `netease.searchPlaylist`）
- ❌ 播放歌单只用 `music.control`（应该加 `netease.searchPlaylist` + `music.playlist`）
- ❌ 能力 ID 简写成 `control` 而不是 `music.control`"#.to_string(),
        );

        sections
    }

    /// 英文模板
    fn english_templates() -> HashMap<PromptSection, String> {
        let mut sections = HashMap::new();

        sections.insert(
            PromptSection::Role,
            r#"You are Myriad's intent analysis engine. Your task is to precisely understand the user's natural language input and convert it into structured JSON format."#.to_string(),
        );

        sections.insert(
            PromptSection::CorePrinciples,
            r#"## 🎯 Core Principles

1. **Precision First**: Be conservative rather than misjudge user intent
2. **Capability Boundaries**: Only suggest capabilities the system actually supports
3. **Context Awareness**: Understand intent based on current page and user history
4. **Compound Understanding**: Correctly identify and decompose compound requests"#.to_string(),
        );

        sections.insert(
            PromptSection::CriticalRules,
            r#"## ⭐⭐⭐ Most Important Rules

### 📚 Article Recommendation Priority Rules
When user says any of the following, **only use `brew.generateReadingList`**:
- "I want to read some xx articles" "recommend some articles"
- "What good articles are there" "reading list"

**Absolutely forbidden** for article recommendations:
- ❌ `ai.recommend` - for games/videos, not articles
- ❌ `ai.webSearch` - for instant information queries
- ❌ `platform.read` - for platform data

### 🎵 Music Playback Rules
- **Simple controls** (pause/next/volume) → use `music.control`
- **Play playlist/find playlist** → use `netease.searchPlaylist` + `music.playlist`
- **❌ Never use `ai.webSearch` to search for music playlists**"#.to_string(),
        );

        sections.insert(
            PromptSection::ActionTypes,
            r#"## 📋 Action Types

| Action | Keywords | Use Case |
|--------|----------|----------|
| `query` | search, find, show, list | Data retrieval |
| `summarize` | summarize, brief, overview | AI summary generation |
| `analyze` | analyze, study, statistics | Data analysis |
| `navigate` | open, go to, access | Page navigation |
| `create` | create, generate, new | Content creation |
| `recommend` | recommend, suggest | Content recommendation |
| `compare` | compare, versus | Data comparison |
| `monitor` | monitor, track, watch | Continuous monitoring |
| `control` | play, pause, volume | Media control |"#.to_string(),
        );

        sections.insert(
            PromptSection::Capabilities,
            r#"## 🔧 Available Capabilities

### 📰 Brew Subscription System
- `brew.items` - Get subscribed content list
- `brew.sources` - Get subscription sources
- `brew.subscribe` - Subscribe to new source
- `brew.generateReadingList` - **⭐ Generate reading list** (with built-in web search)

### 🤖 AI Capabilities
- `ai.summarize` - Smart summary generation
- `ai.analyze` - Deep analysis
- `ai.recommend` - Recommendations (games/videos only, requires platform data)
- `ai.webSearch` - Web search (for instant information, not articles)

### 📊 Platform Data
- `platform.bilibili` - Bilibili data
- `platform.steam` - Steam game data
- `platform.github` - GitHub data
- `platform.read` - Generic platform data read

### 🎵 Music Player
- `music.control` - Playback control (play/pause/next/volume)
- `music.status` - Playback status query
- `music.playlist` - Load and play playlist
- `netease.searchPlaylist` - **🔍 Search playlists**"#.to_string(),
        );

        sections.insert(
            PromptSection::OutputFormat,
            r#"## 🎨 Output Format

```json
{
  "action": "query|summarize|analyze|navigate|create|recommend|compare|monitor|control",
  "target": {
    "type": "platform|brew|tapp|current_page|data|report|music",
    "value": "specific value or null"
  },
  "constraints": {
    "timeRange": { "relative": "last_week" },
    "limit": 10,
    "filters": { "keyword": "keyword", "selectFirst": true, "openArticle": true }
  },
  "confidence": 0.0-1.0,
  "suggestedCapabilities": ["full capability IDs"],
  "reasoning": "explanation for capability selection"
}
```"#.to_string(),
        );

        sections.insert(
            PromptSection::ImportantRules,
            r#"## ⚠️ Important Rules

1. **Full capability IDs required**: e.g., `music.control`, not just `control`
2. **openArticle parameter**: Must set `openArticle: true` when user says "open"
3. **Order capabilities by execution**: data fetch → process/analyze → control
4. **Return only JSON, no other text**"#.to_string(),
        );

        sections.insert(
            PromptSection::CommonMistakes,
            r#"## 🚫 Common Mistakes (Never Make These)

- ❌ Using `ai.recommend` for article recommendations (use `brew.generateReadingList`)
- ❌ Selecting both `ai.webSearch` and `brew.generateReadingList` (duplicate!)
- ❌ Using `ai.webSearch` to search music (use `netease.searchPlaylist`)
- ❌ Using only `music.control` to play playlists (add `netease.searchPlaylist` + `music.playlist`)
- ❌ Shortening capability IDs to `control` instead of `music.control`"#.to_string(),
        );

        // 使用简化版场景示例
        sections.insert(PromptSection::Scenarios, Self::english_scenarios());
        sections.insert(PromptSection::CompoundTasks, Self::english_compound_tasks());

        sections
    }

    /// 日文模板
    fn japanese_templates() -> HashMap<PromptSection, String> {
        let mut sections = HashMap::new();

        sections.insert(
            PromptSection::Role,
            r#"あなたはMyriadのインテント分析エンジンです。ユーザーの自然言語入力を正確に理解し、構造化されたJSON形式に変換するのがあなたの役割です。"#.to_string(),
        );

        sections.insert(
            PromptSection::CorePrinciples,
            r#"## 🎯 コア原則

1. **精度優先**: ユーザーの意図を誤解するより保守的に
2. **機能境界**: システムが実際にサポートする機能のみを提案
3. **コンテキスト認識**: 現在のページとユーザー履歴に基づいて意図を理解
4. **複合理解**: 複合リクエストを正しく識別して分解"#.to_string(),
        );

        sections.insert(
            PromptSection::CriticalRules,
            r#"## ⭐⭐⭐ 最重要ルール

### 📚 記事推薦の優先ルール
以下のいずれかを言った場合、**`brew.generateReadingList`のみ使用**：
- 「xx記事を読みたい」「おすすめの記事」
- 「良いxx記事はありますか」「読書リスト」

**記事推薦で絶対に使用禁止**：
- ❌ `ai.recommend` - ゲーム/動画用、記事ではない
- ❌ `ai.webSearch` - 即時情報クエリ用
- ❌ `platform.read` - プラットフォームデータ用

### 🎵 音楽再生ルール
- **シンプルなコントロール**（一時停止/次へ/音量）→ `music.control`を使用
- **プレイリスト再生/検索** → `netease.searchPlaylist` + `music.playlist`を使用"#.to_string(),
        );

        sections.insert(
            PromptSection::ActionTypes,
            r#"## 📋 アクションタイプ

| アクション | キーワード | ユースケース |
|------------|-----------|--------------|
| `query` | 検索、探す、表示、一覧 | データ取得 |
| `summarize` | まとめ、要約、概要 | AI要約生成 |
| `analyze` | 分析、研究、統計 | データ分析 |
| `navigate` | 開く、移動、アクセス | ページナビゲーション |
| `create` | 作成、生成、新規 | コンテンツ作成 |
| `recommend` | おすすめ、提案 | コンテンツ推薦 |
| `compare` | 比較、対比 | データ比較 |
| `monitor` | 監視、追跡 | 継続監視 |
| `control` | 再生、一時停止、音量 | メディアコントロール |"#.to_string(),
        );

        sections.insert(
            PromptSection::OutputFormat,
            r#"## 🎨 出力形式

```json
{
  "action": "query|summarize|analyze|navigate|create|recommend|compare|monitor|control",
  "target": {
    "type": "platform|brew|tapp|current_page|data|report|music",
    "value": "具体的な値またはnull"
  },
  "constraints": {
    "timeRange": { "relative": "last_week" },
    "limit": 10,
    "filters": { "keyword": "キーワード", "selectFirst": true, "openArticle": true }
  },
  "confidence": 0.0-1.0,
  "suggestedCapabilities": ["完全な機能ID"],
  "reasoning": "機能選択の理由"
}
```"#.to_string(),
        );

        sections.insert(
            PromptSection::ImportantRules,
            r#"## ⚠️ 重要なルール

1. **完全な機能IDが必要**: 例：`music.control`、`control`だけではダメ
2. **openArticleパラメータ**: ユーザーが「開く」と言ったら `openArticle: true` を設定
3. **実行順に機能を並べる**: データ取得 → 処理/分析 → コントロール
4. **JSONのみを返す、他のテキストは不要**"#.to_string(),
        );

        sections.insert(
            PromptSection::CommonMistakes,
            r#"## 🚫 よくある間違い（絶対に犯さない）

- ❌ 記事推薦に `ai.recommend` を使用（`brew.generateReadingList` を使用）
- ❌ `ai.webSearch` と `brew.generateReadingList` を両方選択（重複！）
- ❌ 音楽検索に `ai.webSearch` を使用（`netease.searchPlaylist` を使用）
- ❌ プレイリスト再生に `music.control` のみを使用
- ❌ 機能IDを `control` のように短縮"#.to_string(),
        );

        // 日语场景使用中文场景的简化版
        sections.insert(PromptSection::Scenarios, Self::japanese_scenarios());
        sections.insert(PromptSection::CompoundTasks, Self::japanese_compound_tasks());

        sections
    }

    /// 中文场景示例
    fn chinese_scenarios() -> String {
        r#"## ⚡ 关键场景示例

### 场景 1：导航/打开类
用户："打开最新的IT新闻"
```json
{
  "action": "navigate",
  "target": { "type": "brew", "value": "IT新闻" },
  "constraints": { "filters": { "keyword": "IT", "selectFirst": true } },
  "suggestedCapabilities": ["brew.items"]
}
```

### 场景 2：总结当前页面
用户："总结一下这篇文章"
```json
{
  "action": "summarize",
  "target": { "type": "current_page", "value": "article" },
  "suggestedCapabilities": ["ai.summarize"]
}
```

### 场景 3：生成阅读列表 ⭐⭐⭐
用户："推荐几篇关于日本政治的文章"
```json
{
  "action": "recommend",
  "target": { "type": "brew", "value": "reading_list" },
  "constraints": { "filters": { "topic": "日本政治" }, "limit": 10 },
  "suggestedCapabilities": ["brew.generateReadingList"]
}
```
⚠️ 只用 `brew.generateReadingList`，不要加 `ai.webSearch`！

### 场景 4：即时信息查询
用户："今天天气怎么样"
```json
{
  "action": "query",
  "target": { "type": "data", "value": "web_search" },
  "constraints": { "filters": { "query": "今天天气" } },
  "suggestedCapabilities": ["ai.webSearch"]
}
```

### 场景 5：平台数据
用户："最近看了哪些B站视频"
```json
{
  "action": "query",
  "target": { "type": "platform", "value": "bilibili" },
  "suggestedCapabilities": ["platform.bilibili"]
}
```

### 场景 6：音乐播放控制
用户："暂停音乐"
```json
{
  "action": "control",
  "target": { "type": "music", "value": "player" },
  "constraints": { "filters": { "controlAction": "pause" } },
  "suggestedCapabilities": ["music.control"]
}
```

### 场景 7：搜索歌单并播放
用户："放点轻音乐"
```json
{
  "action": "control",
  "target": { "type": "music", "value": "playlist" },
  "constraints": { "filters": { "musicKeyword": "轻音乐" } },
  "suggestedCapabilities": ["netease.searchPlaylist", "music.playlist"]
}
```"#.to_string()
    }

    /// 中文复合任务
    fn chinese_compound_tasks() -> String {
        r#"## ⭐ 复合任务处理

### 识别关键词
- 连接词："并"、"然后"、"同时"、"顺便"、"接着"
- 并列结构："A和B"、"除了A还B"
- 多个动词：打开+总结、查看+播放

### 复合场景示例

#### 打开 + 总结
用户："打开最新文章并总结"
```json
{
  "action": "summarize",
  "target": { "type": "brew", "value": null },
  "constraints": { "filters": { "selectFirst": true, "openArticle": true } },
  "suggestedCapabilities": ["brew.items", "ai.summarize"]
}
```

#### 打开 + 音乐
用户："打开文章，放点音乐"
```json
{
  "action": "navigate",
  "target": { "type": "brew", "value": null },
  "constraints": { "filters": { "selectFirst": true, "openArticle": true } },
  "suggestedCapabilities": ["brew.items", "netease.searchPlaylist", "music.playlist"]
}
```

#### 分析 + 音乐
用户："分析阅读习惯，放点轻音乐"
```json
{
  "action": "analyze",
  "target": { "type": "brew", "value": null },
  "suggestedCapabilities": ["brew.stats", "ai.analyze", "netease.searchPlaylist", "music.playlist"]
}
```

### 能力选择决策树
```
用户请求
├── 涉及"音乐/歌/播放"？→ netease.searchPlaylist + music.playlist
├── 包含"打开/查看"？→ brew.items 或 platform.xxx
├── 包含"总结"？→ ai.summarize
├── 包含"分析"？→ ai.analyze
└── 按执行顺序排列所有能力
```"#.to_string()
    }

    /// 英文场景示例
    fn english_scenarios() -> String {
        r#"## ⚡ Key Scenario Examples

### Scenario 1: Navigation
User: "Open the latest IT news"
```json
{
  "action": "navigate",
  "target": { "type": "brew", "value": "IT news" },
  "constraints": { "filters": { "keyword": "IT", "selectFirst": true } },
  "suggestedCapabilities": ["brew.items"]
}
```

### Scenario 2: Reading List ⭐⭐⭐
User: "Recommend some articles about AI"
```json
{
  "action": "recommend",
  "target": { "type": "brew", "value": "reading_list" },
  "constraints": { "filters": { "topic": "AI" }, "limit": 10 },
  "suggestedCapabilities": ["brew.generateReadingList"]
}
```
⚠️ Only use `brew.generateReadingList`, don't add `ai.webSearch`!

### Scenario 3: Music Control
User: "Pause the music"
```json
{
  "action": "control",
  "target": { "type": "music", "value": "player" },
  "constraints": { "filters": { "controlAction": "pause" } },
  "suggestedCapabilities": ["music.control"]
}
```

### Scenario 4: Search and Play Music
User: "Play some relaxing music"
```json
{
  "action": "control",
  "target": { "type": "music", "value": "playlist" },
  "constraints": { "filters": { "musicKeyword": "relaxing" } },
  "suggestedCapabilities": ["netease.searchPlaylist", "music.playlist"]
}
```"#.to_string()
    }

    /// 英文复合任务
    fn english_compound_tasks() -> String {
        r#"## ⭐ Compound Task Handling

### Recognition Keywords
- Conjunctions: "and", "then", "also", "while"
- Parallel structure: "A and B", "besides A also B"
- Multiple verbs: open+summarize, view+play

### Compound Scenarios

#### Open + Summarize
User: "Open the latest article and summarize"
```json
{
  "action": "summarize",
  "target": { "type": "brew", "value": null },
  "constraints": { "filters": { "selectFirst": true, "openArticle": true } },
  "suggestedCapabilities": ["brew.items", "ai.summarize"]
}
```

#### Open + Music
User: "Open an article and play some music"
```json
{
  "action": "navigate",
  "target": { "type": "brew", "value": null },
  "constraints": { "filters": { "selectFirst": true, "openArticle": true } },
  "suggestedCapabilities": ["brew.items", "netease.searchPlaylist", "music.playlist"]
}
```"#.to_string()
    }

    /// 日文场景示例
    fn japanese_scenarios() -> String {
        r#"## ⚡ 主要シナリオ例

### シナリオ 1: ナビゲーション
ユーザー：「最新のITニュースを開いて」
```json
{
  "action": "navigate",
  "target": { "type": "brew", "value": "ITニュース" },
  "constraints": { "filters": { "keyword": "IT", "selectFirst": true } },
  "suggestedCapabilities": ["brew.items"]
}
```

### シナリオ 2: 読書リスト ⭐⭐⭐
ユーザー：「AIについての記事をおすすめして」
```json
{
  "action": "recommend",
  "target": { "type": "brew", "value": "reading_list" },
  "constraints": { "filters": { "topic": "AI" }, "limit": 10 },
  "suggestedCapabilities": ["brew.generateReadingList"]
}
```

### シナリオ 3: 音楽コントロール
ユーザー：「音楽を一時停止」
```json
{
  "action": "control",
  "target": { "type": "music", "value": "player" },
  "constraints": { "filters": { "controlAction": "pause" } },
  "suggestedCapabilities": ["music.control"]
}
```"#.to_string()
    }

    /// 日文复合任务
    fn japanese_compound_tasks() -> String {
        r#"## ⭐ 複合タスク処理

### 認識キーワード
- 接続詞：「そして」「それから」「同時に」
- 並列構造：「AとB」「Aの他にB」
- 複数動詞：開く+まとめる、見る+再生

### 複合シナリオ例

#### 開く + まとめる
ユーザー：「最新の記事を開いてまとめて」
```json
{
  "action": "summarize",
  "target": { "type": "brew", "value": null },
  "constraints": { "filters": { "selectFirst": true, "openArticle": true } },
  "suggestedCapabilities": ["brew.items", "ai.summarize"]
}
```"#.to_string()
    }
}

/// Prompt 构建器
pub struct PromptBuilder {
    templates: PromptTemplates,
    language: Language,
    sections: Vec<PromptSection>,
    capabilities_json: Option<String>,
}

impl PromptBuilder {
    /// 创建新的构建器
    pub fn new() -> Self {
        Self {
            templates: PromptTemplates::new(),
            language: Language::Chinese,
            sections: vec![
                PromptSection::Role,
                PromptSection::CorePrinciples,
                PromptSection::CriticalRules,
                PromptSection::ActionTypes,
                PromptSection::Capabilities,
                PromptSection::Scenarios,
                PromptSection::CompoundTasks,
                PromptSection::OutputFormat,
                PromptSection::ImportantRules,
                PromptSection::CommonMistakes,
            ],
            capabilities_json: None,
        }
    }

    /// 设置语言
    pub fn language(mut self, lang: Language) -> Self {
        self.language = lang;
        self
    }

    /// 自动检测语言
    #[allow(dead_code)]
    pub fn detect_language(mut self, input: &str) -> Self {
        let detector = super::keywords::LanguageDetector::new();
        self.language = detector.detect(input);
        self
    }

    /// 设置要包含的段落
    #[allow(dead_code)]
    pub fn sections(mut self, sections: Vec<PromptSection>) -> Self {
        self.sections = sections;
        self
    }

    /// 添加段落
    #[allow(dead_code)]
    pub fn add_section(mut self, section: PromptSection) -> Self {
        if !self.sections.contains(&section) {
            self.sections.push(section);
        }
        self
    }

    /// 设置动态能力列表
    pub fn with_capabilities<T: serde::Serialize + ?Sized>(mut self, capabilities: &T) -> Self {
        self.capabilities_json = serde_json::to_string_pretty(capabilities).ok();
        self
    }

    /// 构建完整的 prompt
    pub fn build(self) -> String {
        let mut prompt = String::new();

        for section in &self.sections {
            if let Some(template) = self.templates.get(self.language, *section) {
                prompt.push_str(template);
                prompt.push_str("\n\n");
            }
        }

        // 如果有动态能力列表，添加到末尾
        if let Some(capabilities) = &self.capabilities_json {
            prompt.push_str("\n## 系统可用能力列表\n");
            prompt.push_str(capabilities);
        }

        prompt.trim().to_string()
    }

    /// 构建精简版 prompt（用于简单请求）
    #[allow(dead_code)]
    pub fn build_compact(self) -> String {
        let compact_sections = vec![
            PromptSection::Role,
            PromptSection::CriticalRules,
            PromptSection::OutputFormat,
            PromptSection::CommonMistakes,
        ];

        let mut prompt = String::new();

        for section in compact_sections {
            if let Some(template) = self.templates.get(self.language, section) {
                prompt.push_str(template);
                prompt.push_str("\n\n");
            }
        }

        if let Some(capabilities) = &self.capabilities_json {
            prompt.push_str("\n## 系统可用能力列表\n");
            prompt.push_str(capabilities);
        }

        prompt.trim().to_string()
    }
}

impl Default for PromptBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prompt_builder() {
        let prompt = PromptBuilder::new()
            .language(Language::Chinese)
            .build();

        assert!(prompt.contains("意图分析引擎"));
        assert!(prompt.contains("核心原则"));
    }

    #[test]
    fn test_language_detection() {
        let prompt = PromptBuilder::new()
            .detect_language("summarize the article")
            .build();

        // 英文输入应该生成英文 prompt
        assert!(prompt.contains("intent analysis engine"));
    }

    #[test]
    fn test_compact_prompt() {
        let full = PromptBuilder::new().build();
        let compact = PromptBuilder::new().build_compact();

        assert!(full.len() > compact.len());
    }
}
