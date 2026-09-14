import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import { decorateNoteReadSurface } from './noteReadSurface.ts'

const require = createRequire(import.meta.url)
const { JSDOM } = require(
  require.resolve('jsdom', {
    paths: [require.resolve('isomorphic-dompurify')],
  }),
)

describe('decorateNoteReadSurface DOM', () => {
  it('外链和代码加外壳，正文小组件里面的图链代码不动', () => {
    const dom = new JSDOM(
      `<div>
        <p><a href="https://example.com">外</a> <a href="#note-fn-1">脚</a></p>
        <pre><code class="language-rust">fn a() {}</code></pre>
        <div class="note-widget not-prose" data-widget="quote">
          <a href="https://inside.example">内链</a>
          <pre><code class="language-js">ok</code></pre>
          <img src="https://x.y/p.png">
        </div>
        <img src="https://x.y/cover.png">
      </div>`,
    )
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: dom.window.document,
    })
    const root = dom.window.document.body.firstElementChild as HTMLElement
    try {
      decorateNoteReadSurface(root, 'Copy')
    } finally {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
      else delete (globalThis as { document?: unknown }).document
    }

    const outer = root.querySelector('p a[href="https://example.com"]') as HTMLAnchorElement
    const hash = root.querySelector('a[href="#note-fn-1"]') as HTMLAnchorElement
    const inner = root.querySelector('.note-widget a') as HTMLAnchorElement
    assert.equal(outer.target, '_blank')
    assert.equal(outer.rel, 'noopener noreferrer')
    assert.equal(hash.target, '')
    assert.equal(inner.target, '')

    assert.equal(root.querySelectorAll('.code-block-wrapper').length, 1)
    const wrapper = root.querySelector('.code-block-wrapper') as HTMLElement
    assert.equal(wrapper.dataset.lang, 'rust')
    assert.equal(root.querySelector('.note-widget .code-block-wrapper'), null)

    const cover = root.querySelector('img[src="https://x.y/cover.png"]') as HTMLImageElement
    const widgetImg = root.querySelector('.note-widget img') as HTMLImageElement
    assert.equal(cover.dataset.sizeProcessed, 'true')
    assert.ok(cover.classList.contains('rounded-xl'))
    assert.equal(widgetImg.dataset.sizeProcessed, undefined)
  })
})
