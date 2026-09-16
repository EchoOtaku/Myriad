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
        data-testid="blank"
        style={{ position: 'fixed', right: 0, top: 0, width: 120, height: 120 }}
      />
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
