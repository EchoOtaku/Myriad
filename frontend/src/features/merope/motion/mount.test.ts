import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('live faces share one motion owner; workbench preview stays isolated', () => {
  const panel = readFileSync(
    new URL(
      '../../../components/agent-panel/AgentPanelFace.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  const widget = readFileSync(
    new URL('../../../components/widgets/MeropeWidget.tsx', import.meta.url),
    'utf8',
  )
  const studio = readFileSync(
    new URL('../SiteMotionWorkbench.tsx', import.meta.url),
    'utf8',
  )
  const workbench = readFileSync(
    new URL('../anime25drig/Anime25DWorkbench.tsx', import.meta.url),
    'utf8',
  )

  assert.match(panel, /useRigMotionLifecycle/)
  assert.doesNotMatch(panel, /useRigSingingLifecycle/)
  assert.match(widget, /useRigMotionLifecycle/)
  assert.doesNotMatch(widget, /speechOccupancyRef/)
  assert.match(studio, /useRigPreviewMotionLifecycle/)
  assert.doesNotMatch(studio, /useRigSingingLifecycle/)
  assert.match(workbench, /replaceDriver/)
  assert.doesNotMatch(workbench, /useRigMotionLifecycle/)
  assert.doesNotMatch(workbench, /useRigSingingLifecycle/)
  const lifecycle = readFileSync(
    new URL('./useRigMotionLifecycle.ts', import.meta.url),
    'utf8',
  )
  assert.match(lifecycle, /applyMotionFrame/)
  assert.match(lifecycle, /createPreviewMotionRuntime/)
})
