import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { captureNoteSelection, restoreNoteSelection } from './noteRemoteSelection.ts'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))

function editor(html: string) {
  const dom = new JSDOM('<button>Other</button><div contenteditable="true" tabindex="0"></div>')
  const root = dom.window.document.querySelector('div') as HTMLDivElement
  root.innerHTML = html
  root.focus()
  const selection = dom.window.getSelection() as Selection
  return { root, selection }
}

test('remote prepended paragraph preserves a backward selection within formatted text', () => {
  const { root, selection } = editor('<p>First</p><p>Hello <b>world</b>!</p>')
  selection.setBaseAndExtent(root.querySelector('b')!.firstChild!, 4, root.lastChild!.firstChild!, 2)
  const saved = captureNoteSelection(root)
  root.innerHTML = '<p>Remote</p><p>First</p><p>Hello <b>world</b>!</p>'
  restoreNoteSelection(root, saved)
  assert.equal(selection.anchorNode?.textContent, 'world')
  assert.equal(selection.anchorOffset, 4)
  assert.equal(selection.focusNode?.textContent, 'Hello ')
  assert.equal(selection.focusOffset, 2)
})

test('insertion within the selected block follows the unchanged suffix', () => {
  const { root, selection } = editor('<p>before</p><p>Hello world</p><p>after</p>')
  selection.setBaseAndExtent(root.children[1].firstChild!, 8, root.children[1].firstChild!, 8)
  const saved = captureNoteSelection(root)
  root.innerHTML = '<p>New block</p><p>before</p><p>Hello beautiful world</p><p>after</p>'
  restoreNoteSelection(root, saved)
  assert.equal(selection.anchorNode?.textContent, 'Hello beautiful world')
  assert.equal(selection.anchorOffset, 18)
})

test('duplicate blocks choose the closest index', () => {
  const { root, selection } = editor('<p>same</p><p>middle</p><p>same</p>')
  selection.setBaseAndExtent(root.lastChild!.firstChild!, 2, root.lastChild!.firstChild!, 2)
  const saved = captureNoteSelection(root)
  root.innerHTML = '<p>same</p><p>middle changed</p><p>same</p>'
  restoreNoteSelection(root, saved)
  assert.equal(selection.anchorNode?.parentNode, root.lastChild)
  assert.equal(selection.anchorOffset, 2)
})

test('inactive editors do not capture or reclaim focus', () => {
  const { root, selection } = editor('<p>Hello</p>')
  selection.setBaseAndExtent(root.firstChild!.firstChild!, 2, root.firstChild!.firstChild!, 2)
  const saved = captureNoteSelection(root)
  const other = root.ownerDocument.querySelector('button')!
  other.focus()
  assert.equal(captureNoteSelection(root), null)
  root.innerHTML = '<p>Remote</p>'
  restoreNoteSelection(root, saved)
  assert.equal(root.ownerDocument.activeElement, other)
})
