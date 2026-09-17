import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { RenderErrorBoundary } from './RenderErrorBoundary'

it('contains a throw, exposes the error, and remounts on retry or resetKey', async () => {
  const require = createRequire(import.meta.url)
  const { JSDOM } = require(
    require.resolve('jsdom', {
      paths: [require.resolve('isomorphic-dompurify')],
    }),
  )
  const dom = new JSDOM('<div id="root"></div>')
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  const root = createRoot(dom.window.document.getElementById('root')!)
  const originalError = console.error
  console.error = () => {}

  let shouldThrow = true
  function MaybeBoom() {
    if (shouldThrow) throw new Error('missing catalog')
    return createElement('span', null, 'ok')
  }

  function Harness({ resetKey }: { resetKey: string }) {
    return createElement(
      RenderErrorBoundary,
      {
        source: 'widget',
        resetKey,
        fallback: ({ error, reset }) =>
          createElement(
            'div',
            null,
            createElement('p', null, error?.message ?? 'failed'),
            createElement(
              'button',
              { type: 'button', onClick: reset },
              'retry',
            ),
          ),
      },
      createElement(MaybeBoom),
    )
  }

  try {
    await act(async () => {
      root.render(createElement(Harness, { resetKey: 'a' }))
    })
    assert.match(dom.window.document.body.textContent!, /missing catalog/)

    shouldThrow = false
    await act(async () => {
      dom.window.document.querySelector('button')!.click()
    })
    assert.match(dom.window.document.body.textContent!, /ok/)

    shouldThrow = true
    await act(async () => {
      root.render(createElement(Harness, { resetKey: 'a' }))
    })
    assert.match(dom.window.document.body.textContent!, /missing catalog/)

    shouldThrow = false
    await act(async () => {
      root.render(createElement(Harness, { resetKey: 'b' }))
    })
    assert.match(dom.window.document.body.textContent!, /ok/)
  } finally {
    await act(async () => root.unmount())
    console.error = originalError
    Object.assign(globalThis, {
      window: originalWindow,
      document: originalDocument,
    })
    dom.window.close()
  }
})
