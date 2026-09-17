import type {
  WidgetComponentProps,
  WidgetType,
} from '../../../src/components/widgetGridTypes'
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WidgetGridItem } from '../../../src/components/WidgetGridItem'
import WidgetLibraryIsland from '../../../src/components/WidgetLibraryIsland'
import { I18nProvider, useI18n } from '../../../src/contexts/I18nContext'
import { useEditModeEscape } from '../../../src/hooks/useEditModeEscape'
import { ensureMotionReady } from '../../../src/lib/lazyMotion'
import { setWidgetDragCursor } from '../../../src/utils/widgetDragCursor'

const SETTINGS_OPEN_EVENT = 'test:widget-settings-open'

function BubbleSettingsWidget({ isEditMode }: WidgetComponentProps) {
  const timerRef = useRef<number | null>(null)
  const clearPress = () => {
    if (timerRef.current == null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => clearPress, [])

  return (
    <div
      data-testid="widget"
      style={{ width: '100%', height: '100%', background: '#ddd' }}
      onMouseDown={() => {
        if (!isEditMode) return
        clearPress()
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          window.dispatchEvent(new Event(SETTINGS_OPEN_EVENT))
        }, 500)
      }}
      onMouseUp={clearPress}
      onMouseLeave={clearPress}
    >
      Widget
    </div>
  )
}

const widgetType: WidgetType = {
  id: 'settings-widget',
  name: 'Settings widget',
  defaultSize: '2x2',
  component: BubbleSettingsWidget,
  supportedSizes: ['2x2'],
  componentLongPress: true,
}

function Fixture() {
  const { t } = useI18n()
  const [editing, setEditing] = useState(true)
  const [dragStarts, setDragStarts] = useState(0)
  const [dragGrab, setDragGrab] = useState('')
  const [settingsOpens, setSettingsOpens] = useState(0)
  const [held, setHeld] = useState(false)
  useEditModeEscape(editing, () => setEditing(false), t.home.exitEditConfirm)

  useEffect(() => {
    const onOpen = () => setSettingsOpens((count) => count + 1)
    window.addEventListener(SETTINGS_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(SETTINGS_OPEN_EVENT, onOpen)
  }, [])

  return (
    <>
      <output data-testid="editing">{String(editing)}</output>
      <output data-testid="drag-starts">{dragStarts}</output>
      <output data-testid="drag-grab">{dragGrab}</output>
      <output data-testid="settings-opens">{settingsOpens}</output>
      <div
        data-testid="outside"
        style={{ position: 'fixed', right: 0, top: 0, width: 120, height: 120 }}
      />
      <div
        className="widget-grid-container edit-mode"
        style={{
          position: 'fixed',
          right: 0,
          top: 140,
          width: 240,
          height: 180,
        }}
      >
        <div
          data-testid="blank"
          style={{ position: 'absolute', inset: 0, zIndex: 0 }}
        />
        {!held ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 60,
              height: 90,
              zIndex: 1,
            }}
          >
            <WidgetGridItem
              widget={{
                id: 'settings-widget-1',
                type: widgetType.id,
                size: '2x2',
                position: { x: 0, y: 0 },
              }}
              widgetType={widgetType}
              isEditMode
              isHovered={false}
              onDragStart={(start) => {
                setDragStarts((count) => count + 1)
                setDragGrab(
                  `${start.grab.x.toFixed(2)},${start.grab.y.toFixed(2)}`,
                )
                setHeld(true)
              }}
              onMouseEnter={() => {}}
              onMouseLeave={() => {}}
              onRemove={() => {}}
              onResizeStart={() => {}}
              gridWidth={2}
              gridHeight={2}
              layoutMotion={false}
            />
          </div>
        ) : null}
      </div>
      <div
        data-library-dock-chrome
        style={{ position: 'fixed', right: 0, bottom: 0 }}
      >
        <button onClick={() => setEditing(true)}>Edit</button>
        <button onClick={() => setWidgetDragCursor({ x: 100, y: 100 })}>
          Start drag
        </button>
        <button onClick={() => setWidgetDragCursor(null)}>End drag</button>
        <input
          aria-label="Inner editor"
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.preventDefault()
          }}
        />
      </div>
      <WidgetLibraryIsland
        visible={editing}
        availableWidgets={[]}
        onNewWidgetDragStart={() => {}}
      />
    </>
  )
}

async function mount() {
  await ensureMotionReady()
  createRoot(document.getElementById('root')!).render(
    <I18nProvider>
      <Fixture />
    </I18nProvider>,
  )
}
void mount()
