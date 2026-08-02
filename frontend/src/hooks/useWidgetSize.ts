/**
 * 小组件响应式尺寸适配 Hook
 *
 * 基于组件实际尺寸自动调整内容显示,支持:
 * - 标准尺寸 (100%)
 * - 紧凑尺寸 (66% - 2/3)
 * - 迷你尺寸 (50% - 1/2)
 *
 * 性能优化：
 * - 使用共享 ResizeObserver（通过 AnimationCoordinator）
 * - 自动节流和尺寸变化阈值过滤
 * - 页面不可见时暂停监测
 * - 低端设备仅首次测量
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

import type { WidgetSize } from '../components/WidgetGrid'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCachedSize } from './animation'
import { useHomeResizeObserver } from './animation/pages/home'
import { isReducedAnimation, useAnimationLevel } from './useAnimationLevel'

/**
 * Design-time cell size for widget content scale (useWidgetSize).
 * Library previews and Tapp iframe scaling should use the same baseline so
 * preview layout matches on-grid rendering at scale=1.
 *
 * History: 120 → 80 for common 1366/1440 laptop viewports.
 * On ~1920px, real cells ≈110px (scale capped at 1.1).
 * On ~1366px, real cells ≈75px (scale ≈0.93).
 */
export const STANDARD_CELL_SIZE = 80

/** Grid span (cols × rows) for each WidgetSize — single source for pixel math. */
const SIZE_SPANS: Record<WidgetSize, { cols: number; rows: number }> = {
  '1x1': { cols: 1, rows: 1 },
  '2x1': { cols: 2, rows: 1 },
  '4x1': { cols: 4, rows: 1 },
  '1x2': { cols: 1, rows: 2 },
  '2x2': { cols: 2, rows: 2 },
  '2x3': { cols: 2, rows: 3 },
  '3x2': { cols: 3, rows: 2 },
  '3x3': { cols: 3, rows: 3 },
  '2x4': { cols: 2, rows: 4 },
  '4x2': { cols: 4, rows: 2 },
  '4x4': { cols: 4, rows: 4 },
}

/** Standard pixel box at design scale=1 for a widget size. */
export function getStandardWidgetDimensions(widgetSize: WidgetSize): {
  width: number
  height: number
} {
  const span = SIZE_SPANS[widgetSize] ?? { cols: 1, rows: 1 }
  return {
    width: span.cols * STANDARD_CELL_SIZE,
    height: span.rows * STANDARD_CELL_SIZE,
  }
}

const STANDARD_DIMENSIONS: Record<
  WidgetSize,
  { width: number; height: number }
> = {
  '1x1': getStandardWidgetDimensions('1x1'),
  '2x1': getStandardWidgetDimensions('2x1'),
  '4x1': getStandardWidgetDimensions('4x1'),
  '1x2': getStandardWidgetDimensions('1x2'),
  '2x2': getStandardWidgetDimensions('2x2'),
  '2x3': getStandardWidgetDimensions('2x3'),
  '3x2': getStandardWidgetDimensions('3x2'),
  '3x3': getStandardWidgetDimensions('3x3'),
  '2x4': getStandardWidgetDimensions('2x4'),
  '4x2': getStandardWidgetDimensions('4x2'),
  '4x4': getStandardWidgetDimensions('4x4'),
}

/**
 * Library strip only: shrink the already-standard-sized preview so many
 * widgets fit. Content still renders at STANDARD_CELL_SIZE (forceScale=1).
 */
export const LIBRARY_PREVIEW_DISPLAY_SCALE = 0.65

export interface WidgetSizeInfo {
  /** 缩放比例 0-1, 1为标准尺寸 */
  scale: number
  /** 字体缩放比例 (比几何缩放更平缓) */
  fontScale: number
  /** 实际宽度(px) */
  width: number
  /** 实际高度(px) */
  height: number
  /** 是否为紧凑模式 (60%-85%) */
  isCompact: boolean
  /** 是否为迷你模式 (<60%) */
  isMini: boolean
  /** 容器ref,必须绑定到组件根元素 */
  containerRef: React.RefCallback<HTMLDivElement>
}

export function useWidgetSize(
  widgetSize?: WidgetSize,
  forceScale?: number,
): WidgetSizeInfo {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const elementRef = useRef<HTMLDivElement | null>(null)
  const anim = useAnimationLevel()
  // 低性能模式与硬件低端：仅首次测量，不持续监听
  const reduceResizeWork = isReducedAnimation(anim)
  const reduceResizeWorkRef = useRef(reduceResizeWork)
  reduceResizeWorkRef.current = reduceResizeWork

  // 🆕 使用首页原子化 ResizeObserver
  const { observeHomeResize, unobserveHomeResize } = useHomeResizeObserver()

  // 尺寸更新处理
  const handleSizeChange = useCallback((entry: ResizeObserverEntry) => {
    const { width, height } = entry.contentRect

    // 宽度为0时不更新（可能是隐藏或未渲染）
    if (width <= 0) return

    setSize((prev) => {
      // 使用较大的阈值避免微小变化触发重渲染
      const THRESHOLD = 8
      if (
        Math.abs(prev.width - width) < THRESHOLD &&
        Math.abs(prev.height - height) < THRESHOLD
      ) {
        return prev
      }
      return { width, height }
    })
  }, [])

  // Ref callback - 连接到首页原子化 ResizeObserver
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      // 清理旧观察
      if (elementRef.current) {
        unobserveHomeResize(elementRef.current)
      }

      elementRef.current = node

      if (node) {
        // 低性能 / 低端：仅首次测量，不持续监听
        if (reduceResizeWorkRef.current) {
          // 尝试获取缓存尺寸
          const cached = getCachedSize(node)
          if (cached && cached.width > 0) {
            setSize(cached)
          } else {
            // 延迟测量一次
            requestAnimationFrame(() => {
              if (node.isConnected) {
                const rect = node.getBoundingClientRect()
                if (rect.width > 0) {
                  setSize({ width: rect.width, height: rect.height })
                }
              }
            })
          }
        } else {
          // 正常设备：使用首页原子化 ResizeObserver 持续监听
          observeHomeResize(node, handleSizeChange)
        }
      }
    },
    [handleSizeChange, observeHomeResize, unobserveHomeResize],
  )

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (elementRef.current) {
        unobserveHomeResize(elementRef.current)
      }
    }
  }, [unobserveHomeResize])

  // widgetSize 变化时重新测量（针对低性能 / 低端设备）
  useEffect(() => {
    if (
      reduceResizeWorkRef.current &&
      elementRef.current &&
      elementRef.current.isConnected
    ) {
      requestAnimationFrame(() => {
        if (elementRef.current && elementRef.current.isConnected) {
          const rect = elementRef.current.getBoundingClientRect()
          if (rect.width > 0) {
            setSize({ width: rect.width, height: rect.height })
          }
        }
      })
    }
  }, [widgetSize])

  // 计算缩放比例
  const scale = (() => {
    if (forceScale !== undefined) return forceScale
    if (!widgetSize || size.width === 0) return 1

    const standard = STANDARD_DIMENSIONS[widgetSize]
    if (!standard) return 1

    // 基于宽度计算缩放比例
    const calculatedScale = size.width / standard.width

    // 限制在 0.5 - 1.1 之间，避免过大或过小
    return Math.max(0.5, Math.min(1.1, calculatedScale))
  })()

  // 字体缩放比例：使用平方根使缩放更平缓
  // 例如：scale = 0.64 -> fontScale = 0.8
  const fontScale = Math.sqrt(scale)

  // 判断模式
  const isCompact = scale < 0.85
  const isMini = scale < 0.65

  return {
    scale,
    fontScale,
    width: size.width,
    height: size.height,
    isCompact,
    isMini,
    containerRef,
  }
}

/**
 * 简化版 - 只返回缩放比例
 */
export function useWidgetScale(widgetSize?: WidgetSize): number {
  const { scale } = useWidgetSize(widgetSize)
  return scale
}

/**
 * 布尔版 - 只判断是否为紧凑/迷你模式
 */
export function useWidgetMode(widgetSize?: WidgetSize): {
  isCompact: boolean
  isMini: boolean
} {
  const { isCompact, isMini } = useWidgetSize(widgetSize)
  return { isCompact, isMini }
}
