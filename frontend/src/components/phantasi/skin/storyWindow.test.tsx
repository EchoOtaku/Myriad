import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getDefaultLocale } from '../../../i18n'
import { loadLocale } from '../../../i18n/loadLocale'
import { makeItem, makeSource } from '../logic/fixtures'
// CSS is exercised by the browser replay; Node measures the real component tree.
const css = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context)
  },
})
const { default: PhantasiList } = await import('./PhantasiList')
const { default: PhantasiNotes } = await import('./PhantasiNotes')
css.deregister()
await loadLocale(getDefaultLocale())

const noop = () => {}

describe('large journal walls', () => {
  const items = Array.from({ length: 10_000 }, (_, index) => makeItem({ id: index + 1 }))
  for (const mode of ['notes', 'list'] as const) {
    it(`${mode}: first render has bounded DOM but keeps the full rail extent`, () => {
      const wall = mode === 'notes'
        ? createElement(PhantasiNotes, {
            sources: [makeSource({ source_type: 'note' })], notes: items, docs: [],
            onSourceClick: noop, onOpenItem: noop,
          })
        : createElement(PhantasiList, {
            items, selectedItem: null, loading: false, hasMore: false, total: items.length,
            onItemSelect: noop, onLoadMore: noop,
          })
      const html = renderToStaticMarkup(wall)
      const cards = [...html.matchAll(/data-rail-col=/g)]
      assert.ok(cards.length > 0 && cards.length < 64, `mounted ${cards.length} cards`)
      assert.match(html, /--phantasi-story-cols:5000/)
    })
  }
})
