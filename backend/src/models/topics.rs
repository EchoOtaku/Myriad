use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Topic {
    pub id: u8,
    pub title: String,
    pub category: String,
    pub prompt_template: String,
}

/// 50个创意话题预设
pub fn get_all_topics() -> Vec<Topic> {
    vec![
        // 🌈 隐喻类板块
        Topic {
            id: 8,
            title: "你是哪种天气？".to_string(),
            category: "隐喻类".to_string(),
            prompt_template: r#"分析用户的情绪气候：
- 晴天/雨天/多云/暴风雪的占比
- 情绪气候变化曲线
- "季节性"特征"#.to_string(),
        },
        Topic {
            id: 9,
            title: "你的内心是什么生态系统？".to_string(),
            category: "隐喻类".to_string(),
            prompt_template: r#"分析用户的内心生态：
- 是森林/海洋/沙漠/城市？
- 生物多样性指数（兴趣丰富度）
- 主要栖息的"物种"（内容类型）"#.to_string(),
        },
        Topic {
            id: 10,
            title: "如果你是一首歌".to_string(),
            category: "隐喻类".to_string(),
            prompt_template: r#"音乐化人格分析：
- 曲风：古典/摇滚/爵士/电子？
- 节奏：快板/慢板/变奏
- 歌词主题词云"#.to_string(),
        },
        Topic {
            id: 11,
            title: "你的人生是什么类型的电影？".to_string(),
            category: "隐喻类".to_string(),
            prompt_template: r#"电影化叙事分析：
- 类型：悬疑/喜剧/文艺/科幻/动作
- 目前在第几幕
- 可能的剧情转折点"#.to_string(),
        },
        Topic {
            id: 12,
            title: "你是哪种建筑？".to_string(),
            category: "隐喻类".to_string(),
            prompt_template: r#"建筑风格人格：
- 古堡/摩天楼/小木屋/未来主义建筑
- 建筑风格（简约/繁复/混搭）
- 对外的窗户数量（开放度）"#.to_string(),
        },
        
        // 🎮 游戏化板块
        Topic {
            id: 13,
            title: "你的人生游戏属性面板".to_string(),
            category: "游戏化".to_string(),
            prompt_template: r#"RPG属性评估：
- 智力、体力、社交、创造、专注、冒险（各5星制）
- 各属性的具体表现
- 属性分布特点"#.to_string(),
        },
        Topic {
            id: 14,
            title: "已解锁的成就徽章".to_string(),
            category: "游戏化".to_string(),
            prompt_template: r#"成就系统分析：
- 根据用户行为数据解锁的成就（如：深夜学者、小众猎人、知识海绵、灵感捕手）
- 每个成就的解锁条件和时间
- 稀有度评级"#.to_string(),
        },
        Topic {
            id: 15,
            title: "你的技能树全景图".to_string(),
            category: "游戏化".to_string(),
            prompt_template: r#"技能发展分析：
- 已满级技能（Lv.10）
- 成长中技能（Lv.5）
- 待解锁技能（Lv.0）
- 天赋技能推荐"#.to_string(),
        },
        Topic {
            id: 16,
            title: "你的背包里有什么？".to_string(),
            category: "游戏化".to_string(),
            prompt_template: r#"装备系统盘点：
- 常用装备（核心工具/平台）
- 收藏品（珍藏的内容类型）
- 消耗品（日常消费内容）
- 隐藏道具（意外的小兴趣）"#.to_string(),
        },
        Topic {
            id: 17,
            title: "你在多元宇宙的不同版本".to_string(),
            category: "游戏化".to_string(),
            prompt_template: r#"平行宇宙推演：
- 平行世界A：如果你多关注X领域
- 平行世界B：如果你少花时间在Y上
- 最接近的可能性未来"#.to_string(),
        },
        
        // 🔬 科学实验室板块
        Topic {
            id: 18,
            title: "你的注意力DNA图谱".to_string(),
            category: "科学实验室".to_string(),
            prompt_template: r#"DNA序列解码：
- 基因序列：ATTGC（艺术-科技-人文-游戏-商业）
- 显性基因 vs 隐性基因
- 基因突变点（新兴趣）"#.to_string(),
        },
        Topic {
            id: 19,
            title: "你的多巴胺配方".to_string(),
            category: "科学实验室".to_string(),
            prompt_template: r#"快乐化学分析：
- 新鲜刺激 X%
- 深度沉浸 X%
- 社交连接 X%
- 成就获得 X%
- 你的快乐按钮"#.to_string(),
        },
        Topic {
            id: 20,
            title: "大脑扫描报告".to_string(),
            category: "科学实验室".to_string(),
            prompt_template: r#"认知功能扫描：
- 最活跃的脑区（最常思考的主题）
- 神经可塑性指数（学习新事物的频率）
- 左右脑平衡度
- 前额叶控制力（自律程度）"#.to_string(),
        },
        Topic {
            id: 21,
            title: "你的化学元素周期表".to_string(),
            category: "科学实验室".to_string(),
            prompt_template: r#"元素成分分析：
- 主要成分：好奇（Cu）X% + 创造（Cr）X% + 焦虑（An）X%
- 稳定同位素 vs 放射性元素
- 化学反应（不同兴趣的碰撞）"#.to_string(),
        },
        
        // 🗺️ 旅行地图板块
        Topic {
            id: 22,
            title: "你的兴趣世界地图".to_string(),
            category: "旅行地图".to_string(),
            prompt_template: r#"探索轨迹绘制：
- 已探索的大陆
- 常驻城市 vs 偶尔旅行地
- 未知领域（地图上的迷雾）
- 下一站推荐"#.to_string(),
        },
        Topic {
            id: 23,
            title: "时间旅行护照".to_string(),
            category: "旅行地图".to_string(),
            prompt_template: r#"时空旅行档案：
- 最常访问的时代（古代/现代/未来）
- 盖章最多的国家（文化偏好）
- 最长停留记录（深度兴趣）
- 签证建议（可以去看看的新领域）"#.to_string(),
        },
        Topic {
            id: 24,
            title: "你的精神原住民身份".to_string(),
            category: "旅行地图".to_string(),
            prompt_template: r#"次文化归属分析：
- 你是哪个次文化圈的原住民？
- 你的部落语言（专属黑话）
- 图腾动物/象征符号"#.to_string(),
        },
        
        // 🎭 剧场与角色板块
        Topic {
            id: 25,
            title: "你演的是什么角色？".to_string(),
            category: "剧场角色".to_string(),
            prompt_template: r#"角色扮演分析：
- 主要人设：学者/玩家/创造者/观察者
- 副业角色
- 偶尔的串场角色
- 想尝试的新角色"#.to_string(),
        },
        Topic {
            id: 26,
            title: "你的人格面具收藏".to_string(),
            category: "剧场角色".to_string(),
            prompt_template: r#"面具库存盘点：
- 社交面具 vs 独处真面目
- 白天的你 vs 深夜的你
- 面具切换频率"#.to_string(),
        },
        Topic {
            id: 27,
            title: "如果你是一部漫画".to_string(),
            category: "剧场角色".to_string(),
            prompt_template: r#"漫画化人生：
- 画风：少年热血/青年文艺/成人写实
- 连载状态：周更/月更/不定期
- 单行本卷数与故事进度
- 读者评论区（自我认知 vs 实际表现）"#.to_string(),
        },
        Topic {
            id: 28,
            title: "你的声音频谱分析".to_string(),
            category: "剧场角色".to_string(),
            prompt_template: r#"声音特质解析：
- 高音（激情内容）vs 低音（冷静内容）
- 音量大小（表达欲）
- 音色特质（独特的表达风格）
- 你的主题曲是什么？"#.to_string(),
        },
        
        // 🍜 美食与配方板块
        Topic {
            id: 29,
            title: "你是一道什么菜？".to_string(),
            category: "美食配方".to_string(),
            prompt_template: r#"美食人格定位：
- 菜系：川菜/粤菜/西餐/fusion
- 口味：酸甜苦辣咸的配比
- 烹饪方法：爆炒/慢炖/生食
- 适合的搭配（互补型朋友）"#.to_string(),
        },
        Topic {
            id: 30,
            title: "你的每日营养成分表".to_string(),
            category: "美食配方".to_string(),
            prompt_template: r#"数字营养分析：
- 碳水（轻松娱乐）Xg
- 蛋白质（硬核知识）Xg
- 维生素（艺术审美）Xmg
- 矿物质（社交互动）Xmg
- 膳食纤维（反思沉淀）Xg"#.to_string(),
        },
        Topic {
            id: 31,
            title: "你的鸡尾酒配方".to_string(),
            category: "美食配方".to_string(),
            prompt_template: r#"个性鸡尾酒调制：
- 基酒：理性/感性
- 调和剂：好奇心/创造力
- 装饰：幽默感/深度思考
- 冰块：自律/放松
- 杯口装饰物：独特的小癖好"#.to_string(),
        },
        
        // 🌌 宇宙与玄学板块
        Topic {
            id: 32,
            title: "你的星系类型".to_string(),
            category: "宇宙玄学".to_string(),
            prompt_template: r#"星系结构分析：
- 螺旋星系/椭圆星系/不规则星系
- 中心黑洞（核心驱动力）
- 围绕的行星（卫星兴趣）
- 星系间引力（社交网络）"#.to_string(),
        },
        Topic {
            id: 33,
            title: "你的能量光谱".to_string(),
            category: "宇宙玄学".to_string(),
            prompt_template: r#"光谱能量分析：
- 红外线（低调内敛）vs 紫外线（活跃外放）
- 可见光范围（公开展示的部分）
- 暗物质（隐藏的自己）
- 辐射强度（影响力）"#.to_string(),
        },
        Topic {
            id: 34,
            title: "时间线上的你".to_string(),
            category: "宇宙玄学".to_string(),
            prompt_template: r#"时空定位分析：
- 过去的你：留下的数字化石
- 现在的你：实时快照
- 未来的你：趋势外推
- 平行宇宙的你：如果做不同选择"#.to_string(),
        },
        Topic {
            id: 35,
            title: "你的灵魂成分分析".to_string(),
            category: "宇宙玄学".to_string(),
            prompt_template: r#"灵魂年龄鉴定：
- 古老的灵魂 vs 年轻的心
- 灵魂年龄 vs 生理年龄
- 前世职业推测（基于兴趣）
- 来世可能性"#.to_string(),
        },
        
        // 🔮 占卜与预测板块
        Topic {
            id: 36,
            title: "塔罗牌抽牌（数据版）".to_string(),
            category: "占卜预测".to_string(),
            prompt_template: r#"数据塔罗解读：
- 过去：愚者/魔术师/女祭司...
- 现在：力量/隐者/命运之轮...
- 未来：星星/月亮/太阳...
- 基于数据趋势的"命运"解读"#.to_string(),
        },
        Topic {
            id: 37,
            title: "水晶球预测".to_string(),
            category: "占卜预测".to_string(),
            prompt_template: r#"未来趋势预言：
- 3个月后你可能的新兴趣
- 潜在的技能突破点
- 需要警惕的"命运陷阱"
- 幸运方向指引"#.to_string(),
        },
        Topic {
            id: 38,
            title: "你的幸运数字密码".to_string(),
            category: "占卜预测".to_string(),
            prompt_template: r#"数字命理学：
- 从数据中提取的神秘数字
- 数字背后的含义
- 你的数字签名"#.to_string(),
        },
        
        // 🎪 社交与关系板块
        Topic {
            id: 39,
            title: "你的社交人格".to_string(),
            category: "社交关系".to_string(),
            prompt_template: r#"社交模式分析：
- 社交动物类型：独狼/群居/候鸟
- 关系深度 vs 广度
- 数字社交足迹热力图
- 你在朋友圈的"角色定位""#.to_string(),
        },
        Topic {
            id: 40,
            title: "你的同温层分析".to_string(),
            category: "社交关系".to_string(),
            prompt_template: r#"圈层生态研究：
- 你的圈子画像
- 你是圈内的什么角色？
- 信息茧房指数
- 破圈建议"#.to_string(),
        },
        Topic {
            id: 41,
            title: "找到你的灵魂伙伴".to_string(),
            category: "社交关系".to_string(),
            prompt_template: r#"匹配度分析：
- 基于兴趣匹配的相似用户画像
- 互补型伙伴推荐
- 你能给朋友带来什么"#.to_string(),
        },
        
        // 📊 对比与镜像板块
        Topic {
            id: 42,
            title: "你 vs 同龄人平均水平".to_string(),
            category: "对比镜像".to_string(),
            prompt_template: r#"群体定位分析：
- 领先的维度
- 落后的维度
- 独一无二的维度
- 你在人群中的位置"#.to_string(),
        },
        Topic {
            id: 43,
            title: "理想的你 vs 现实的你".to_string(),
            category: "对比镜像".to_string(),
            prompt_template: r#"理想现实差距：
- 内容表达的自我期待
- 实际行为反映的真实状态
- 差距分析与弥合建议"#.to_string(),
        },
        Topic {
            id: 44,
            title: "一年前的你 vs 现在的你".to_string(),
            category: "对比镜像".to_string(),
            prompt_template: r#"年度成长对比：
- 最大的变化
- 保持不变的核心
- 成长速度仪表盘
- 进化方向箭头"#.to_string(),
        },
        Topic {
            id: 45,
            title: "你以为的你 vs 数据说的你".to_string(),
            category: "对比镜像".to_string(),
            prompt_template: r#"认知偏差揭示：
- 自我认知 vs 实际表现
- 意外的发现
- 盲点照妖镜"#.to_string(),
        },
        
        // 🎁 惊喜与彩蛋板块
        Topic {
            id: 46,
            title: "你的数字考古发现".to_string(),
            category: "惊喜彩蛋".to_string(),
            prompt_template: r#"历史遗迹挖掘：
- 最古老的兴趣遗迹
- 已经消失的兴趣文明
- 考古学价值评估"#.to_string(),
        },
        Topic {
            id: 47,
            title: "你的隐藏超能力".to_string(),
            category: "惊喜彩蛋".to_string(),
            prompt_template: r#"潜能发现报告：
- 数据揭示的潜在天赋
- 还没发现的自己
- 超能力开发指南"#.to_string(),
        },
        Topic {
            id: 48,
            title: "如果用一个表情包代表你".to_string(),
            category: "惊喜彩蛋".to_string(),
            prompt_template: r#"表情包人格：
- 最符合的表情包
- 为什么是它
- 表情包使用场景"#.to_string(),
        },
        Topic {
            id: 49,
            title: "你的数字遗产".to_string(),
            category: "惊喜彩蛋".to_string(),
            prompt_template: r#"遗产规划思考：
- 如果只能留下3样内容
- 最能代表你的数字痕迹
- 你想被如何记住"#.to_string(),
        },
        Topic {
            id: 50,
            title: "给未来自己的时间胶囊".to_string(),
            category: "惊喜彩蛋".to_string(),
            prompt_template: r#"时间胶囊信件：
- 现在的你想对未来说什么
- 基于趋势的未来预测信
- 1年后打开"#.to_string(),
        },
    ]
}

/// 随机选择6个话题
pub fn select_random_topics() -> Vec<Topic> {
    use rand::seq::SliceRandom;
    use rand::thread_rng;
    
    let mut topics = get_all_topics();
    let mut rng = thread_rng();
    topics.shuffle(&mut rng);
    topics.into_iter().take(6).collect()
}
