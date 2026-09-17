import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import WidgetLibraryIsland from '../../../src/components/WidgetLibraryIsland'
import { I18nProvider, useI18n } from '../../../src/contexts/I18nContext'
import { useEditModeEscape } from '../../../src/hooks/useEditModeEscape'
import { ensureMotionReady } from '../../../src/lib/lazyMotion'
import { setWidgetDragCursor } from '../../../src/utils/widgetDragCursor'

function Fixture() {
  const { t } = useI18n()
  const [editing, setEditing] = useState(true)
  useEditModeEscape(editing, () => setEditing(false), t.home.exitEditConfirm)
  return (
    <>
      <output data-testid="editing">{String(editing)}</output>
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
        <div data-testid="blank" style={{ position: 'absolute', inset: 0 }} />
        <button
          className="widget-grid-item"
          data-testid="widget"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 60,
            height: 60,
          }}
        >
          Widget
        </button>
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
