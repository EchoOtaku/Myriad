import React, { useState, useEffect } from 'react';

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
                            <div className="w-16 h-16 border-4 border-green-400 border-t-transparent rounded-full animate-spin"></div>
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
            <div className="mb-6 flex items-center justify-between bg-white/50 backdrop-blur-sm rounded-2xl p-4 border border-green-200/50">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">✨</span>
                    <div>
                        <p className="text-sm font-semibold text-gray-700">
                            {fromCache ? '📦 从缓存加载' : '🎉 新鲜生成'}
                        </p>
                        <p className="text-xs text-gray-500">
                            {getExpiryInfo()}天后自动更新 · {report.cards.length}个话题
                        </p>
                    </div>
                </div>
                <div className="text-xs text-gray-400">
                    {new Date(report.generated_at).toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                    })}
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
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
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
                                    <span className="text-green-500 mt-1">•</span>
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
