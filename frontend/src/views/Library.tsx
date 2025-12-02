/**
 * 资料库视图组件
 * 显示用户的多平台数据收藏
 */

import { useEffect, useState } from 'react';
import LibraryGrid from '../components/LibraryGrid';
import AnimatedView from '../components/AnimatedView';
import { useLibraryScheduler } from '../hooks/animation/pages/library';

export default function Library() {
  // 🆕 初始化资料库调度器（Resize + Intersection + Idle）
  useLibraryScheduler();
  
  const [filter, setFilter] = useState<'all' | 'game' | 'video' | 'music' | 'anime' | 'tv_series'>('all');

  // 监听来自 AppLayout 的筛选变化
  useEffect(() => {
    const handleFilterChange = (e: CustomEvent<{ filter: 'all' | 'game' | 'video' | 'music' | 'anime' | 'tv_series' }>) => {
      setFilter(e.detail.filter);
    };

    window.addEventListener('library-filter-change', handleFilterChange as EventListener);
    return () => {
      window.removeEventListener('library-filter-change', handleFilterChange as EventListener);
    };
  }, []);

  return (
    <AnimatedView className="min-h-screen px-3 xs:px-4 sm:px-6 pt-20 pb-28 sm:pb-24 md:pb-12">
      <div className="max-w-7xl mx-auto">
        <LibraryGrid filter={filter} />
      </div>
    </AnimatedView>
  );
}
