import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nNamespace } from '../../../contexts/I18nContext'
import { getDefaultLocale } from '../../../i18n'
import { loadShellLocale, loadShellNamespace } from '../../../i18n/loadLocale'
import { makeItem, makeSource } from '../logic/fixtures'
// CSS is exercised by the browser replay; Node measures the real component tree.
const css = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context)
  },
})
const { default: PhantasiList } = await import('./PhantasiList')
const { default: PhantasiNotes } = await import('./PhantasiNotes')
css.deregister()

// Use real Web Storage so metadata reads have the same semantics as the browser.
const require = createRequire(import.meta.url)
const { JSDOM } = require(
  require.resolve('jsdom', {
    paths: [require.resolve('isomorphic-dompurify')],
  }),
)
const dom = new JSDOM('', { url: 'https://test.invalid' })
const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: dom.window.localStorage,
})
after(() => {
  if (storage) Object.defineProperty(globalThis, 'localStorage', storage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
  dom.window.close()
})
await Promise.all([loadShellLocale(getDefaultLocale()), loadShellNamespace('phantasi', getDefaultLocale())])
function noop() {}

describe('large journal walls', () => {
  const items = Array.from({ length: 10_000 }, (_, index) =>
    makeItem({ id: index + 1 }),
  )
  for (const mode of ['notes', 'list'] as const) {
    it(`${mode}: first render has bounded DOM but keeps the full rail extent`, () => {
      const wall =
        mode === 'notes'
          ? createElement(PhantasiNotes, {
              sources: [makeSource({ source_type: 'note' })],
              notes: items,
              docs: [],
              onSourceClick: noop,
              onOpenItem: noop,
            })
          : createElement(PhantasiList, {
              items,
              selectedItem: null,
              loading: false,
              hasMore: false,
              total: items.length,
              onItemSelect: noop,
              onLoadMore: noop,
            })
      const html = renderToStaticMarkup(createElement(I18nNamespace, { names: ['phantasi'], children: wall }))
      const cards = [...html.matchAll(/data-rail-col=/g)]
      assert.ok(
        cards.length > 0 && cards.length < 64,
        `mounted ${cards.length} cards`,
      )
      assert.match(html, /--phantasi-story-cols:5000/)
    })
  }
})
