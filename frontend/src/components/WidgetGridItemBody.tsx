import type { WidgetConfig, WidgetType } from './widgetGridTypes'
import React, { Suspense, useCallback, useLayoutEffect, useRef } from 'react'

const WidgetGridItemContent = React.memo(
  ({
    widget,
    widgetType,
    isEditMode,
    isPreview,
    onConfigChange,
  }: {
    widget: WidgetConfig
    widgetType: WidgetType
    isEditMode: boolean
    isPreview?: boolean
    onConfigChange?: (newConfig: any) => void
  }) => {
    const WidgetComponent = widgetType.component
    return (
      <Suspense fallback={null}>
        <WidgetComponent
          config={widget}
          isEditMode={isEditMode}
          isPreview={isPreview}
          onConfigChange={onConfigChange}
        />
      </Suspense>
    )
  },
  (prev, next) =>
    prev.widget.id === next.widget.id &&
    prev.widget.type === next.widget.type &&
    prev.widget.size === next.widget.size &&
    prev.widget.config === next.widget.config &&
    prev.isEditMode === next.isEditMode &&
    prev.isPreview === next.isPreview &&
    prev.widgetType === next.widgetType &&
    prev.onConfigChange === next.onConfigChange,
)

/** Keep callback ownership current without repainting content on every grid move. */
export function WidgetGridItemBody(props: React.ComponentProps<typeof WidgetGridItemContent>) {
  const callback = useRef(props.onConfigChange)
  useLayoutEffect(() => { callback.current = props.onConfigChange }, [props.onConfigChange])
  const forwardConfigChange = useCallback((value: unknown) => callback.current?.(value), [])
  return (
    <WidgetGridItemContent
      {...props}
      onConfigChange={props.onConfigChange ? forwardConfigChange : undefined}
    />
  )
}
