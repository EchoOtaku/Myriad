import type { CommentItem } from '../../../services/phantasiApi'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import {
  commentAnchorStale,
  cssCustomHighlightAvailable,
  paintAnchoredAnnotations,
  paintAnchoredComments,
  resolveCommentAnchor,
} from './commentAnchors'

const require = createRequire(import.meta.url)
const { JSDOM } = require(
  require.resolve('jsdom', {
    paths: [require.resolve('isomorphic-dompurify')],
  }),
)

it('treats a comment as stale only when both sides have a version and they differ', () => {
  assert.equal(commentAnchorStale({}, 3), false)
  assert.equal(commentAnchorStale({ content_revision: 3 }, 3), false)
  assert.equal(commentAnchorStale({ content_revision: 2 }, 3), true)
  assert.equal(commentAnchorStale({ content_revision: 2 }, undefined), false)
})

it('uses offsets and context to distinguish repeated text without guessing ambiguous legacy anchors', () => {
  const text = 'first word; second word'
  assert.equal(
    resolveCommentAnchor(text, {
      selected_text: 'word',
      start_offset: 19,
      end_offset: 23,
    }),
    19,
  )
  assert.equal(
    resolveCommentAnchor(text, {
      selected_text: 'word',
      start_offset: 6,
      context_before: 'second ',
    }),
    19,
  )
  assert.equal(resolveCommentAnchor(text, { selected_text: 'word' }), null)
  assert.equal(resolveCommentAnchor(text, { selected_text: 'missing' }), null)
})

it('highlights a cross-tag quote once, preserves markup and excludes media text', () => {
  const live = new JSDOM(
    '<p>one <em>two</em> then one two</p><div class="phantasi-embed-card">media text</div>',
  )
  const root = live.window.document.body
  paintAnchoredComments(
    root,
    [
      { id: 1, selected_text: 'one two', start_offset: 0, end_offset: 7 },
      { id: 2, selected_text: 'two', start_offset: 4, end_offset: 7 },
      { id: 3, selected_text: 'media text' },
    ] as CommentItem[],
    'light',
  )
  assert.equal(root.textContent, 'one two then one twomedia text')
  assert.equal(
    Iterator.from(root.querySelectorAll('[data-comment-id="1"]'))
      .map((mark: Element) => mark.textContent)
      .toArray()
      .join(''),
    'one two',
  )
  assert.equal(root.querySelector('em [data-comment-id="2"]')?.textContent, 'two')
  assert.equal(root.querySelector('[data-comment-id="3"]'), null)
  assert.equal(root.querySelector('p')?.lastChild?.textContent, ' then one two')
  live.window.close()

  const widgeted = new JSDOM(
    '<p>articlequote</p><div class="note-widget" data-widget="quote">widgetquote</div>',
  )
  paintAnchoredComments(
    widgeted.window.document.body,
    [
      { id: 8, selected_text: 'articlequote' },
      { id: 9, selected_text: 'widgetquote' },
    ] as CommentItem[],
    'light',
  )
  assert.equal(
    widgeted.window.document.querySelector('[data-comment-id="8"]')?.textContent,
    'articlequote',
  )
  assert.equal(
    widgeted.window.document.querySelector('.note-widget [data-comment-id="9"]'),
    null,
  )
  widgeted.window.close()
})

it('annotates a unique term with the comment index and skips repeats and media', () => {
  const live = new JSDOM(
    '<p>alpha <em>term</em> later term</p><div class="phantasi-embed-card">solo</div>',
  )
  const root = live.window.document.body
  paintAnchoredAnnotations(root, [
    { type: 'term', term: 'term', explanation: 'n', position: 6 },
    { type: 'term', term: 'solo', explanation: 'media' },
    { type: 'term', term: 'missing', explanation: 'no' },
  ])
  assert.equal(root.querySelector('em .phantasiai-annotation')?.textContent, 'term')
  assert.equal(root.querySelectorAll('.phantasiai-annotation').length, 1)
  assert.equal(root.querySelector('.phantasi-embed-card .phantasiai-annotation'), null)
  live.window.close()

  const widgeted = new JSDOM(
    '<p>articlequote</p><div class="note-widget" data-widget="quote">widgetquote</div>',
  )
  paintAnchoredAnnotations(widgeted.window.document.body, [
    { type: 'term', term: 'articlequote', explanation: 'n' },
    { type: 'term', term: 'widgetquote', explanation: 'n' },
  ])
  assert.equal(
    widgeted.window.document.querySelector('p .phantasiai-annotation')?.textContent,
    'articlequote',
  )
  assert.equal(
    widgeted.window.document.querySelector('.note-widget .phantasiai-annotation'),
    null,
  )
  widgeted.window.close()

  assert.equal(typeof cssCustomHighlightAvailable(), 'boolean')
  const ambiguous = new JSDOM('<p>term then term</p>')
  paintAnchoredAnnotations(ambiguous.window.document.body, [
    { type: 'term', term: 'term', explanation: 'n' },
  ])
  assert.equal(ambiguous.window.document.querySelector('.phantasiai-annotation'), null)
  ambiguous.window.close()
})

it('paints comment marks on a live tree without serializing the article', () => {
  const live = new JSDOM(
    '<p>one <em>two</em> then one two</p><div class="phantasi-embed-card">media text</div>',
  )
  paintAnchoredComments(
    live.window.document.body,
    [
      { id: 1, selected_text: 'one two', start_offset: 0, end_offset: 7 },
      { id: 3, selected_text: 'media text' },
    ] as CommentItem[],
    'light',
  )
  assert.equal(
    Iterator.from(live.window.document.querySelectorAll('[data-comment-id="1"]'))
      .map((mark: Element) => mark.textContent)
      .toArray()
      .join(''),
    'one two',
  )
  assert.equal(
    live.window.document.querySelector('.phantasi-embed-card [data-comment-id]'),
    null,
  )
  live.window.close()
})

it('repainting comments keeps text fragments bounded and traverses the text tree once per batch', () => {
  const dom = new JSDOM('<p>before highlighted after</p>')
  const root = dom.window.document.body
  const comments = [{ id: 1, selected_text: 'highlighted' }, { id: 2, selected_text: 'light' }] as CommentItem[]
  let walks = 0
  const createWalker = root.ownerDocument.createTreeWalker.bind(root.ownerDocument)
  root.ownerDocument.createTreeWalker = (...args: Parameters<Document['createTreeWalker']>) => { walks++; return createWalker(...args) }
  for (let i = 0; i < 100; i++) paintAnchoredComments(root, comments, 'light')
  const walker = createWalker(root, 4)
  let nodes = 0
  while (walker.nextNode()) nodes++
  assert.ok(nodes <= 7, `retained ${nodes} text nodes`)
  assert.equal(walks, 100)
  dom.window.close()
})

it('keeps the selected quote and media element when normalizing old marks', () => {
  const dom = new JSDOM('<p>before highlighted after</p><video></video>')
  const root = dom.window.document.body
  const comments = [{ id: 1, selected_text: 'highlighted' }] as CommentItem[]
  paintAnchoredComments(root, comments, 'light')
  const video = root.querySelector('video')
  const range = dom.window.document.createRange()
  range.selectNodeContents(root.querySelector('mark'))
  dom.window.getSelection().addRange(range)
  paintAnchoredComments(root, [], 'dark')
  assert.equal(dom.window.getSelection().toString(), 'highlighted')
  assert.equal(root.querySelector('video'), video)
  dom.window.close()
})
