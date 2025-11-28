/**
 * 小组件响应式尺寸适配 Hook
 *
 * 基于组件实际尺寸自动调整内容显示,支持:
 * - 标准尺寸 (100%)
 * - 紧凑尺寸 (66% - 2/3)
 * - 迷你尺寸 (50% - 1/2)
 *
 * @example
 * const { scale, isCompact, isMini, containerRef } = useWidgetSize();
 *
 * // 使用scale动态调整字体/间距
 * <div ref={containerRef} style={{ fontSize: `${14 * scale}px` }}>
 *
 * // 或使用布尔值条件渲染
 * {!isCompact && <DetailedContent />}
 * {isCompact && <CompactContent />}
 */

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { usePerformanceProfile } from './usePerformanceProfile';
import { WidgetSize } from '../components/WidgetGrid';

// 标准尺寸映射 (像素值基于假设的标准单元格大小)
// 调整基准：从 120px 降至 80px，以适应 1366px/1440px 等主流笔记本屏幕
// 在 1920px 屏幕上，单元格约 110px，scale 会被限制在 1
// 在 1366px 屏幕上，单元格约 75px，scale 约 0.93，接近 1
const STANDARD_DIMENSIONS: Record<WidgetSize, { width: number; height: number }> = {
  '1x1': { width: 80, height: 80 },
  '2x1': { width: 160, height: 80 },
  '4x1': { width: 320, height: 80 },
  '1x2': { width: 80, height: 160 },
  '2x2': { width: 160, height: 160 },
  '2x4': { width: 160, height: 320 },
  '4x2': { width: 320, height: 160 }, // 稍微增加标准宽度，使缩放比例略微减小，防止溢出
  '4x4': { width: 320, height: 320 },
};

export interface WidgetSizeInfo {
  /** 缩放比例 0-1, 1为标准尺寸 */
  scale: number;
  /** 字体缩放比例 (比几何缩放更平缓) */
  fontScale: number;
  /** 实际宽度(px) */
  width: number;
  /** 实际高度(px) */
  height: number;
  /** 是否为紧凑模式 (60%-85%) */
  isCompact: boolean;
  /** 是否为迷你模式 (<60%) */
  isMini: boolean;
  /** 容器ref,必须绑定到组件根元素 */
  containerRef: React.RefCallback<HTMLDivElement>;
}

export function useWidgetSize(widgetSize?: WidgetSize, forceScale?: number): WidgetSizeInfo {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const perf = usePerformanceProfile();

  // 测量节流/去抖定时器
  const measureThrottleRef = useRef<number | null>(null);
  // 可见性监听，避免后台标签持续计算
  const pageHiddenRef = useRef<boolean>(typeof document !== 'undefined' ? document.hidden : false);
  const lastMeasuredRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  
  const measureElement = useCallback(() => {
    // 页面不可见时跳过测量，避免后台持续计算
    if (pageHiddenRef.current) return;
    if (!elementRef.current) return;

    const rect = elementRef.current.getBoundingClientRect();
    // 如果宽度为0 (可能是隐藏或未渲染)，不更新状态以避免闪烁
    if (rect.width > 0) {
      // 检查尺寸是否真正变化（避免微小变化触发重渲染）
      const widthDiff = Math.abs(lastMeasuredRef.current.width - rect.width);
      const heightDiff = Math.abs(lastMeasuredRef.current.height - rect.height);
      // 预置阈值：仅当 >=8px 时才更新
      const THRESHOLD_PX = 8;
      
      if (widthDiff < THRESHOLD_PX && heightDiff < THRESHOLD_PX) {
        return; // 变化太小，跳过
      }
      
      lastMeasuredRef.current = { width: rect.width, height: rect.height };
      
      setSize(prev => {
        // 二次阈值判断，进一步避免频繁状态更新
        if (Math.abs(prev.width - rect.width) < THRESHOLD_PX && Math.abs(prev.height - rect.height) < THRESHOLD_PX) {
          return prev;
        }
        return {
          width: rect.width,
          height: rect.height,
        };
      });
    }
  }, []);

  // 监听 widgetSize 变化，强制重新测量
  // 使用 useLayoutEffect 确保在浏览器绘制前更新，减少闪烁
  useLayoutEffect(() => {
    // 监听页面可见性变化，恢复/暂停测量
    const onVisibility = () => { pageHiddenRef.current = document.hidden; };
    document.addEventListener('visibilitychange', onVisibility);

    // 立即测量一次
    measureElement();
    
    // 仅保留一个延时检查，作为 ResizeObserver 的兜底
    // 确保动画结束后尺寸是正确的
    const timer = setTimeout(measureElement, 300);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [measureElement, widgetSize]);

  // Ref callback
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      elementRef.current = node;
      measureElement();

      // 低端设备：默认不持续监听，改为按需测量
      if (!perf.lowEndDevice) {
        // 使用 ResizeObserver 监听尺寸变化
        const resizeObserver = new ResizeObserver(() => {
          if (pageHiddenRef.current) return;
          // 采用更保守的监听：仅尾触发，周期 500ms
          if (measureThrottleRef.current) {
            // 已有等待中的测量，不再重复排队
            return;
          }
          measureThrottleRef.current = window.setTimeout(() => {
            measureElement();
            measureThrottleRef.current = null;
          }, 5000);
        });
        resizeObserver.observe(node);
        (node as any).__widgetResizeObserver = resizeObserver;
      } else {
        // 低端设备：仅在首次挂载测量一次即可
        (node as any).__widgetResizeObserver = null;
      }
    } else if (elementRef.current) {
      // 清理
      const observer = (elementRef.current as any).__widgetResizeObserver;
      if (observer) {
        observer.disconnect();
      }
      if (measureThrottleRef.current) {
        window.clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
      elementRef.current = null;
    }
  }, [measureElement]);

  // 计算缩放比例
  const scale = (() => {
    if (forceScale !== undefined) return forceScale;
    if (!widgetSize || size.width === 0) return 1;

    const standard = STANDARD_DIMENSIONS[widgetSize];
    if (!standard) return 1;

    // 基于宽度计算缩放比例
    const calculatedScale = size.width / standard.width;
    
    // 限制在 0.5 - 1.1 之间，避免过大或过小
    return Math.max(0.5, Math.min(1.1, calculatedScale));
  })();

  // 字体缩放比例：使用平方根使缩放更平缓
  // 例如：scale = 0.64 -> fontScale = 0.8
  const fontScale = Math.sqrt(scale);

  // 判断模式
  const isCompact = scale < 0.85;
  const isMini = scale < 0.65;

  return {
    scale,
    fontScale,
    width: size.width,
    height: size.height,
    isCompact,
    isMini,
    containerRef,
  };
}

/**
 * 简化版 - 只返回缩放比例
 */
export function useWidgetScale(widgetSize?: WidgetSize): number {
  const { scale } = useWidgetSize(widgetSize);
  return scale;
}

/**
 * 布尔版 - 只判断是否为紧凑/迷你模式
 */
export function useWidgetMode(widgetSize?: WidgetSize): { isCompact: boolean; isMini: boolean } {
  const { isCompact, isMini } = useWidgetSize(widgetSize);
  return { isCompact, isMini };
}
