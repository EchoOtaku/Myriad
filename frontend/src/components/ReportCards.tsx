import { useState, useEffect } from 'react';

interface UserInfo {
    name: string;
    avatar: string;
    platform: string;
}

interface CardContent {
    summary: string;
    details: string[];
    highlight?: string;
}

interface ReportCard {
    topic_id: number;
    title: string;
    category: string;
    icon: string;
    color: string;
    content: CardContent;
}

interface PersonalReport {
    cards: ReportCard[];
    generated_at: string;
    expires_at: string;
    selected_topics: number[];
}

export default function ReportCards() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<PersonalReport | null>(null);
    const [progress, setProgress] = useState<string>('');
    const [fromCache, setFromCache] = useState(false);
    const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
    const [avatarError, setAvatarError] = useState(false);

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
            setProgress('正在获取平台数据...');

            const response = await fetch('http://localhost:3000/api/profile/fetch-all', {
                method: 'POST',
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch data: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success && result.data) {
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
    const generateReport = async (data: any) => {
        try {
            setProgress('正在生成AI报告...');
            const response = await fetch('http://localhost:3000/api/profile/report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                throw new Error(`Failed to generate report: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success && result.report) {
                setReport(result.report);
                setFromCache(result.from_cache || false);
            } else {
                throw new Error('Failed to parse report');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            throw new Error(message);
        }
    };

    // 一键生成报告
    const handleGenerateReport = async () => {
        try {
            setLoading(true);
            setError(null);

            // 1. 获取所有数据
            const data = await fetchAllData();

            // 2. 生成报告
            await generateReport(data);
        } catch (err) {
            console.error('Error generating report:', err);
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
        } finally {
            setLoading(false);
            setProgress('');
        }
    };

    // 加载已有报告或自动生成
    useEffect(() => {
        const loadExistingReport = async () => {
            // 获取用户信息
            fetchUserInfo();

            try {
                const response = await fetch('http://localhost:3000/api/profile/report');
                if (response.ok) {
                    const result = await response.json();
                    if (result.report && result.report.cards && result.report.cards.length > 0) {
                        setReport(result.report);
                        setFromCache(result.from_cache || false);
                        return;
                    }
                }
                // 如果没有报告，自动触发生成
                await handleGenerateReport();
            } catch (err) {
                console.error('Failed to load existing report:', err);
                // 加载失败也尝试自动生成
                await handleGenerateReport();
            }
        };

        loadExistingReport();
    }, []);

    // 暴露生成函数供外部调用
    useEffect(() => {
        (window as any).generateReport = handleGenerateReport;
    }, []);

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
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, var(--color-primary) 40%, transparent)', borderTopColor: 'transparent' }}></div>
                            <p className="text-lg text-gray-700 font-semibold">{progress}</p>
                            <p className="text-sm text-gray-500">这可能需要30-60秒，请稍候...</p>
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
            <div className="mb-6 glass rounded-3xl p-5 border shadow-lg" style={{ borderColor: 'color-mix(in srgb, var(--color-primary) 30%, transparent)' }}>
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
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }}></span>
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
                                    {getExpiryInfo()}天后更新 · {report.cards.length}个话题
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-gray-400">
                                {new Date(report.generated_at).toLocaleDateString('zh-CN', {
                                    month: 'short',
                                    day: 'numeric',
                                })}
                            </p>
                            <p className="text-xs text-gray-400">
                                {new Date(report.generated_at).toLocaleTimeString('zh-CN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* 卡片网格 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {report.cards.map((card, index) => (
                    <article
                        key={card.topic_id}
                        className="glass rounded-3xl p-6 hover:scale-105 transition-all duration-300 hover:shadow-2xl"
                        style={{
                            animationDelay: `${index * 0.1}s`,
                        }}
                    >
                        {/* Card Header */}
                        <div className="flex items-center gap-3 mb-4">
                            <div
                                className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${card.color} flex items-center justify-center shadow-lg text-2xl`}
                            >
                                {card.icon}
                            </div>
                            <div>
                                <span className="text-xs text-gray-500 font-medium">{card.category}</span>
                            </div>
                        </div>

                        {/* Card Title */}
                        <h2 className="text-xl font-bold text-gray-900 mb-3">
                            {card.title}
                        </h2>

                        {/* Card Summary */}
                        <p className="text-base font-semibold text-gray-800 mb-3">
                            {card.content.summary}
                        </p>

                        {/* Card Details */}
                        <div className="space-y-2 mb-3">
                            {card.content.details.map((detail, i) => (
                                <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
                                    <span className="mt-1" style={{ color: 'var(--color-primary)' }}>•</span>
                                    <span>{detail}</span>
                                </div>
                            ))}
                        </div>

                        {/* Card Highlight */}
                        {card.content.highlight && (
                            <div className="bg-gradient-to-r from-yellow-100/50 to-amber-100/50 p-3 rounded-xl border border-yellow-200/50">
                                <p className="text-xs font-semibold text-amber-800 mb-1">💡 洞察</p>
                                <p className="text-sm text-gray-700 italic">{card.content.highlight}</p>
                            </div>
                        )}
                    </article>
                ))}
            </div>

            {/* 提示信息 */}
            <div className="mt-8 text-center text-sm text-gray-500">
                <p>报告每7天自动更新一次，每次随机选择6个话题进行分析</p>
                <p className="mt-1">点击导航岛的灯泡图标可立即重新生成</p>
            </div>
        </div>
    );
}
