import type { WidgetSize } from '../components/widgetGridTypes'
import type { ViewportBand } from '../utils/viewportBands'
import type { WidgetSizeKey } from '../utils/widgetSizeScale'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VIEWPORT_MQ } from '../utils/viewportBands'
import {
  resolveWidgetContentScale,
  STANDARD_CELL_BY_BAND,
  STANDARD_CELL_SIZE as STANDARD_CELL_SIZE_CONST,
  WIDGET_COMPACT_SCALE,
  WIDGET_MINI_SCALE,
} from '../utils/widgetSizeScale'
import { useWidgetResizeObserver } from './animation/useWidgetResizeObserver'
import { useMediaQuery } from './useMediaQuery'

export const STANDARD_CELL_SIZE = STANDARD_CELL_SIZE_CONST
export { STANDARD_CELL_BY_BAND, WIDGET_COMPACT_SCALE, WIDGET_MINI_SCALE }

export interface WidgetSizeInfo {
  scale: number
  fontScale: number
  width: number
  height: number
  isCompact: boolean
  isMini: boolean
  viewportBand: ViewportBand
  containerRef: React.RefCallback<HTMLDivElement>
}

function useViewportBand(): ViewportBand {
  const isPhone = useMediaQuery(VIEWPORT_MQ.phone)
  const isDesktop = useMediaQuery(VIEWPORT_MQ.desktop)
  return isPhone ? 'phone' : isDesktop ? 'desktop' : 'tablet'
}

/** 缩放基准与 viewportBands 一致，避免跨 1078 时 isCompact 反向跳变。 */
export function useWidgetSize(
  widgetSize?: WidgetSize,
  forceScale?: number,
): WidgetSizeInfo {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const elementRef = useRef<HTMLDivElement | null>(null)
  const viewportBand = useViewportBand()

  const { observeWidgetResize, unobserveWidgetResize } = useWidgetResizeObserver()

  const handleSizeChange = useCallback((entry: ResizeObserverEntry) => {
    const { width, height } = entry.contentRect
    if (width <= 0) return

    setSize((prev) => {
      // ResizeObserver already coalesces layout changes. Preserve small final
      // sizes as well as every step of a continuous resize.
      if (prev.width === width && prev.height === height) {
        return prev
      }
      return { width, height }
    })
  }, [])

  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (elementRef.current) {
        unobserveWidgetResize(elementRef.current)
      }

      elementRef.current = node

      if (node) {
        // Layout observation is needed at every animation level, including viewport resizes.
        observeWidgetResize(node, handleSizeChange)
      }
    },
    [handleSizeChange, observeWidgetResize, unobserveWidgetResize],
  )

  useEffect(() => {
    return () => {
      if (elementRef.current) {
        unobserveWidgetResize(elementRef.current)
      }
    }
  }, [unobserveWidgetResize])

  const scale = useMemo(() => {
    if (forceScale !== undefined) return forceScale
    if (!widgetSize || size.width === 0) return 1
    return resolveWidgetContentScale({
      measuredWidth: size.width,
      measuredHeight: size.height,
      widgetSize: widgetSize as WidgetSizeKey,
      band: viewportBand,
    })
  }, [forceScale, widgetSize, size.width, size.height, viewportBand])

  const fontScale = Math.sqrt(scale)
  const isCompact = scale < WIDGET_COMPACT_SCALE
  const isMini = scale < WIDGET_MINI_SCALE

  return {
    scale,
    fontScale,
    width: size.width,
    height: size.height,
    isCompact,
    isMini,
    viewportBand,
    containerRef,
  }
}
