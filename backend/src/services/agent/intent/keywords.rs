//! 多语言关键词库
//!
//! 使用统一的关键词表，所有语言变体放在一起，匹配时不区分语言。
//! 语言检测仅用于选择 AI prompt 的响应语言。

/// 支持的语言（仅用于 prompt 语言选择）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Language {
    #[default]
    Chinese,
    English,
    Japanese,
}

impl Language {
    /// 获取语言代码
    #[allow(dead_code)]
    pub fn code(&self) -> &'static str {
        match self {
            Language::Chinese => "zh",
            Language::English => "en",
            Language::Japanese => "ja",
        }
    }
}

/// 语言检测器（用于选择 prompt 语言）
#[derive(Debug, Clone, Default)]
pub struct LanguageDetector;

impl LanguageDetector {
    pub fn new() -> Self {
        Self
    }

    /// 检测输入文本的主要语言
    pub fn detect(&self, text: &str) -> Language {
        let mut has_japanese = false;
        let mut has_chinese = false;
        let mut ascii_count = 0usize;
        let total_chars = text.chars().count();

        for ch in text.chars() {
            // 日文假名（优先检测）
            if ('\u{3040}'..='\u{309f}').contains(&ch)  // 平假名
                || ('\u{30a0}'..='\u{30ff}').contains(&ch)
            // 片假名
            {
                has_japanese = true;
            }
            // 中文汉字
            else if ('\u{4e00}'..='\u{9fff}').contains(&ch) {
                has_chinese = true;
            }
            // ASCII
            else if ch.is_ascii_alphabetic() {
                ascii_count += 1;
            }
        }

        if has_japanese {
            Language::Japanese
        } else if has_chinese {
            Language::Chinese
        } else if total_chars > 0 && ascii_count * 2 > total_chars {
            Language::English
        } else {
            Language::Chinese // 默认
        }
    }
}

/// 关键词条目：一个动作/平台/时间 对应多语言的所有变体
struct KeywordEntry {
    id: &'static str,
    variants: &'static [&'static str],
}

/// 动作关键词（统一表）
const ACTION_KEYWORDS: &[KeywordEntry] = &[
    KeywordEntry {
        id: "summarize",
        variants: &[
            // 中文
            "总结", "摘要", "概括", "归纳", "提炼", "综述", "小结",
            // 英文
            "summarize", "summary", "brief", "overview", "digest", "recap",
            // 日文
            "まとめ", "要約", "概要", "サマリー",
        ],
    },
    KeywordEntry {
        id: "analyze",
        variants: &[
            "分析", "研究", "解析", "剖析", "统计", "评估",
            "analyze", "analyse", "analysis", "examine", "study", "evaluate", "statistics",
            "分析", "解析", "調べる", "調査", "統計",
        ],
    },
    KeywordEntry {
        id: "monitor",
        variants: &[
            "监控", "追踪", "关注", "跟踪", "监视", "观察",
            "monitor", "track", "watch", "follow", "observe",
            "監視", "追跡", "ウォッチ", "フォロー", "チェック",
        ],
    },
    KeywordEntry {
        id: "create",
        variants: &[
            "创建", "生成", "新建", "制作", "建立", "添加", "写", "编写",
            "create", "generate", "make", "build", "new", "add", "write", "draft",
            "作成", "生成", "新規", "作る", "追加", "書く",
        ],
    },
    KeywordEntry {
        id: "query",
        variants: &[
            "查询", "查看", "看看", "搜索", "查找", "找找", "了解", "获取", "显示", "列出", "搜", "查", "找",
            "query", "search", "find", "show", "list", "get", "fetch", "display", "look up",
            "検索", "探す", "見る", "表示", "一覧", "教えて", "見せて",
        ],
    },
    KeywordEntry {
        id: "navigate",
        variants: &[
            "打开", "跳转", "去", "前往", "进入", "访问", "转到", "切换", "浏览",
            "open", "go to", "navigate", "visit", "access", "switch to", "browse",
            "開く", "移動", "行く", "アクセス", "切り替え", "閲覧",
        ],
    },
    KeywordEntry {
        id: "compare",
        variants: &[
            "比较", "对比", "比对",
            "compare", "comparison", "versus", "vs",
            "比較", "比べる", "対比",
        ],
    },
    KeywordEntry {
        id: "recommend",
        variants: &[
            "推荐", "建议", "介绍",
            "recommend", "suggest", "recommendation",
            "おすすめ", "推薦", "提案", "紹介",
        ],
    },
    KeywordEntry {
        id: "control",
        variants: &[
            "播放", "暂停", "停止", "下一首", "上一首", "音量", "静音", "快进", "后退", "切歌",
            "play", "pause", "stop", "next", "previous", "volume", "mute", "skip",
            "再生", "一時停止", "停止", "次へ", "前へ", "音量", "ミュート", "スキップ",
        ],
    },
];

/// 平台关键词（统一表）
const PLATFORM_KEYWORDS: &[KeywordEntry] = &[
    KeywordEntry {
        id: "bilibili",
        variants: &[
            "b站", "B站", "哔哩哔哩", "bilibili", "bili",
            "ビリビリ", "Bステーション",
        ],
    },
    KeywordEntry {
        id: "steam",
        variants: &["steam", "Steam", "蒸汽", "スチーム"],
    },
    KeywordEntry {
        id: "github",
        variants: &["github", "GitHub", "gh", "ギットハブ"],
    },
    KeywordEntry {
        id: "netease",
        variants: &[
            "网易云", "网易云音乐", "云音乐", "netease",
            "ネットイース",
        ],
    },
];

/// 时间关键词（统一表）
const TIME_KEYWORDS: &[KeywordEntry] = &[
    KeywordEntry {
        id: "today",
        variants: &["今天", "今日", "本日", "today", "きょう"],
    },
    KeywordEntry {
        id: "yesterday",
        variants: &["昨天", "昨日", "yesterday", "きのう"],
    },
    KeywordEntry {
        id: "last_week",
        variants: &[
            "最近一周", "上周", "过去一周", "这周", "本周",
            "last week", "past week", "this week",
            "先週", "今週", "この一週間",
        ],
    },
    KeywordEntry {
        id: "last_month",
        variants: &[
            "最近一个月", "上月", "这个月", "本月",
            "last month", "past month", "this month",
            "先月", "今月", "この一ヶ月",
        ],
    },
    KeywordEntry {
        id: "last_year",
        variants: &[
            "最近一年", "去年", "今年", "本年",
            "last year", "past year", "this year",
            "去年", "今年", "この一年",
        ],
    },
    KeywordEntry {
        id: "recent",
        variants: &["最近", "近期", "最新", "recent", "recently", "latest", "最近", "この頃"],
    },
];

/// 统一的关键词匹配器
#[derive(Debug, Clone, Default)]
pub struct KeywordMatcher;

impl KeywordMatcher {
    pub fn new() -> Self {
        Self
    }

    /// 检测动作（语言无关）
    pub fn detect_action(&self, input: &str) -> Option<&'static str> {
        self.match_keywords(input, ACTION_KEYWORDS)
    }

    /// 检测平台（语言无关）
    pub fn detect_platform(&self, input: &str) -> Option<&'static str> {
        self.match_keywords(input, PLATFORM_KEYWORDS)
    }

    /// 检测时间范围（语言无关）
    pub fn detect_time(&self, input: &str) -> Option<&'static str> {
        self.match_keywords(input, TIME_KEYWORDS)
    }

    /// 提取数量限制
    pub fn extract_quantity(&self, input: &str) -> Option<u32> {
        // 所有语言的数量模式放一起
        let patterns = [
            // 中文
            r"前(\d+)个",
            r"最近(\d+)条",
            r"(\d+)条",
            r"(\d+)个",
            r"(\d+)篇",
            // 英文
            r"top\s*(\d+)",
            r"first\s*(\d+)",
            r"last\s*(\d+)",
            r"(\d+)\s*items?",
            // 日文
            r"(\d+)件",
            r"(\d+)個",
            r"上位(\d+)",
        ];

        let input_lower = input.to_lowercase();
        for pattern in patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                if let Some(caps) = re.captures(&input_lower) {
                    if let Some(num_str) = caps.get(1) {
                        if let Ok(num) = num_str.as_str().parse::<u32>() {
                            return Some(num);
                        }
                    }
                }
            }
        }
        None
    }

    /// 通用关键词匹配
    fn match_keywords(&self, input: &str, entries: &[KeywordEntry]) -> Option<&'static str> {
        let input_lower = input.to_lowercase();
        for entry in entries {
            for variant in entry.variants {
                if input_lower.contains(&variant.to_lowercase()) {
                    return Some(entry.id);
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_detection() {
        let detector = LanguageDetector::new();

        assert_eq!(detector.detect("查看最近的数据"), Language::Chinese);
        assert_eq!(detector.detect("show me recent data"), Language::English);
        assert_eq!(detector.detect("最近のデータを見せて"), Language::Japanese);
    }

    #[test]
    fn test_action_detection() {
        let matcher = KeywordMatcher::new();

        // 中文
        assert_eq!(matcher.detect_action("总结一下"), Some("summarize"));
        // 英文
        assert_eq!(matcher.detect_action("summarize this"), Some("summarize"));
        // 日文
        assert_eq!(matcher.detect_action("まとめて"), Some("summarize"));
        // 混合
        assert_eq!(matcher.detect_action("help me analyze"), Some("analyze"));
    }

    #[test]
    fn test_platform_detection() {
        let matcher = KeywordMatcher::new();

        assert_eq!(matcher.detect_platform("B站视频"), Some("bilibili"));
        assert_eq!(matcher.detect_platform("steam games"), Some("steam"));
        assert_eq!(matcher.detect_platform("ビリビリの動画"), Some("bilibili"));
    }

    #[test]
    fn test_time_detection() {
        let matcher = KeywordMatcher::new();

        assert_eq!(matcher.detect_time("最近一周"), Some("last_week"));
        assert_eq!(matcher.detect_time("last month"), Some("last_month"));
        assert_eq!(matcher.detect_time("今週"), Some("last_week"));
    }

    #[test]
    fn test_quantity_extraction() {
        let matcher = KeywordMatcher::new();

        assert_eq!(matcher.extract_quantity("前10个"), Some(10));
        assert_eq!(matcher.extract_quantity("top 20"), Some(20));
        assert_eq!(matcher.extract_quantity("5件"), Some(5));
    }
}
