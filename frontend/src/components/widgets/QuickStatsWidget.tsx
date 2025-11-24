/**
 * 内容数据概览卡片 - 4x2
 * 显示资料库统计数据
 */

import { motion } from 'framer-motion';
import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { WidgetComponentProps } from '../WidgetGrid';
import { API_URL } from '../../config';

// 缓存配置
const CACHE_KEY = 'library_stats_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟

interface LibraryStats {
  total: number;
  game: number;
  video: number;
  music: number;
  anime: number;
  tv_series: number;
}

// 统计卡片组件 - 避免重复渲染
const StatCard = memo(({ cat, value, loading }: { cat: any; value: number; loading: boolean; index: number }) => {
  const renderIcon = useCallback((type: string) => {
    const iconClass = "w-5 h-5";
    switch (type) {
      case 'game':
        return (
          <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <rect x="2" y="6" width="20" height="12" rx="3" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12h4m-2-2v4" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 11h.01M17 13h.01" />
          </svg>
        );
      case 'video':
        return (
          <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
      case 'music':
        return (
          <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        );
      case 'anime':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize="18" fontWeight="bold">あ</text>
          </svg>
        );
      case 'tv_series':
        return (
          <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        );
      default:
        return null;
    }
  }, []);

  return (
    <div className="flex flex-col items-center justify-center bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-lg p-1.5 relative overflow-hidden">
      <div 
        className="absolute top-0 right-0 w-6 h-6 rounded-full blur-xl opacity-20"
        style={{ background: cat.color }}
      />
      <div className="relative z-10 flex flex-col items-center gap-0.5">
        <div className="text-gray-700 dark:text-gray-300">
          {renderIcon(cat.key)}
        </div>
        <span className="text-base font-black text-gray-800 dark:text-gray-200 leading-none">
          {loading ? '-' : value}
        </span>
        <span className="text-[7px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-bold">
          {cat.label}
        </span>
      </div>
    </div>
  );
});

StatCard.displayName = 'StatCard';

export const QuickStatsWidget = memo(({ config, isEditMode, isPreview }: WidgetComponentProps) => {
  const [stats, setStats] = useState<LibraryStats>({
    total: 0,
    game: 0,
    video: 0,
    music: 0,
    anime: 0,
    tv_series: 0,
  });
  const [loading, setLoading] = useState(true);

  // 从缓存加载
  const loadFromCache = useCallback(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          setStats(data);
          return true;
        }
      }
    } catch (err) {
      console.error('加载缓存失败:', err);
    }
    return false;
  }, []);

  // 保存到缓存
  const saveToCache = useCallback((data: LibraryStats) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (err) {
      console.error('保存缓存失败:', err);
    }
  }, []);

  const fetchLibraryStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/library`, { 
        credentials: 'include',
        signal: AbortSignal.timeout(10000), // 10秒超时
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success && Array.isArray(data.items)) {
        // 使用 reduce 一次性统计，性能更好
        const counts = data.items.reduce((acc: LibraryStats, item: any) => {
          acc.total++;
          const type = item.item_type;
          if (type in acc) {
            (acc as any)[type]++;
          }
          return acc;
        }, {
          total: 0,
          game: 0,
          video: 0,
          music: 0,
          anime: 0,
          tv_series: 0,
        });
        
        setStats(counts);
        saveToCache(counts);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('获取资料库统计失败:', err);
      }
    } finally {
      setLoading(false);
    }
  }, [saveToCache]);

  useEffect(() => {
    if (isPreview) {
      setStats({
        total: 1234,
        game: 120,
        video: 450,
        music: 300,
        anime: 200,
        tv_series: 164
      });
      setLoading(false);
      return;
    }

    // 先从缓存加载
    const hasCache = loadFromCache();
    if (hasCache) {
      setLoading(false);
    }
    
    // 然后获取最新数据
    fetchLibraryStats();
  }, [loadFromCache, fetchLibraryStats, isPreview]);

  const categories = useMemo(() => [
    { key: 'game', label: '游戏', color: '#1b2838' },
    { key: 'video', label: '视频', color: '#00A1D6' },
    { key: 'music', label: '音乐', color: '#d33a31' },
    { key: 'anime', label: '动漫', color: '#fb7299' },
    { key: 'tv_series', label: '剧集', color: '#6366f1' },
  ], []);

  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden glass">
      {/* 背景装饰 */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50/50 to-transparent dark:from-gray-800/30 dark:to-transparent" />
      
      {/* 主内容 */}
      <div className="relative h-full flex flex-col p-3">
        {/* 顶部：标题 + 总数 */}
        <div className="flex items-start justify-between mb-2 ml-1.5">
          <div>
            <h3 className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-bold mb-0.5">
              内容总览
            </h3>
            <motion.div 
              className="flex items-baseline gap-1"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <span className="text-3xl font-black text-gray-800 dark:text-gray-100 leading-none">
                {loading ? '---' : stats.total}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 font-bold mb-0.5">
                ITEMS
              </span>
            </motion.div>
          </div>
        </div>

        {/* 分类统计 */}
        <div className="flex-1 grid grid-cols-5 gap-1.5">
          {categories.map((cat, index) => (
            <motion.div
              key={cat.key}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.2 + index * 0.05 }}
            >
              <StatCard cat={cat} value={(stats as any)[cat.key]} loading={loading} index={index} />
            </motion.div>
          ))}
        </div>
      </div>

      {isEditMode && (
        <div className="absolute inset-0 border-2 border-dashed border-blue-400 rounded-2xl pointer-events-none" />
      )}
    </div>
  );
});

QuickStatsWidget.displayName = 'QuickStatsWidget';