import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

describe('widget library / grid boundary', () => {
  it('keeps the catalog island out of WidgetGrid', () => {
    const grid = readFileSync(new URL('./WidgetGrid.tsx', import.meta.url), 'utf8')
    assert.equal(grid.includes('WidgetLibraryIsland'), false)
    assert.equal(grid.includes('libraryVariant'), false)
    assert.equal(grid.includes('onToggleEditMode'), false)
    assert.equal(grid.includes("variant === 'default'"), false)
    assert.equal(grid.includes("variant === 'panel'"), false)
  })

  it('keeps library chrome CSS out of the grid stylesheet', () => {
    const gridCss = readFileSync(
      new URL('./WidgetGrid.css', import.meta.url),
      'utf8',
    )
    assert.equal(gridCss.includes('widget-library-island'), false)
    assert.ok(gridCss.includes('widget-grid-host'))
    assert.ok(gridCss.includes('widget-grid-drag-ghost'))
  })

  it('pages mount the dock island as a grid sibling', () => {
    const home = readFileSync(new URL('../views/Home.tsx', import.meta.url), 'utf8')
    const panel = readFileSync(
      new URL('./ControlPanel/ControlPanelWidgets.tsx', import.meta.url),
      'utf8',
    )
    assert.match(home, /<WidgetLibraryIsland/)
    assert.match(panel, /<WidgetLibraryIsland/)
    assert.equal(home.includes('variant="dock"'), false)
    assert.equal(home.includes('variant="panel"'), false)
    assert.equal(panel.includes('variant="dock"'), false)
    assert.equal(panel.includes('variant="panel"'), false)
    assert.equal(home.includes('libraryVariant'), false)
    assert.equal(panel.includes('libraryVariant'), false)
    assert.match(panel, /parkable=\{false\}/)
    assert.equal(home.includes('parkable={false}'), false)
  })

  it('does not dim the page while editing control-panel widgets', () => {
    const panel = readFileSync(
      new URL('./ControlPanel/ControlPanelWidgets.tsx', import.meta.url),
      'utf8',
    )
    assert.equal(panel.includes('backdrop-blur-sm'), false)
    assert.equal(panel.includes('bg-black/20'), false)
    assert.equal(panel.includes('createPortal'), false)
    assert.match(panel, /gcp-widget-edit/)
    const gcpCss = readFileSync(
      new URL('./GlobalControlPanel.css', import.meta.url),
      'utf8',
    )
    assert.match(gcpCss, /html\.gcp-widget-edit/)
  })
})
