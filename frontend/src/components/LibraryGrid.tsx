import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { API_URL } from '../config';
import PlatformIcon from './PlatformIcon';
import LibraryGridSkeleton from './LibraryGridSkeleton';
import LoadingToast from './LoadingToast';

// 添加样式到页面
if (typeof document !== 'undefined' && !document.getElementById('library-grid-styles')) {
    const style = document.createElement('style');
    style.id = 'library-grid-styles';
    style.textContent = `
        .tab-button {
            color: rgba(0, 0, 0, 0.6);
            background: rgba(255, 255, 255, 0.3);
            backdrop-filter: blur(10px);
            border: 2px solid transparent;
            transform: translateY(0);
            cursor: pointer;
            position: relative;
            z-index: 1;
        }
        
        .tab-button:hover {
            color: rgba(0, 0, 0, 0.8);
            background: rgba(255, 255, 255, 0.4);
            border-color: var(--color-primary, #94a3b8);
            transform: translateY(-1px);
        }
        
        .tab-button:active {
            transform: translateY(0);
        }
        
        .tab-button.active {
            color: white;
            background: var(--color-primary, #94a3b8);
            border-color: var(--color-primary, #94a3b8);
            box-shadow: 0 4px 20px rgba(148, 163, 184, 0.5);
        }
        
        .tab-button.active:hover {
            transform: translateY(-1px);
        }
        
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
    const [items, setItems] = useState<LibraryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [contentReady, setContentReady] = useState(false); // 内容是否准备好显示
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'game' | 'video' | 'music'>('all');
    const [prevFilter, setPrevFilter] = useState<'all' | 'game' | 'video' | 'music'>('all');
    const [isTransitioning, setIsTransitioning] = useState(false); // 子分组切换动画状态
    const [layouts, setLayouts] = useState<Map<string, CardLayout>>(new Map());
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchLibraryData();
    }, []);

    // 当有数据时，确保内容可以显示
    useEffect(() => {
        if (items.length > 0 && !loading) {
            setContentReady(true);
        }
    }, [items, loading]);

    // 合并：当 filter 或 items 变化时，重新计算布局
    useEffect(() => {
        if (filteredItems.length > 0) {
            calculateLayouts();
        }

        const handleResize = () => {
            if (filteredItems.length > 0) {
                calculateLayouts();
            }
        };
        
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [filter, items]);

    const fetchLibraryData = async () => {
        try {
            setLoading(true);
            setContentReady(false);
            const response = await fetch(`${API_URL}/api/library`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch library data');
            }

            const data: LibraryResponse = await response.json();
            
            if (data.success) {
                // 随机打乱数据
                const shuffled = [...data.items].sort(() => Math.random() - 0.5);
                setItems(shuffled);
                setLoading(false);
                // 短暂延迟后显示内容，确保淡入效果
                setTimeout(() => setContentReady(true), 100);
            } else {
                throw new Error('No library data available');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            setLoading(false);
        }
    };

    const filteredItems = filter === 'all' 
        ? items 
        : items.filter(item => item.item_type === filter);

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

    // 智能瀑布流布局算法 - 考虑卡片跨度
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
        const hasOnlyLargeCards = filteredItems.every(item => 
            item.item_type === 'game' || item.item_type === 'video'
        );
        
        // 如果只有大卡片且列数为奇数，计算居中偏移
        let centerOffset = 0;
        if (hasOnlyLargeCards && columns % 2 === 1) {
            // 大卡片占2列，在奇数列布局中会有1列空白，让整体居中
            centerOffset = (baseWidth + gap) / 2;
        }

        filteredItems.forEach((item) => {
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
        
        // 如果是子分组之间的切换，添加过渡动画
        if (needsTransition(filter, newFilter)) {
            setIsTransitioning(true);
            // 等待退出动画（缩短到200ms）
            setTimeout(() => {
                setPrevFilter(filter);
                setFilter(newFilter);
                // 等待进入动画
                setTimeout(() => {
                    setIsTransitioning(false);
                }, 50);
            }, 200);
        } else {
            // 全部 ↔ 子分组，直接切换不需要动画
            setPrevFilter(filter);
            setFilter(newFilter);
        }
    };

    // 🚀 性能优化：使用 useMemo 缓存容器高度计算
    const containerHeight = useMemo(() => {
        const heights = Array.from(layouts.values()).map(l => l.top + l.height);
        return Math.max(...heights, 500) + 20;
    }, [layouts]);

    // 显示骨架屏：正在加载
    if (loading) {
        return (
            <>
                <LibraryGridSkeleton />
                <LoadingToast message="正在整理资料库..." show={true} />
            </>
        );
    }

    if (error) {
        return (
            <>
                <LibraryGridSkeleton />
                <LoadingToast 
                    message="资料库为空，请先在配置页面获取平台数据" 
                    show={true} 
                />
            </>
        );
    }

    return (
        <div className={`space-y-8 transition-all duration-700 ease-out ${
            contentReady ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
            {/* 筛选器 */}
            <div className="flex justify-center mb-6">
                <div className="glass rounded-xl p-1.5 inline-flex gap-1.5">
                    <button
                        onClick={() => handleFilterChange('all')}
                        className={`tab-button px-6 py-2.5 rounded-lg font-semibold text-sm transition-all duration-300 ${
                            filter === 'all' ? 'active' : ''
                        }`}
                    >
                        全部
                    </button>
                    <button
                        onClick={() => handleFilterChange('game')}
                        className={`tab-button px-6 py-2.5 rounded-lg font-semibold text-sm transition-all duration-300 ${
                            filter === 'game' ? 'active' : ''
                        }`}
                    >
                        🎮 游戏
                    </button>
                    <button
                        onClick={() => handleFilterChange('video')}
                        className={`tab-button px-6 py-2.5 rounded-lg font-semibold text-sm transition-all duration-300 ${
                            filter === 'video' ? 'active' : ''
                        }`}
                    >
                        🎬 视频
                    </button>
                    <button
                        onClick={() => handleFilterChange('music')}
                        className={`tab-button px-6 py-2.5 rounded-lg font-semibold text-sm transition-all duration-300 ${
                            filter === 'music' ? 'active' : ''
                        }`}
                    >
                        🎵 音乐
                    </button>
                </div>
            </div>

            {/* 瀑布流容器 */}
            {/* @ts-ignore - Dynamic height calculation requires inline style */}
            <div 
                ref={containerRef}
                className={`relative w-full transition-all duration-300 ease-in-out ${
                    isTransitioning ? 'opacity-0 scale-[0.975]' : 'opacity-100 scale-100'
                }`}
                // eslint-disable-next-line react/forbid-dom-props
                style={{ 
                    height: `${containerHeight}px`, 
                    minHeight: '400px'
                }}
            >
                {filteredItems.map((item, index) => {
                    const layout = layouts.get(item.id);
                    if (!layout) return null;

                    // 子分组切换时不使用卡片动画，使用容器的统一过渡
                    const shouldAnimate = !needsTransition(prevFilter, filter);

                    return (
                        // @ts-ignore - Dynamic positioning requires inline styles
                        <div
                            key={item.id}
                            className="absolute transition-all duration-700 ease-in-out group"
                            // eslint-disable-next-line react/forbid-dom-props
                            style={{
                                left: `${layout.left}px`,
                                top: `${layout.top}px`,
                                width: `${layout.width}px`,
                                height: `${layout.height}px`,
                                opacity: layout.top === 0 ? 0 : 1,
                                animation: shouldAnimate ? `fadeInUp 0.5s ease-out ${index * 0.04}s forwards` : 'none'
                            }}
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
                                        {/* @ts-ignore - Dynamic platform color requires inline style */}
                                        <div className="w-10 h-10 rounded-full backdrop-blur-md flex items-center justify-center shadow-lg transition-all duration-300" style={{ backgroundColor: getPlatformColor(item.platform) + '15' }}>
                                            <PlatformIcon platform={item.platform} className="w-5 h-5" style={{ color: getPlatformColor(item.platform) }} />
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
                                        {/* @ts-ignore - Dynamic platform color requires inline style */}
                                        <div className="w-10 h-10 rounded-full backdrop-blur-md flex items-center justify-center shadow-lg transition-all duration-300" style={{ backgroundColor: getPlatformColor(item.platform) + '15' }}>
                                            <PlatformIcon platform={item.platform} className="w-5 h-5" style={{ color: getPlatformColor(item.platform) }} />
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
                                            {/* @ts-ignore - Dynamic platform color requires inline style */}
                                            <div className="w-10 h-10 rounded-full backdrop-blur-md flex items-center justify-center shadow-lg transition-all duration-300" style={{ backgroundColor: getPlatformColor(item.platform) + '15' }}>
                                                <PlatformIcon platform={item.platform} className="w-5 h-5" style={{ color: getPlatformColor(item.platform) }} />
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

            {/* 空状态提示 - 使用Toast */}
            {filteredItems.length === 0 && (
                <LoadingToast 
                    message="此分类暂无内容，试试切换其他分类" 
                    show={true} 
                />
            )}
        </div>
    );
}
