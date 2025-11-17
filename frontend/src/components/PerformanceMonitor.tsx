/**
 * 性能监控面板 (开发环境)
 * 实时显示FPS、内存使用、渲染时间、资源加载状态等
 */

import { useEffect, useState, useRef } from 'react';
import { globalResourceLoader } from '../utils/resourceLoader';
import { clearPlaylistCache, clearLyricsCache } from '../utils/musicPlayer';
import './PerformanceMonitor.css';

interface PerformanceMetrics {
  fps: number;
  memory?: {
    used: number;
    limit: number;
    usedPercent: number;
  };
  renderTime: number;
  longTasks: number;
}

export default function PerformanceMonitor() {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 0,
    renderTime: 0,
    longTasks: 0,
  });
  const [resourceStats, setResourceStats] = useState(globalResourceLoader.getStats());
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCacheCleared, setShowCacheCleared] = useState(false);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const rafIdRef = useRef<number>();

  // FPS监控
  useEffect(() => {
    const measureFPS = () => {
      frameCountRef.current++;
      const currentTime = performance.now();
      const elapsed = currentTime - lastTimeRef.current;

      // 每秒更新一次
      if (elapsed >= 1000) {
        const fps = Math.round((frameCountRef.current * 1000) / elapsed);
        
        setMetrics(prev => ({
          ...prev,
          fps,
        }));

        frameCountRef.current = 0;
        lastTimeRef.current = currentTime;
      }

      rafIdRef.current = requestAnimationFrame(measureFPS);
    };

    measureFPS();

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // 内存监控
  useEffect(() => {
    const checkMemory = () => {
      if ('memory' in performance) {
        const mem = (performance as any).memory;
        setMetrics(prev => ({
          ...prev,
          memory: {
            used: Math.round(mem.usedJSHeapSize / 1048576), // MB
            limit: Math.round(mem.jsHeapSizeLimit / 1048576),
            usedPercent: Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100),
          },
        }));
      }
    };

    const interval = setInterval(checkMemory, 2000);
    checkMemory();

    return () => clearInterval(interval);
  }, []);

  // Long Tasks监控
  useEffect(() => {
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          setMetrics(prev => ({
            ...prev,
            longTasks: prev.longTasks + entries.length,
          }));
        });

        observer.observe({ entryTypes: ['longtask'] });

        return () => observer.disconnect();
      } catch (e) {
        // longtask可能不被支持
      }
    }
  }, []);

  // 渲染时间监控
  useEffect(() => {
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach((entry: any) => {
            if (entry.name === 'first-contentful-paint') {
              setMetrics(prev => ({
                ...prev,
                renderTime: Math.round(entry.startTime),
              }));
            }
          });
        });

        observer.observe({ entryTypes: ['paint'] });

        return () => observer.disconnect();
      } catch (e) {
        // paint可能不被支持
      }
    }
  }, []);

  // 资源加载监控
  useEffect(() => {
    const interval = setInterval(() => {
      setResourceStats(globalResourceLoader.getStats());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // 快捷键切换展开/折叠
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + M
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        setIsExpanded(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  const getFPSColor = (fps: number) => {
    if (fps >= 55) return 'text-green-400';
    if (fps >= 30) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getMemoryColor = (percent?: number) => {
    if (!percent) return 'text-gray-400';
    if (percent < 70) return 'text-green-400';
    if (percent < 85) return 'text-yellow-400';
    return 'text-red-400';
  };

  const hasActivity = resourceStats.queued > 0 || resourceStats.active > 0;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] bg-black/90 backdrop-blur-md rounded-lg shadow-xl text-white text-xs font-mono max-w-[280px]">
      {/* 紧凑模式 - 默认显示 */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-bold">⚡ 性能</span>
            <span className={`font-bold ${getFPSColor(metrics.fps)}`}>
              {metrics.fps} FPS
            </span>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-400 hover:text-white transition-colors"
            title={isExpanded ? "收起 (Ctrl+Shift+M)" : "展开 (Ctrl+Shift+M)"}
          >
            {isExpanded ? '▼' : '▲'}
          </button>
        </div>

        {/* 资源加载状态 */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-400">资源:</span>
          <span className={hasActivity ? 'text-yellow-400' : 'text-green-400'}>
            {resourceStats.queued}Q
          </span>
          <span className={resourceStats.active > 0 ? 'text-blue-400' : 'text-gray-500'}>
            {resourceStats.active}A
          </span>
          <span className="text-gray-500">
            {resourceStats.completed}✓
          </span>
          {resourceStats.failed > 0 && (
            <span className="text-red-400">
              {resourceStats.failed}✗
            </span>
          )}
        </div>

        {/* 内存进度条 */}
        {metrics.memory && (
          <div className="mt-2">
            <div className="flex justify-between items-center text-[10px] mb-1">
              <span className="text-gray-400">内存</span>
              <span className={getMemoryColor(metrics.memory.usedPercent)}>
                {metrics.memory.usedPercent}%
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-1 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  metrics.memory.usedPercent < 70
                    ? 'bg-green-400'
                    : metrics.memory.usedPercent < 85
                    ? 'bg-yellow-400'
                    : 'bg-red-400'
                }`}
                data-width={metrics.memory.usedPercent}
              />
            </div>
          </div>
        )}
      </div>

      {/* 展开模式 - 详细信息 */}
      {isExpanded && (
        <div className="border-t border-white/10 p-3 space-y-3">
          {/* 性能详情 */}
          <div>
            <div className="font-bold mb-2 text-gray-300">性能指标</div>
            <div className="space-y-1.5 text-[11px]">
              {metrics.memory && (
                <div className="flex justify-between">
                  <span className="text-gray-400">内存:</span>
                  <span className={getMemoryColor(metrics.memory.usedPercent)}>
                    {metrics.memory.used} / {metrics.memory.limit} MB
                  </span>
                </div>
              )}
              {metrics.renderTime > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">FCP:</span>
                  <span className="text-blue-400">{metrics.renderTime} ms</span>
                </div>
              )}
              {metrics.longTasks > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Long Tasks:</span>
                  <span className="text-orange-400">{metrics.longTasks}</span>
                </div>
              )}
            </div>
          </div>

          {/* 资源队列详情 */}
          <div>
            <div className="font-bold mb-2 text-gray-300">资源队列</div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
              {Object.entries(resourceStats.queuedByPriority).map(([priority, count]) => (
                <div key={priority} className="flex justify-between bg-white/5 rounded px-2 py-1">
                  <span className="text-gray-400">{priority}:</span>
                  <span className={count > 0 ? 'text-yellow-400 font-bold' : 'text-gray-500'}>
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 操作按钮 */}
          <div>
            <div className="font-bold mb-2 text-gray-300">操作</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 rounded text-[10px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={() => {
                  globalResourceLoader.clear();
                  setResourceStats(globalResourceLoader.getStats());
                }}
                disabled={!hasActivity}
              >
                🗑️ 清空
              </button>
              <button
                className="px-2 py-1 bg-blue-500/20 hover:bg-blue-500/30 rounded text-[10px] transition-colors"
                onClick={() => {
                  globalResourceLoader.reset();
                  setResourceStats(globalResourceLoader.getStats());
                }}
              >
                🔄 重置
              </button>
              <button
                className="px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 rounded text-[10px] transition-colors col-span-2"
                onClick={() => {
                  clearPlaylistCache();
                  clearLyricsCache();
                  setShowCacheCleared(true);
                  setTimeout(() => setShowCacheCleared(false), 2000);
                }}
              >
                🗑️ 清除缓存
              </button>
            </div>
            {showCacheCleared && (
              <div className="mt-1.5 text-center text-green-400 text-[10px]">
                ✓ 缓存已清除
              </div>
            )}
          </div>

          <div className="text-[9px] text-gray-500 text-center pt-2 border-t border-white/10">
            按 Ctrl+Shift+M 切换
          </div>
        </div>
      )}
    </div>
  );
}
