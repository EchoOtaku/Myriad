import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../config';

interface UserInfo {
    name: string;
    avatar: string;
    platform: string;
}

interface CardContent {
    summary: string;
    details: string[];
    highlight?: string;
    tags: string[];
}

interface ReportCard {
    topic_id: number;
    title: string;
    category: string;
    icon: string;
    color: string;
    content: CardContent;
    illustration?: string; // 插画 URL
}

interface PersonalReport {
    cards: ReportCard[]; // 当前显示的卡片
    all_cards?: ReportCard[]; // 所有可用的卡片（包含历史缓存）
    generated_at: string;
    expires_at: string;
    selected_topics: number[];
}

export default function ReportCards() {
    const [selectedCard, setSelectedCard] = useState<ReportCard | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<PersonalReport | null>(null);
    const [displayCards, setDisplayCards] = useState<ReportCard[]>([]); // 当前显示的卡片
    const [progress, setProgress] = useState<string>('');
    const [progressPercent, setProgressPercent] = useState<number>(0);
    const [fromCache, setFromCache] = useState(false);
    const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
    const [avatarError, setAvatarError] = useState(false);
    const [petEnabled, setPetEnabled] = useState(true);
    const [petImageUrl, setPetImageUrl] = useState('https://api.fuukei.org/myriad/frontend/public/furina.png');

    // 从所有卡片中随机抽取指定数量（优先使用all_cards）
    const getRandomCards = useCallback((currentReport: PersonalReport | null, count: number = 6): ReportCard[] => {
        if (!currentReport) {
            console.warn('⚠️ [Random] No report available!');
            return [];
        }

        // 优先使用 all_cards，如果没有则使用 cards
        const allCards = currentReport.all_cards || currentReport.cards;
        console.log(`🎯 [Random] Source: ${currentReport.all_cards ? 'all_cards' : 'cards'}, Total: ${allCards?.length || 0} cards, Need: ${count} cards`);
        
        if (!allCards || allCards.length === 0) {
            console.warn('⚠️ [Random] No cards available!');
            return [];
        }
        if (allCards.length <= count) {
            console.log(`✅ [Random] Returning all ${allCards.length} cards`);
            return allCards;
        }
        
        // Fisher-Yates 洗牌算法
        const shuffled = [...allCards];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        const result = shuffled.slice(0, count);
        console.log(`✅ [Random] Returning ${result.length} random cards from ${allCards.length} total`);
        console.log(`   Selected cards: ${result.map(c => c.title).join(', ')}`);
        return result;
    }, []);

    // 生成默认头像 (SVG Data URL)
    const getDefaultAvatar = (name: string) => {
        const initial = name.charAt(0).toUpperCase();
        const colors = [
            { bg: '#6366f1', text: '#ffffff' },
            { bg: '#8b5cf6', text: '#ffffff' },
            { bg: '#ec4899', text: '#ffffff' },
            { bg: '#f59e0b', text: '#ffffff' },
            { bg: '#10b981', text: '#ffffff' },
        ];
        const colorIndex = name.charCodeAt(0) % colors.length;
        const color = colors[colorIndex];

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color.bg}"/><text x="50" y="50" font-family="Arial, sans-serif" font-size="45" font-weight="bold" fill="${color.text}" text-anchor="middle" dominant-baseline="central">${initial}</text></svg>`;
        return `data:image/svg+xml;base64,${btoa(svg)}`;
    };

    // 获取用户信息
    const fetchUserInfo = async () => {
        try {
            // 优先尝试从 Bilibili 获取
            const bilibiliUid = await fetch('http://localhost:3000/api/config')
                .then(res => res.json())
                .then(data => {
                    const bilibili = data.platforms?.find((p: any) => p.name === 'Bilibili');
                    return bilibili?.config_fields?.find((f: any) => f.key === 'uid')?.value;
                });

            if (bilibiliUid) {
                const response = await fetch(`http://localhost:3000/api/bilibili/user?uid=${bilibiliUid}`);
                const result = await response.json();
                if (result.success && result.data?.user_info) {
                    setUserInfo({
                        name: result.data.user_info.name,
                        avatar: result.data.user_info.face,
                        platform: 'Bilibili'
                    });
                    return;
                }
            }

            // 如果没有 Bilibili，尝试 GitHub
            const githubUsername = await fetch('http://localhost:3000/api/config')
                .then(res => res.json())
                .then(data => {
                    const github = data.platforms?.find((p: any) => p.name === 'GitHub');
                    return github?.config_fields?.find((f: any) => f.key === 'username')?.value;
                });

            if (githubUsername) {
                const response = await fetch(`https://api.github.com/users/${githubUsername}`);
                const result = await response.json();
                setUserInfo({
                    name: result.name || result.login,
                    avatar: result.avatar_url,
                    platform: 'GitHub'
                });
            }
        } catch (err) {
            console.error('Failed to fetch user info:', err);
        }
    };

    // 获取所有平台数据
    const fetchAllData = async () => {
        try {
            setProgress('步骤 1/3: 正在连接平台获取数据...');
            setProgressPercent(10);

            const response = await fetch('http://localhost:3000/api/profile/fetch-all', {
                method: 'POST',
            });

            setProgressPercent(40);

            if (!response.ok) {
                throw new Error(`Failed to fetch data: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success && result.data) {
                setProgressPercent(50);
                return result.data;
            } else {
                throw new Error('No data returned');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            throw new Error(message);
        }
    };

    // 生成报告
    const generateReport = async (data: any, forceRefresh: boolean = false) => {
        try {
            setProgress('步骤 2/3: AI 正在分析数据...');
            setProgressPercent(55);
            
            const url = forceRefresh 
                ? 'http://localhost:3000/api/profile/report?force=true'
                : 'http://localhost:3000/api/profile/report';
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            setProgressPercent(80);

            if (!response.ok) {
                throw new Error(`Failed to generate report: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success && result.report) {
                setProgress('步骤 3/3: 生成卡片报告...');
                setProgressPercent(90);
                
                console.log('📊 [Report] Generated report data:', {
                    from_cache: result.from_cache,
                    card_count: result.report.cards.length,
                    all_cards_count: result.report.all_cards?.length || 0,
                    generated_at: result.report.generated_at,
                    topics: result.report.selected_topics
                });
                
                setReport(result.report);
                // 从所有卡片中随机抽取6张显示
                const randomCards = getRandomCards(result.report, 6);
                setDisplayCards(randomCards);
                setFromCache(result.from_cache || false);
                setProgressPercent(100);
            } else {
                throw new Error('Failed to parse report');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            throw new Error(message);
        }
    };

    // 一键生成报告
    const handleGenerateReport = useCallback(async (forceRefresh: boolean = false) => {
        try {
            setLoading(true);
            setError(null);
            setProgressPercent(0);

            // 1. 获取所有数据
            const data = await fetchAllData();

            // 2. 生成报告（强制刷新）
            await generateReport(data, forceRefresh);
            
            // 完成
            await new Promise(resolve => setTimeout(resolve, 300)); // 短暂延迟显示100%
        } catch (err) {
            console.error('Error generating report:', err);
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            setProgressPercent(0);
        } finally {
            setLoading(false);
            setProgress('');
        }
    }, [getRandomCards]);

    // 加载已有报告（优先从缓存读取，不自动生成）
    useEffect(() => {
        const loadExistingReport = async () => {
            // 获取用户信息
            fetchUserInfo();

            // 获取萌宠配置
            try {
                const configResponse = await fetch(`${API_URL}/api/config`);
                if (configResponse.ok) {
                    const configData = await configResponse.json();
                    const petEnabledValue = configData.ui_config?.config_fields?.find((f: any) => f.key === 'pet_enabled')?.value;
                    const petImageValue = configData.ui_config?.config_fields?.find((f: any) => f.key === 'pet_image_url')?.value;
                    
                    if (petEnabledValue !== undefined) {
                        const enabled = petEnabledValue === 'true' || petEnabledValue === true;
                        setPetEnabled(enabled);
                    }
                    if (petImageValue) {
                        setPetImageUrl(petImageValue);
                        // 设置 CSS 变量
                        if (typeof document !== 'undefined') {
                            document.documentElement.style.setProperty('--pet-image-url', `url('${petImageValue}')`);
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to load pet config:', err);
            }

            try {
                const response = await fetch(`${API_URL}/api/profile/report`);
                if (response.ok) {
                    const result = await response.json();
                    if (result.report && result.report.cards && result.report.cards.length > 0) {
                        console.log('📦 [Load] Existing report loaded:', {
                            from_cache: result.from_cache,
                            card_count: result.report.cards.length,
                            all_cards_count: result.report.all_cards?.length || 0,
                            generated_at: result.report.generated_at,
                            topics: result.report.selected_topics
                        });
                        
                        setReport(result.report);
                        // 从所有卡片中随机抽取6张显示
                        const randomCards = getRandomCards(result.report, 6);
                        setDisplayCards(randomCards);
                        setFromCache(result.from_cache || false);
                        setLoading(false);
                        return;
                    }
                }
                // 没有报告时显示空状态，不自动生成
                setLoading(false);
            } catch (err) {
                console.error('Failed to load existing report:', err);
                setError('加载报告失败');
                setLoading(false);
            }
        };

        loadExistingReport();
    }, [getRandomCards]);

    // 暴露生成函数供外部调用
    useEffect(() => {
        (window as any).generateReport = () => handleGenerateReport(true); // 始终强制刷新
        
        // 清理函数
        return () => {
            delete (window as any).generateReport;
        };
    }, [handleGenerateReport]);

    // 萌宠走动动画 - 使用上传的像素画
    useEffect(() => {
        if (!report || !petEnabled) return;

        const pet = document.getElementById('pet-walker');
        const sprite = pet?.querySelector('.pet-sprite') as HTMLElement;
        const card = document.querySelector('.report-info-card');
        if (!pet || !sprite || !card) return;

        // 预加载图片以获取实际尺寸
        const img = new Image();
        img.src = petImageUrl;
        
        img.onload = () => {
            const naturalWidth = img.naturalWidth;
            const naturalHeight = img.naturalHeight;
            
            // 根据图片实际尺寸动态调整显示大小和位置
            const maxSize = 80; // 最大尺寸限制
            let displayWidth = naturalWidth;
            let displayHeight = naturalHeight;
            
            // 等比缩放到合适大小
            if (naturalWidth > maxSize || naturalHeight > maxSize) {
                const scale = Math.min(maxSize / naturalWidth, maxSize / naturalHeight);
                displayWidth = naturalWidth * scale;
                displayHeight = naturalHeight * scale;
            }
            
            // 设置精灵大小
            sprite.style.width = `${displayWidth}px`;
            sprite.style.height = `${displayHeight}px`;
            pet.style.width = `${displayWidth}px`;
            pet.style.height = `${displayHeight}px`;
            
            // 调整垂直位置，确保底部精准贴在卡片上边缘
            // 使用负的高度值让角色底部正好在卡片顶部
            pet.style.top = `-${displayHeight}px`;
            
            // 启动走路动画
            pet.classList.add('walking');
        };

        let animationId: number;
        let currentPosition = Math.random() * 200; // 随机起始位置 0-200px
        let direction = Math.random() < 0.5 ? 1 : -1; // 随机初始方向
        let isPaused = false;
        let currentSpeed = 0.1 + Math.random() * 0.1; // 减小速度范围 0.1-0.2
        let animationPhase = 0;
        
        const updateMaxPosition = () => {
            const cardWidth = card.getBoundingClientRect().width;
            const petWidth = parseFloat(pet.style.width) || 64;
            return cardWidth - petWidth;
        };
        
        let maxPosition = updateMaxPosition();
        
        // 确保初始位置在有效范围内
        if (currentPosition > maxPosition) {
            currentPosition = maxPosition;
        }
        
        // 设置初始方向的翻转效果
        pet.style.transform = direction === 1 ? 'scaleX(1)' : 'scaleX(-1)';

        const animate = () => {
            if (!isPaused) {
                currentPosition += direction * currentSpeed;
                maxPosition = updateMaxPosition(); // 动态更新最大位置
                
                // 边界检测和转向
                if (currentPosition >= maxPosition) {
                    currentPosition = maxPosition;
                    direction = -1;
                    pet.style.transform = 'scaleX(-1)';
                    // 转向时随机改变速度
                    currentSpeed = 0.1 + Math.random() * 0.1;
                } else if (currentPosition <= 0) {
                    currentPosition = 0;
                    direction = 1;
                    pet.style.transform = 'scaleX(1)';
                    // 转向时随机改变速度
                    currentSpeed = 0.1 + Math.random() * 0.1;
                }

                pet.style.left = `${currentPosition}px`;

                // 随机暂停（降低频率，增加停留时间）
                if (Math.random() < 0.001) {
                    isPaused = true;
                    pet.classList.remove('walking');
                    sprite.style.transform = 'translateY(0)';
                    const pauseDuration = 2000 + Math.random() * 4000; // 2-6秒随机暂停
                    setTimeout(() => {
                        isPaused = false;
                        pet.classList.add('walking');
                        animationPhase = 0;
                        // 恢复时随机改变速度和方向
                        currentSpeed = 0.1 + Math.random() * 0.1;
                        if (Math.random() < 0.3) {
                            direction *= -1;
                            pet.style.transform = direction === 1 ? 'scaleX(1)' : 'scaleX(-1)';
                        }
                    }, pauseDuration);
                }
            }

            animationId = requestAnimationFrame(animate);
        };

        // 点击暂停/继续
        const handleClick = () => {
            isPaused = !isPaused;
        };

        pet.addEventListener('click', handleClick);
        animationId = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animationId);
            pet.removeEventListener('click', handleClick);
        };
    }, [report, petEnabled, petImageUrl]);

    // 为每张卡片生成插画
    // 移除自动生成插图的 useEffect
    // 插图现在需要在配置页面手动生成

    if (!report) {
        return (
            <div className="max-w-7xl mx-auto px-4 py-16">
                <div className="text-center">
                    {error && (
                        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-xl mb-4 max-w-md mx-auto">
                            {error}
                        </div>
                    )}

                    {loading && (
                        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-sm border-t border-gray-200 shadow-lg z-50">
                            <div className="max-w-4xl mx-auto px-6 py-6">
                                <div className="mb-3 text-center">
                                    <p className="text-sm font-medium text-gray-700">{progress}</p>
                                </div>
                                
                                {/* 进度条 - 使用动态颜色 */}
                                <div className="relative w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div 
                                        className="absolute top-0 left-0 h-full transition-all duration-500 ease-out rounded-full progress-bar-fill"
                                        style={{ width: `${progressPercent}%` }}
                                    ></div>
                                </div>
                                
                                <p className="text-xs text-gray-500 text-center mt-2">{progressPercent}% 完成</p>
                            </div>
                        </div>
                    )}

                    {/* 空状态：无报告时的提示 */}
                    {!loading && !error && (
                        <div className="max-w-md mx-auto">
                            <div className="text-6xl mb-6">📊</div>
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">还没有生成报告</h2>
                            <p className="text-gray-600 mb-8">
                                点击导航岛的灯泡图标开始生成您的个性化数据报告
                            </p>
                            <div className="glass rounded-2xl p-6 text-left">
                                <h3 className="font-bold text-gray-800 mb-3">报告将包含：</h3>
                                <ul className="space-y-2 text-sm text-gray-600">
                                    <li className="flex items-start gap-2">
                                        <span className="text-lg">🎯</span>
                                        <span>6个精选话题的深度分析</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-lg">🤖</span>
                                        <span>AI 驱动的个性化洞察</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-lg">📈</span>
                                        <span>跨平台数据整合</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-lg">⏰</span>
                                        <span>报告7天有效，过期后自动刷新</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const getExpiryInfo = () => {
        const expiresAt = new Date(report.expires_at);
        const now = new Date();
        const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysLeft;
    };

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            {/* 报告信息条 */}
            <div className="mb-6 glass rounded-3xl p-5 border shadow-lg report-info-card relative">
                {/* 动态萌宠 - 使用精灵图动画 */}
                {petEnabled && (
                    <div 
                        id="pet-walker"
                        className="pet-walker absolute left-0 cursor-pointer z-10"
                        onClick={(e) => {
                            const pet = e.currentTarget;
                            pet.classList.add('pet-excited');
                            setTimeout(() => pet.classList.remove('pet-excited'), 600);
                        }}
                    >
                        <div className="pet-sprite"></div>
                    </div>
                )}

                <div className="flex items-center justify-between gap-4">
                    {/* 左侧：用户信息 */}
                    <div className="flex items-center gap-4">
                        {userInfo ? (
                            <>
                                {!avatarError ? (
                                    <img
                                        src={userInfo.avatar}
                                        alt={userInfo.name}
                                        className="w-14 h-14 rounded-2xl object-cover shadow-md ring-2 ring-white/50"
                                        crossOrigin="anonymous"
                                        referrerPolicy="no-referrer"
                                        onError={() => setAvatarError(true)}
                                    />
                                ) : (
                                    <img
                                        src={getDefaultAvatar(userInfo.name)}
                                        alt={userInfo.name}
                                        className="w-14 h-14 rounded-2xl object-cover shadow-md ring-2 ring-white/50"
                                    />
                                )}
                                <div>
                                    <h3 className="text-lg font-bold text-gray-800">{userInfo.name}</h3>
                                    <p className="text-xs text-gray-500 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full platform-indicator"></span>
                                        来自 {userInfo.platform}
                                    </p>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-200 to-gray-300 animate-pulse"></div>
                                <div>
                                    <div className="h-5 w-24 bg-gray-200 rounded animate-pulse mb-1"></div>
                                    <div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* 右侧：报告信息 */}
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">✨</span>
                            <div>
                                <p className="text-sm font-semibold text-gray-700">
                                    {fromCache ? '📦 从缓存加载' : '🎉 新鲜生成'}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {getExpiryInfo()}天后更新 · 共{report.all_cards?.length || report.cards.length}个话题 · 显示{displayCards.length}个
                                </p>
                            </div>
                        </div>
                        {((report.all_cards && report.all_cards.length > 6) || report.cards.length > 6) && (
                            <button
                                onClick={() => {
                                    console.log('🔄 [Shuffle] Changing cards...');
                                    const newCards = getRandomCards(report, 6);
                                    setDisplayCards(newCards);
                                }}
                                className="shuffle-btn relative px-5 py-2.5 rounded-2xl text-sm font-medium transition-all duration-300 hover:scale-110 active:scale-105"
                                aria-label="换一批"
                            >
                                🎲 换一批
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* 卡片网格 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {displayCards.map((card, index) => (
                    <article
                        key={card.topic_id}
                        className="glass rounded-3xl p-6 hover:shadow-2xl transition-all duration-300 border report-card"
                    >
                        {/* 插画背景 */}
                        {card.illustration && (
                            <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity duration-300 rounded-3xl overflow-hidden">
                                <img
                                    src={card.illustration}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            </div>
                        )}

                        <div className="relative z-10">
                            {/* Card Header */}
                            <div className="flex items-center justify-between mb-4">
                                <div
                                    className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${card.color} flex items-center justify-center shadow-lg text-2xl`}
                                >
                                    {card.icon}
                                </div>
                                
                                {/* 更多按钮 */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedCard(card);
                                    }}
                                    className="text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-full hover:bg-gray-100"
                                    aria-label="查看详情"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                                    </svg>
                                </button>
                            </div>

                            {/* Card Title */}
                            <h2 className="text-sm text-gray-600 mb-2">
                                {card.title}
                            </h2>

                            {/* Card Summary */}
                            <p className="text-xl font-bold text-gray-900 line-clamp-2 mb-3">
                                {card.content.summary}
                            </p>

                            {/* Tags */}
                            {card.content.tags && card.content.tags.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {card.content.tags.map((tag, i) => (
                                        <span
                                            key={i}
                                            className="px-3 py-1 rounded-full text-xs font-medium text-white tag-badge"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </article>
                ))}
            </div>

            {/* 详情弹窗 */}
            {selectedCard && (
                <div 
                    className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
                    onClick={() => setSelectedCard(null)}
                >
                    <div 
                        className="bg-white/95 backdrop-blur-2xl rounded-3xl max-w-4xl w-full max-h-[85vh] overflow-hidden shadow-2xl border border-white/60 animate-scale-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 滚动内容区 */}
                        <div className="overflow-y-auto max-h-[85vh] custom-scrollbar">
                            <div className="p-10">
                                {/* 头部区域 */}
                                <div className="flex items-start justify-between mb-10">
                                    <div className="flex items-start gap-5">
                                        <div
                                            className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${selectedCard.color} flex items-center justify-center shadow-lg text-3xl flex-shrink-0 transition-transform hover:scale-110`}
                                        >
                                            {selectedCard.icon}
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-gray-900 mb-3">
                                                {selectedCard.title}
                                            </h2>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm text-gray-500">
                                                    {selectedCard.category}
                                                </span>
                                                {selectedCard.content.tags && selectedCard.content.tags.length > 0 && (
                                                    <>
                                                        <span className="text-gray-300">·</span>
                                                        {selectedCard.content.tags.map((tag, i) => (
                                                            <span key={i} className="tag-badge px-2.5 py-1 rounded-full text-xs font-medium text-white transition-transform hover:scale-105">
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setSelectedCard(null)}
                                        className="text-gray-400 hover:text-gray-700 transition-all p-2 rounded-lg hover:bg-gray-100 active:scale-95"
                                        aria-label="关闭"
                                    >
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>

                                {/* 插画展示 */}
                                {selectedCard.illustration && (
                                    <div className="mb-10 rounded-2xl overflow-hidden transition-shadow hover:shadow-xl">
                                        <img
                                            src={selectedCard.illustration}
                                            alt={selectedCard.title}
                                            className="w-full h-80 object-cover"
                                            loading="lazy"
                                        />
                                    </div>
                                )}

                                {/* 摘要 */}
                                <div className="mb-8">
                                    <p className="text-lg text-gray-800 leading-relaxed font-medium">
                                        {selectedCard.content.summary}
                                    </p>
                                </div>

                                {/* 详细内容 */}
                                {selectedCard.content.details && selectedCard.content.details.length > 0 && (
                                    <div className="mb-8">
                                        <div className="space-y-4">
                                            {selectedCard.content.details.map((detail, i) => (
                                                <div key={i} className="flex items-start gap-4 transition-transform hover:translate-x-1">
                                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                                                        {i + 1}
                                                    </span>
                                                    <p className="flex-1 text-base text-gray-700 leading-relaxed">
                                                        {detail}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* AI 洞察 */}
                                {selectedCard.content.highlight && (
                                    <div className="pt-6 border-t border-gray-200">
                                        <div className="flex items-center gap-2 mb-4">
                                            <span className="text-2xl animate-pulse-slow">💡</span>
                                            <h3 className="text-base font-bold text-gray-900">AI 洞察</h3>
                                        </div>
                                        <div className="pl-4 border-l-4 transition-all hover:pl-5 ai-insight-border">
                                            <p className="text-base text-gray-700 leading-relaxed italic">
                                                {selectedCard.content.highlight}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 提示信息 */}
            <div className="mt-8 text-center text-sm text-gray-500">
                <p>报告每7天自动更新一次，每次随机选择6个话题进行分析</p>
                <p className="mt-1">点击导航岛的灯泡图标可立即重新生成</p>
            </div>
        </div>
    );
}
