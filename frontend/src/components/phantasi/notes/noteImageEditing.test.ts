import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import * as visual from './noteVisual'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
function fixture(html: string) {
  const dom = new JSDOM(`<div id="editor">${html}</div>`)
  const root = dom.window.document.getElementById('editor') as HTMLElement
  return { root, img: root.querySelector('img')!, close: () => dom.window.close() }
}
it('changing a reference image source persists the new address and retains its click destination', () => {
  const f = fixture('<p><a href="https://site.test/page"><img src="/old.png" data-linkref="cover" alt="Cover"></a></p>')
  try {
    const md = visual.setImageSrc(f.root, f.img, '/new.png')
    assert.equal(md, '[![Cover](/new.png)](https://site.test/page)')
    assert.match(visual.markdownToVisualHtml(md), /href="https:\/\/site.test\/page"/)
  } finally { f.close() }
})
it('a linked image round trips through rich text with independent source and destination', () => {
  const md = '[![Cover](/image.png)](https://site.test/page)'
  assert.equal(visual.visualHtmlToMarkdown(visual.markdownToVisualHtml(md)), md)
})
it('editing and clearing only the image link preserves neighboring linked text', () => {
  const f = fixture('<p><a href="/old">Before <img src="/image.png" alt="Cover"> After</a></p>')
  try {
    assert.equal(typeof visual.setImageLink, 'function')
    const changed = visual.setImageLink(f.root, f.img, '/new')
    assert.match(changed, /\[!\[Cover\]\(\/image.png\)\]\(\/new\)/)
    assert.equal(f.img.closest('a')?.getAttribute('href'), '/new')
    assert.equal(f.root.querySelector('a')?.getAttribute('href'), '/old')
    visual.setImageLink(f.root, f.img, '')
    assert.equal(f.img.closest('a'), null)
    assert.equal(f.img.getAttribute('src'), '/image.png')
    assert.equal(f.root.textContent, 'Before  After')
  } finally { f.close() }
})

it('changing an image destination preserves adjacent hard line breaks', () => {
  const f = fixture('<p><a href="/old"><br><img src="/image.png" alt="Cover"><br></a></p>')
  try {
    visual.setImageLink(f.root, f.img, '/new')
    assert.equal(f.root.querySelectorAll('br').length, 2)
  } finally { f.close() }
})
