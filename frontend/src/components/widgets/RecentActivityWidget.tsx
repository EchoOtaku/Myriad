/**
 * 最近活动小组件 - 4x2 紧凑布局
 * 显示最新的资料库更新历史
 */

import { motion } from 'framer-motion';
import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { WidgetComponentProps } from '../WidgetGrid';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// 缓存配置
const CACHE_KEY = 'recent_activities_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟
const DEBOUNCE_DELAY = 300; // 300ms 防抖

interface Activity {
  id: number;
  platform_name: string;
  changed_fields: any;
  change_date: string;
  item_type?: string;
  item_title?: string;
}

// 平台图标组件 - 优化为独立组件避免重复渲染
const PlatformIcon = memo(({ platformName }: { platformName: string }) => {
  const iconClass = "w-4 h-4";
  
  const icon = useMemo(() => {
    switch (platformName.toLowerCase()) {
      case 'steam':
        return <path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10C6.48 22 2 17.52 2 12L11.96 16v.02c0 1.09.89 1.98 1.98 1.98 1.09 0 1.98-.89 1.98-1.98v-.09l4.64-2.68c1.09 0 1.98-.89 1.98-1.98 0-1.09-.89-1.98-1.98-1.98-1.09 0-1.98.89-1.98 1.98v.06l-2.68 4.64c-.2.02-.41.04-.62.04-2.2 0-3.98-1.78-3.98-3.98 0-.34.04-.67.13-.98L2 12C2 6.48 6.48 2 12 2z"/>;
      case 'bilibili':
        return <path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"/>;
      case 'netease_music':
      case 'netease':
        return <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm-1 2v8h2V4h-2zm-4 4v4h2V8H7zm8 0v4h2V8h-2z"/>;
      case 'github':
        return <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>;
      default:
        return <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>;
    }
  }, [platformName]);

  return (
    <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
      {icon}
    </svg>
  );
});

PlatformIcon.displayName = 'PlatformIcon';

// 活动项组件 - 优化渲染性能
const ActivityItem = memo(({ activity, index }: { activity: Activity; index: number }) => {
  const description = useMemo(() => {
    if (activity.item_title) return activity.item_title;
    if (activity.item_type) return `更新了${activity.item_type}数据`;
    return '数据更新';
  }, [activity.item_title, activity.item_type]);

  const timeAgo = useMemo(() => {
    const date = new Date(activity.change_date);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(hours / 24);

    if (days > 7) {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    } else if (days > 0) {
      return `${days}天前`;
    } else if (hours > 0) {
      return `${hours}小时前`;
    } else {
      return '刚刚';
    }
  }, [activity.change_date]);

  return (
    <motion.div
      initial={{ x: -10, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center gap-2 p-1.5 rounded-md bg-white/40 dark:bg-white/[0.02] hover:bg-white/60 dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
    >
      <div className="flex-shrink-0 text-gray-600 dark:text-gray-400">
        <PlatformIcon platformName={activity.platform_name} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-gray-800 dark:text-gray-200 truncate leading-tight">
          {description}
        </div>
        <div className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">
          {timeAgo}
        </div>
      </div>
    </motion.div>
  );
});

ActivityItem.displayName = 'ActivityItem';

export const RecentActivityWidget = memo(({ config, isEditMode, isPreview }: WidgetComponentProps) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  // 从缓存加载数据
  const loadFromCache = useCallback(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          setActivities(data);
          return true;
        }
      }
    } catch (err) {
      console.error('加载缓存失败:', err);
    }
    return false;
  }, []);

  // 保存到缓存
  const saveToCache = useCallback((data: Activity[]) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (err) {
      console.error('保存缓存失败:', err);
    }
  }, []);

  const fetchActivities = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/activities?limit=8`, {
        credentials: 'include',
        signal: AbortSignal.timeout(10000), // 10秒超时
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success && Array.isArray(data.activities)) {
        setActivities(data.activities);
        saveToCache(data.activities);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('获取活动失败:', err);
      }
    } finally {
      setLoading(false);
    }
  }, [saveToCache]);

  useEffect(() => {
    if (isPreview) {
      setActivities([
        { id: 1, platform_name: 'steam', changed_fields: {}, change_date: new Date().toISOString(), item_title: '示例游戏' },
        { id: 2, platform_name: 'bilibili', changed_fields: {}, change_date: new Date().toISOString(), item_title: '示例视频' },
        { id: 3, platform_name: 'netease', changed_fields: {}, change_date: new Date().toISOString(), item_title: '示例歌曲' },
        { id: 4, platform_name: 'github', changed_fields: {}, change_date: new Date().toISOString(), item_title: '示例提交' }
      ]);
      setLoading(false);
      return;
    }

    // 先尝试从缓存加载
    const hasCache = loadFromCache();
    if (hasCache) {
      setLoading(false);
    }
    
    // 然后获取最新数据
    fetchActivities();
  }, [loadFromCache, fetchActivities, isPreview]);



  return (
    <div className="h-full w-full glass rounded-xl p-3 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
      
      <div className="relative z-10 h-full flex flex-col">
        {/* 标题 */}
        <div className="mb-2 ml-1.5">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            最近活动
          </h3>
        </div>
        
        {/* 活动列表 */}
        <div className="flex-1 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-xs text-gray-500 dark:text-gray-400">加载中...</div>
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">暂无活动记录</p>
            </div>
          ) : (
            activities.map((activity, index) => (
              <ActivityItem key={activity.id} activity={activity} index={index} />
            ))
          )}
        </div>
      </div>
      
      {isEditMode && (
        <div className="absolute inset-0 border-2 border-dashed border-violet-400 rounded-xl pointer-events-none" />
      )}
    </div>
  );
});

RecentActivityWidget.displayName = 'RecentActivityWidget';
