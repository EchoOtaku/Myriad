import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { API_URL } from '../config';
import PlatformIcon from './PlatformIcon';
import Loader from './Loader';
import { QuickTransition } from './SkeletonTransition';
import { usePagedLoad } from '../hooks/useVirtualScroll';
import { useNotification } from '../contexts/NotificationContext';

// 添加样式到页面
if (typeof document !== 'undefined' && !document.getElementById('library-grid-styles')) {
    const style = document.createElement('style');
    style.id = 'library-grid-styles';
    style.textContent = `
        /* 标签栏容器样式 */
        .tab-container-border {
            border-color: rgba(255, 255, 255, 0.3);
        }

        html.dark .tab-container-border {
            border-color: rgba(75, 85, 99, 0.4);
        }

        /* 标签按钮样式 - 与 config 页面统一 */
        .tab-button {
            position: relative;
            color: rgba(0, 0, 0, 0.65);
            background: transparent;
            border: none;
            font-weight: 600;
            cursor: pointer;
            overflow: hidden;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                        transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
        }

        html.dark .tab-button {
            color: rgba(255, 255, 255, 0.65);
        }

        /* 非激活状态悬浮 */
        .tab-button:not(.active):hover {
            color: rgba(0, 0, 0, 0.85);
            background: rgba(0, 0, 0, 0.05);
        }

        html.dark .tab-button:not(.active):hover {
            color: rgba(255, 255, 255, 0.9);
            background: rgba(255, 255, 255, 0.08);
        }

        /* 激活状态 */
        .tab-button.active {
            color: white;
            background: var(--color-primary);
            box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 35%, transparent),
                        0 4px 16px color-mix(in srgb, var(--color-primary) 25%, transparent),
                        inset 0 1px 0 0 rgba(255, 255, 255, 0.2);
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
                        transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* 深色模式激活状态增强 */
        html.dark .tab-button.active {
            box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 45%, transparent),
                        0 4px 20px color-mix(in srgb, var(--color-primary) 35%, transparent),
                        inset 0 1px 0 0 rgba(255, 255, 255, 0.15),
                        0 0 0 1px color-mix(in srgb, var(--color-primary) 60%, transparent);
        }

        /* 激活状态悬浮 */
        .tab-button.active:hover {
            background: color-mix(in srgb, var(--color-primary) 95%, white);
            box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 45%, transparent),
                        0 6px 24px color-mix(in srgb, var(--color-primary) 30%, transparent),
                        inset 0 1px 0 0 rgba(255, 255, 255, 0.25);
        }

        html.dark .tab-button.active:hover {
            background: color-mix(in srgb, var(--color-primary) 90%, white);
            box-shadow: 0 4px 14px color-mix(in srgb, var(--color-primary) 55%, transparent),
                        0 6px 28px color-mix(in srgb, var(--color-primary) 40%, transparent),
                        inset 0 1px 0 0 rgba(255, 255, 255, 0.2),
                        0 0 0 1px color-mix(in srgb, var(--color-primary) 70%, transparent);
        }

        /* 逐行显示动画 */
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .library-card-container {
            animation: fadeInUp 0.5s ease-out backwards;
        }

        /* 移动端触摸反馈 */
        @media (max-width: 640px) {
            .tab-button:not(.active):active {
                background: rgba(0, 0, 0, 0.08);
                transform: scale(0.98);
            }

            html.dark .tab-button:not(.active):active {
                background: rgba(255, 255, 255, 0.12);
            }

            .tab-button.active:active {
                transform: scale(0.98);
            }
        }
        
        .animate-fade-in {
            animation: fadeIn 0.5s ease-out forwards;
        }
        
        @keyframes fadeIn {
            from {
                opacity: 0;
            }
            to {
                opacity: 1;
            }
        }
        
        /* 卡片容器样式 */
        .library-card-container {
            transition: left 0.4s ease-out, top 0.4s ease-out, width 0.4s ease-out, height 0.4s ease-out;
        }
        
        /* 平台图标背景 */
        .platform-icon-bg {
            width: 2.5rem;
            height: 2.5rem;
            border-radius: 9999px;
            backdrop-filter: blur(12px);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            transition: all 0.3s;
            background-color: color-mix(in srgb, var(--platform-color, #6b7280) 8%, transparent);
        }
        
        .platform-icon-bg svg,
        .platform-icon-bg img {
            color: var(--platform-color, #6b7280);
        }
        
        /* 加载按钮样式 */
        .load-more-btn {
            padding: 0.625rem 1.5rem;
            border-radius: 0.5rem;
            transition: all 0.2s;
            font-size: 0.875rem;
            font-weight: 500;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }
        
        .load-more-btn:hover {
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        
        /* 加载spinner */
        .loading-spinner {
            animation: spin 1s linear infinite;
            border-radius: 9999px;
            height: 1.25rem;
            width: 1.25rem;
            border-width: 2px;
            border-style: solid;
            border-color: transparent;
        }
        
        .loading-spinner.primary-spinner {
            border-top-color: var(--color-primary, #3b82f6);
            border-right-color: var(--color-primary, #3b82f6);
        }
        
        /* 加载按钮主题色 */
        .load-more-btn.primary-load-btn {
            background-color: color-mix(in srgb, var(--color-primary, #3b82f6) 10%, transparent);
            color: var(--color-primary, #3b82f6);
            border: 1px solid color-mix(in srgb, var(--color-primary, #3b82f6) 20%, transparent);
        }
        
        .load-more-btn.primary-load-btn:hover {
            background-color: color-mix(in srgb, var(--color-primary, #3b82f6) 15%, transparent);
        }
        
        @keyframes spin {
            from {
                transform: rotate(0deg);
            }
            to {
                transform: rotate(360deg);
            }
        }
    `;
    document.head.appendChild(style);
}

interface LibraryItem {
    id: string;
    item_type: 'game' | 'video' | 'music';
    title: string;
    cover: string | null;
    platform: string;
    metadata: any;
}

interface LibraryResponse {
    success: boolean;
    items: LibraryItem[];
    total: number;
}

interface CardLayout {
    left: number;
    top: number;
    width: number;
    height: number;
}

export default function LibraryGrid() {
    const [allItems, setAllItems] = useState<LibraryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'game' | 'video' | 'music'>('all');
    const [prevFilter, setPrevFilter] = useState<'all' | 'game' | 'video' | 'music'>('all');
    const [isTransitioning, setIsTransitioning] = useState(false); // 子分组切换动画状态
    const [layouts, setLayouts] = useState<Map<string, CardLayout>>(new Map());
    const containerRef = useRef<HTMLDivElement>(null);
    const { showInfo } = useNotification();
    
    // 筛选后的所有项目
    const filteredAllItems = filter === 'all' 
        ? allItems 
        : allItems.filter(item => item.item_type === filter);
    
    // 使用分页加载 Hook - 初始加载40个，每次加载20个
    const { items, loadMore, hasMore, loading: loadingMore } = usePagedLoad(
        filteredAllItems,
        { pageSize: 20, initialPages: 2, threshold: 800 }
    );

    useEffect(() => {
        fetchLibraryData();
    }, []);

    // 合并：当 filter 或 items 变化时，重新计算布局
    useEffect(() => {
        if (items.length > 0) {
            // 筛选切换时立即计算，避免位置跳变
            if (isTransitioning) {
                calculateLayouts();
            } else {
                // 其他情况添加短暂防抖
                const timeoutId = setTimeout(() => {
                    calculateLayouts();
                }, 30);
                return () => clearTimeout(timeoutId);
            }
        }
    }, [filter, items, isTransitioning]);
    
    useEffect(() => {
        let resizeTimeout: NodeJS.Timeout;
        const handleResize = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (items.length > 0) {
                    calculateLayouts();
                }
            }, 150);
        };
        
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(resizeTimeout);
        };
    }, [items]);

    const fetchLibraryData = async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_URL}/api/library`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch library data');
            }

            const data: LibraryResponse = await response.json();
            
            if (data.success) {
                // 随机打乱数据
                const shuffled = [...data.items].sort(() => Math.random() - 0.5);
                setAllItems(shuffled);
                setLoading(false);
            } else {
                throw new Error('No library data available');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            setLoading(false);
        }
    };

    // 显示错误通知
    useEffect(() => {
        if (error) {
            showInfo('资料库为空，请先在配置页面获取平台数据');
        }
    }, [error, showInfo]);

    // 显示空状态通知
    useEffect(() => {
        if (!loading && filteredAllItems.length === 0 && !error) {
            showInfo('此分类暂无内容，试试切换其他分类');
        }
    }, [loading, filteredAllItems.length, error, showInfo]);

    // filteredItems 现在由 usePagedLoad 提供的 items 代替

    // 获取卡片尺寸配置 - 统一高度
    const getCardSize = (type: string, containerWidth: number) => {
        const gap = 16;
        let columns = 5;
        
        // 响应式列数
        if (containerWidth < 640) columns = 2;
        else if (containerWidth < 768) columns = 3;
        else if (containerWidth < 1024) columns = 4;
        else if (containerWidth < 1536) columns = 5;
        else columns = 6;
        
        const baseWidth = (containerWidth - gap * (columns + 1)) / columns;
        // 统一高度 = 1个基础列宽度
        const uniformHeight = baseWidth;
        
        switch (type) {
            case 'video':
                // 视频：占2列宽度，统一高度
                const videoWidth = baseWidth * 2 + gap;
                return { 
                    width: videoWidth, 
                    height: uniformHeight,
                    span: 2 
                }; 
            case 'game':
                // 游戏：占2列宽度，统一高度
                const gameWidth = baseWidth * 2 + gap;
                return { 
                    width: gameWidth, 
                    height: uniformHeight,
                    span: 2
                }; 
            case 'music':
                // 音乐：占1列宽度，统一高度（正方形）
                return { 
                    width: baseWidth, 
                    height: uniformHeight,
                    span: 1
                }; 
            default:
                return { 
                    width: baseWidth, 
                    height: uniformHeight,
                    span: 1
                };
        }
    };

    // 智能瀑布流布局算法 - 考虑卡片跨度 + 逐行动画
    const calculateLayouts = () => {
        if (!containerRef.current) return;

        const containerWidth = containerRef.current.offsetWidth;
        const gap = 16;
        let columns = 5;
        
        // 响应式列数
        if (containerWidth < 640) columns = 2;
        else if (containerWidth < 768) columns = 3;
        else if (containerWidth < 1024) columns = 4;
        else if (containerWidth < 1536) columns = 5;
        else columns = 6;

        const columnHeights = new Array(columns).fill(gap);
        const newLayouts = new Map<string, CardLayout>();
        const baseWidth = (containerWidth - gap * (columns + 1)) / columns;

        // 检查是否只有大卡片（游戏/视频）
        const hasOnlyLargeCards = items.every(item => 
            item.item_type === 'game' || item.item_type === 'video'
        );
        
        // 如果只有大卡片且列数为奇数，计算居中偏移
        let centerOffset = 0;
        if (hasOnlyLargeCards && columns % 2 === 1) {
            // 大卡片占2列，在奇数列布局中会有1列空白，让整体居中
            centerOffset = (baseWidth + gap) / 2;
        }

        // 计算每行的起始高度，用于逐行动画
        const rowTops: number[] = [];
        let currentRowTop = gap;

        items.forEach((item) => {
            const size = getCardSize(item.item_type, containerWidth);
            const span = size.span || 1;
            
            // 找到可以放置此卡片的最佳位置 (考虑跨列)
            let bestColumn = 0;
            let minHeight = Infinity;
            
            for (let col = 0; col <= columns - span; col++) {
                // 计算此位置的最大高度(跨越的所有列)
                const maxHeight = Math.max(...columnHeights.slice(col, col + span));
                if (maxHeight < minHeight) {
                    minHeight = maxHeight;
                    bestColumn = col;
                }
            }
            
            const left = gap + bestColumn * (baseWidth + gap) + centerOffset;
            const top = minHeight;
            
            // 检测是否开始新行（top值大幅增加）
            if (rowTops.length === 0 || Math.abs(top - currentRowTop) > 50) {
                currentRowTop = top;
                rowTops.push(top);
            }
            
            newLayouts.set(item.id, {
                left,
                top,
                width: size.width,
                height: size.height
            });
            
            // 更新所有跨越的列的高度
            for (let col = bestColumn; col < bestColumn + span; col++) {
                columnHeights[col] = top + size.height + gap;
            }
        });

        setLayouts(newLayouts);
    };

    // 获取平台品牌色
    // 🚀 性能优化：使用 useCallback 缓存函数，避免每次渲染重新创建
    const getPlatformColor = useCallback((platform: string) => {
        switch (platform.toLowerCase()) {
            case 'bilibili':
                return '#00A1D6';
            case 'steam':
                return '#171a21';
            case 'netease music':
            case 'netease':
                return '#d33a31';
            case 'github':
                return '#24292e';
            case 'twitter':
            case 'x':
                return '#000000';
            default:
                return '#6b7280';
        }
    }, []);

    // 获取类型图标
    const getTypeIcon = useCallback((type: string) => {
        switch (type) {
            case 'game':
                return '🎮';
            case 'video':
                return '🎬';
            case 'music':
                return '🎵';
            default:
                return '📦';
        }
    }, []);

    // 获取额外信息
    const getExtraInfo = useCallback((item: LibraryItem) => {
        if (item.item_type === 'game' && item.metadata.playtime_forever) {
            const hours = Math.round(item.metadata.playtime_forever / 60);
            return `游玩 ${hours} 小时`;
        }
        if (item.item_type === 'music' && item.metadata.ar) {
            const artists = item.metadata.ar.map((a: any) => a.name).join(', ');
            return artists;
        }
        if (item.item_type === 'video' && item.metadata.progress) {
            return item.metadata.progress;
        }
        return null;
    }, []);

    // 判断是否为子分组之间的切换（游戏↔视频、游戏↔音乐、视频↔音乐）
    const needsTransition = (from: string, to: string) => {
        return from !== 'all' && to !== 'all' && from !== to;
    };

    // 处理筛选器切换
    const handleFilterChange = (newFilter: 'all' | 'game' | 'video' | 'music') => {
        if (newFilter === filter) return;
        
        setPrevFilter(filter);
        
        // 如果是子分组之间的切换，添加过渡动画
        if (needsTransition(filter, newFilter)) {
            setIsTransitioning(true);
            setTimeout(() => {
                setFilter(newFilter);
                setTimeout(() => setIsTransitioning(false), 150);
            }, 200);
        } else {
            // 全部 ↔ 子分组，直接切换
            setFilter(newFilter);
        }
    };

    // 🚀 性能优化：使用 useMemo 缓存容器高度计算
    const containerHeight = useMemo(() => {
        const heights = Array.from(layouts.values()).map(l => l.top + l.height);
        return Math.max(...heights, 500) + 20;
    }, [layouts]);

    // 初次加载时显示简洁的加载指示
    if (loading && allItems.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-[600px]">
                <Loader size="large" />
            </div>
        );
    }

    // 内容过渡动画
    return (
        <div 
            className="animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out"
        >
            {error ? (
                <div className="flex items-center justify-center min-h-[400px]">
                    {/* 错误提示已移至角落通知 */}
                </div>
            ) : (
        <div className="space-y-8">
            {/* 筛选器 - 紧凑设计 */}
            <div className="flex justify-center mb-4 md:mb-6">
                <div className="glass rounded-xl p-1.5 inline-flex gap-1.5 w-full sm:w-auto shadow-md border tab-container-border">
                    <button
                        onClick={() => handleFilterChange('all')}
                        className={`tab-button flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-lg font-medium text-sm transition-all duration-300 min-h-[40px] ${
                            filter === 'all' ? 'active' : ''
                        }`}
                    >
                        <span className="flex items-center justify-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                            </svg>
                            <span>全部</span>
                        </span>
                    </button>
                    <button
                        onClick={() => handleFilterChange('game')}
                        className={`tab-button flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-lg font-medium text-sm transition-all duration-300 min-h-[40px] ${
                            filter === 'game' ? 'active' : ''
                        }`}
                    >
                        <span className="flex items-center justify-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                            </svg>
                            <span>游戏</span>
                        </span>
                    </button>
                    <button
                        onClick={() => handleFilterChange('video')}
                        className={`tab-button flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-lg font-medium text-sm transition-all duration-300 min-h-[40px] ${
                            filter === 'video' ? 'active' : ''
                        }`}
                    >
                        <span className="flex items-center justify-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                            </svg>
                            <span>视频</span>
                        </span>
                    </button>
                    <button
                        onClick={() => handleFilterChange('music')}
                        className={`tab-button flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-lg font-medium text-sm transition-all duration-300 min-h-[40px] ${
                            filter === 'music' ? 'active' : ''
                        }`}
                    >
                        <span className="flex items-center justify-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                            </svg>
                            <span>音乐</span>
                        </span>
                    </button>
                </div>
            </div>

            {/* 瀑布流容器 - 使用快速过渡 */}
            <QuickTransition transitioning={isTransitioning}>
                {/* Dynamic height required for waterfall layout */}
                <div 
                    ref={containerRef}
                    className="relative w-full"
                    style={{ 
                        height: `${containerHeight}px`, 
                        minHeight: '400px',
                        transition: 'height 0.4s ease-out'
                    }}
                >
                    {items.map((item, index) => {
                        const layout = layouts.get(item.id);
                        if (!layout) return null;

                        const platformColor = getPlatformColor(item.platform);
                        
                        // 计算卡片所在行（基于 top 值分组）
                        const rowIndex = Math.floor(layout.top / 300); // 每300px算一行
                        const animationDelay = rowIndex * 0.08; // 每行延迟80ms
                        
                        {/* Dynamic positioning required for waterfall layout */}
                        return (
                            <div
                                key={item.id}
                                className="absolute group library-card-container"
                                style={{
                                    left: `${layout.left}px`,
                                    top: `${layout.top}px`,
                                    width: `${layout.width}px`,
                                    height: `${layout.height}px`,
                                    '--platform-color': platformColor,
                                    animationDelay: `${animationDelay}s`
                                } as React.CSSProperties}
                            >
                            {item.item_type === 'music' ? (
                                // 音乐卡片：正方形专辑封面
                                <div className="relative bg-white rounded-xl shadow-md hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 hover:scale-[1.02] overflow-hidden h-full">
                                    <div className="block w-full h-full relative">
                                        {item.cover ? (
                                            <img
                                                src={item.cover}
                                                alt={item.title}
                                                className="w-full h-full object-cover transition-all duration-500 group-hover:scale-110"
                                                loading="eager"
                                                decoding="async"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.title)}&size=400&background=random`;
                                                }}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-400 to-pink-500">
                                                <span className="text-6xl">{getTypeIcon(item.item_type)}</span>
                                            </div>
                                        )}
                                        
                                        {/* 悬停显示信息 - 音乐卡片 */}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-3">
                                            <h3 className="font-bold text-white text-xs leading-tight line-clamp-2 mb-1">
                                                {item.title}
                                            </h3>
                                            {getExtraInfo(item) && (
                                                <p className="text-[10px] text-white/75 line-clamp-1">
                                                    {getExtraInfo(item)}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* 右上角平台图标（音乐） */}
                                    <div className="absolute top-3 right-3 group/platform">
                                        <div className="platform-icon-bg">
                                            <PlatformIcon platform={item.platform} className="w-5 h-5" />
                                        </div>
                                        {/* hover显示平台名称 */}
                                        <div className="absolute top-full right-0 mt-2 bg-black/90 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-md opacity-0 group-hover/platform:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                                            {item.platform}
                                        </div>
                                    </div>
                                </div>
                            ) : item.item_type === 'video' ? (
                                // 视频卡片：横向宽屏，16:9比例
                                <div className="relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 overflow-hidden h-full">
                                    <a 
                                        href={item.metadata.url || '#'} 
                                        target={item.metadata.url ? "_blank" : undefined}
                                        rel={item.metadata.url ? "noopener noreferrer" : undefined}
                                        className="block w-full h-full relative"
                                    >
                                        {item.cover ? (
                                            <img
                                                src={item.cover}
                                                alt={item.title}
                                                className="w-full h-full object-cover transition-all duration-500 group-hover:scale-110"
                                                loading="eager"
                                                decoding="async"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.title)}&size=400&background=random`;
                                                }}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-blue-500">
                                                <span className="text-6xl">{getTypeIcon(item.item_type)}</span>
                                            </div>
                                        )}
                                        
                                        {/* 底部标题标签 - 视频 */}
                                        <div className="absolute bottom-3 left-3 right-3">
                                            <div className="inline-flex items-start max-w-full">
                                                <div className="bg-white/95 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg">
                                                    <h3 className="font-bold text-gray-900 text-sm line-clamp-2 leading-snug">
                                                        {item.title}
                                                    </h3>
                                                    {getExtraInfo(item) && (
                                                        <p className="text-xs text-gray-600 mt-1">
                                                            {getExtraInfo(item)}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </a>
                                    
                                    {/* 右上角平台图标（视频） */}
                                    <div className="absolute top-3 right-3 group/platform">
                                        <div className="platform-icon-bg">
                                            <PlatformIcon platform={item.platform} className="w-5 h-5" />
                                        </div>
                                        {/* hover显示平台名称 */}
                                        <div className="absolute top-full right-0 mt-2 bg-black/90 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-md opacity-0 group-hover/platform:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                                            {item.platform}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                // 游戏卡片：横向宽卡片，Steam封面比例
                                <div className="bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 overflow-hidden h-full">
                                    {/* 封面区域 - 游戏 */}
                                    <div className="relative overflow-hidden h-full bg-gradient-to-br from-gray-900 to-gray-800">
                                        <a 
                                            href={item.platform.toLowerCase() === 'steam' && item.metadata.appid 
                                                ? `https://store.steampowered.com/app/${item.metadata.appid}` 
                                                : (item.metadata.url || '#')}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block w-full h-full relative"
                                        >
                                            {item.cover ? (
                                                <img
                                                    src={item.cover}
                                                    alt={item.title}
                                                    className="w-full h-full object-cover transition-all duration-500 group-hover:scale-110"
                                                    loading="eager"
                                                    decoding="async"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.title)}&size=400&background=random`;
                                                    }}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-400 to-pink-500">
                                                    <span className="text-6xl">{getTypeIcon(item.item_type)}</span>
                                                </div>
                                            )}
                                        </a>
                                        
                                        {/* 渐变遮罩 + 游戏信息 */}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 pointer-events-none">
                                            <h3 className="font-bold text-white text-base line-clamp-2 leading-snug mb-1">
                                                {item.title}
                                            </h3>
                                            {getExtraInfo(item) && (
                                                <p className="text-sm text-white/80">
                                                    {getExtraInfo(item)}
                                                </p>
                                            )}
                                        </div>
                                        
                                        {/* 平台图标 */}
                                        <div className="absolute top-3 right-3 group/platform z-10">
                                            <div className="platform-icon-bg">
                                                <PlatformIcon platform={item.platform} className="w-5 h-5" />
                                            </div>
                                            {/* hover显示平台名称 */}
                                            <div className="absolute top-full right-0 mt-2 bg-black/90 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-md opacity-0 group-hover/platform:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                                                {item.platform}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
                </div>
            </QuickTransition>

            {/* 加载更多指示器 */}
            {hasMore && (
                <div className="flex justify-center mt-8 mb-4">
                    {loadingMore ? (
                        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                            <div className="loading-spinner primary-spinner"></div>
                            <span className="text-sm">加载更多...</span>
                        </div>
                    ) : (
                        <button
                            onClick={loadMore}
                            className="load-more-btn primary-load-btn"
                        >
                            加载更多 ({filteredAllItems.length - items.length} 项待加载)
                        </button>
                    )}
                </div>
            )}

            {/* 空状态提示已移至角落通知 */}
        </div>
            )}
        </div>
    );
}
