import type { WidgetConfig, WidgetType } from './widgetGridTypes'
import React, { Suspense, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../contexts/I18nContext'
import { useWidgetDragCursor } from '../utils/widgetDragCursor'
import { GRID_WIDGET_PAD_PX } from '../utils/widgetSizeScale'
import { RenderErrorBoundary } from './RenderErrorBoundary'
import {
  dragGhostContentSize,
  widgetDragGhostBox,
} from './widgetPlacementPreview'
import {
  widgetCrashDetail,
  WidgetCrashFallback,
} from './widgets/shared/WidgetCrashFallback'

export const WidgetDragGhost = React.memo(({
  active,
  settling,
  exiting,
  reducedMotion,
  dragPreview,
  gridWidth,
  gridHeight,
  gridRectRef,
}: {
  active: boolean
  settling: boolean
  exiting: boolean
  reducedMotion: boolean
  dragPreview: {
    size: { w: number; h: number }
    hasCollision: boolean
    position?: { x: number; y: number } | null
    settleCell?: { x: number; y: number } | null
    fromLibrary?: boolean
    padded?: boolean
    widgetType?: WidgetType
    widgetConfig?: WidgetConfig
  } | null
  gridWidth: number
  gridHeight: number
  gridRectRef: React.RefObject<DOMRect | null>
}) => {
  const { t, format } = useI18n()
  const pos = useWidgetDragCursor()
  const [settleLanded, setSettleLanded] = useState(false)
  useLayoutEffect(() => {
    if (!settling || reducedMotion) {
      setSettleLanded(settling)
      return
    }
    setSettleLanded(false)
    const frame = requestAnimationFrame(() => setSettleLanded(true))
    return () => cancelAnimationFrame(frame)
  }, [reducedMotion, settling])

  if (
    !active ||
    !pos ||
    !dragPreview?.widgetType ||
    !dragPreview.widgetConfig
  ) {
    return null
  }
  const gridRect = gridRectRef.current
  const cellWidth = gridRect ? gridRect.width / gridWidth : 100
  const cellHeight = gridRect ? gridRect.height / gridHeight : 100
  const padPx = dragPreview.padded === false ? 0 : GRID_WIDGET_PAD_PX
  const settleBox =
    settling &&
    settleLanded &&
    dragPreview.settleCell &&
    gridRect
      ? widgetDragGhostBox({
          gridRect,
          cell: dragPreview.settleCell,
          size: dragPreview.size,
          gridWidth,
          gridHeight,
          padPx,
        })
      : null
  const floating = dragGhostContentSize(
    cellWidth,
    cellHeight,
    dragPreview.size,
    padPx,
  )
  const left = settleBox?.x ?? pos.x
  const top = settleBox?.y ?? pos.y
  const width = settleBox?.width ?? floating.width
  const height = settleBox?.height ?? floating.height
  const widgetType = dragPreview.widgetType
  const WidgetComponent = widgetType.component
  const tileState = dragPreview.hasCollision
    ? 'is-blocked'
    : exiting
      ? 'is-exiting'
      : settling
        ? 'is-settling'
        : 'is-floating'
  return createPortal(
    <div
      className={`widget-grid-drag-ghost${
        settling ? ' is-settling' : ''
      }${exiting ? ' is-exiting' : ''}`}
      style={{ left, top }}
    >
      <div
        className={`widget-grid-drag-ghost-tile ${tileState}`}
        style={{ width, height }}
      >
        <Suspense fallback={null}>
          <RenderErrorBoundary
            source="widget"
            resetKey={widgetType.id}
            fallback={({ error }) => (
              <WidgetCrashFallback
                message={format(t.errors.widgetRenderFailed, {
                  id: widgetType.id,
                })}
                detail={widgetCrashDetail(error)}
              />
            )}
          >
            <WidgetComponent
              config={dragPreview.widgetConfig}
              isEditMode={false}
              isPreview={true}
            />
          </RenderErrorBoundary>
        </Suspense>
      </div>
    </div>,
    document.body,
  )
})
WidgetDragGhost.displayName = 'WidgetDragGhost'
