import assert from 'node:assert/strict'
import { it } from 'node:test'
import { captureNoteAiSelection } from './noteAiSelection'
import { mountNoteHook } from './noteHookTestUtils'
import { markdownToVisualHtml } from './noteVisual'

it('cannot confuse normalized soft line breaks with another paragraph', async () => {
  const hook = await mountNoteHook(() => null, undefined)
  try {
    const source = 'hello\nworld\n\nhello world'
    const root = document.createElement('div')
    root.innerHTML = markdownToVisualHtml(source)
    document.body.append(root)
    const range = document.createRange()
    range.selectNodeContents(root.firstElementChild!)
    document.getSelection()!.addRange(range)
    const captured = captureNoteAiSelection(source, 'visual', null, root)
    assert.ok(captured.unavailable || (captured.selection?.start === 0 && captured.selection.end <= 11))
  } finally { await hook.close() }
})

it('uses the actual paragraph position for repeated visual text', async () => {
  const hook = await mountNoteHook(() => null, undefined)
  try {
    const source = '重复\n\n重复'
    const root = document.createElement('div')
    root.innerHTML = markdownToVisualHtml(source)
    document.body.append(root)
    const range = document.createRange()
    range.setStart(root.children[1].firstChild!, 0)
    range.setEnd(root.children[1].firstChild!, 1)
    document.getSelection()!.addRange(range)
    assert.deepEqual(captureNoteAiSelection(source, 'visual', null, root), { selection: { start: 4, end: 5 }, unavailable: false })
  } finally { await hook.close() }
})
