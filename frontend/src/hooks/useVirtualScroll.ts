/**
 * 虚拟滚动 Hook
 * 用于优化大列表性能，只渲染可见区域的项目
 */

import { useState, useEffect, useRef, useCallback } from 'react';

interface VirtualScrollOptions {
  itemHeight: number;          // 每个项目的高度
  overscan?: number;            // 预渲染的额外项目数量
  enabled?: boolean;            // 是否启用虚拟滚动
}

interface VirtualScrollResult {
  visibleItems: number[];       // 可见项目的索引数组
  containerHeight: number;      // 容器总高度
  offsetY: number;              // 偏移量
}

export function useVirtualScroll(
  totalItems: number,
  options: VirtualScrollOptions
): VirtualScrollResult {
  const { itemHeight, overscan = 5, enabled = true } = options;
  
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  
  // 监听滚动
  useEffect(() => {
    if (!enabled) return;

    const handleScroll = () => {
      setScrollTop(window.scrollY);
    };

    const handleResize = () => {
      setContainerHeight(window.innerHeight);
    };

    handleResize();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [enabled]);

  // 计算可见项目
  const visibleItems = (() => {
    if (!enabled || totalItems === 0) {
      return Array.from({ length: totalItems }, (_, i) => i);
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      totalItems - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );

    return Array.from(
      { length: endIndex - startIndex + 1 },
      (_, i) => startIndex + i
    );
  })();

  return {
    visibleItems,
    containerHeight: totalItems * itemHeight,
    offsetY: visibleItems.length > 0 ? visibleItems[0] * itemHeight : 0,
  };
}

/**
 * 分页加载 Hook
 * 用于逐步加载数据，避免一次性加载过多
 */

interface PagedLoadOptions {
  pageSize: number;             // 每页大小
  initialPages?: number;        // 初始加载页数
  threshold?: number;           // 触发加载的距离阈值（像素）
}

interface PagedLoadResult<T> {
  items: T[];                   // 当前已加载的项目
  loadMore: () => void;         // 加载更多函数
  hasMore: boolean;             // 是否还有更多数据
  loading: boolean;             // 是否正在加载
  reset: () => void;            // 重置状态
}

export function usePagedLoad<T>(
  allItems: T[],
  options: PagedLoadOptions
): PagedLoadResult<T> {
  const { pageSize, initialPages = 2, threshold = 500 } = options;
  
  const [currentPage, setCurrentPage] = useState(initialPages);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  
  const items = allItems.slice(0, currentPage * pageSize);
  const hasMore = items.length < allItems.length;

  // 加载更多
  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return;
    
    loadingRef.current = true;
    setLoading(true);
    
    // 模拟异步加载延迟
    setTimeout(() => {
      setCurrentPage(prev => prev + 1);
      setLoading(false);
      loadingRef.current = false;
    }, 300);
  }, [hasMore]);

  // 监听滚动触发加载
  useEffect(() => {
    const handleScroll = () => {
      if (!hasMore || loadingRef.current) return;

      const scrollHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY;
      const clientHeight = window.innerHeight;

      if (scrollHeight - scrollTop - clientHeight < threshold) {
        loadMore();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [hasMore, loadMore, threshold]);

  // 重置
  const reset = useCallback(() => {
    setCurrentPage(initialPages);
    setLoading(false);
    loadingRef.current = false;
  }, [initialPages]);

  // 当 allItems 改变时重置
  useEffect(() => {
    reset();
  }, [allItems.length, reset]);

  return {
    items,
    loadMore,
    hasMore,
    loading,
    reset,
  };
}
