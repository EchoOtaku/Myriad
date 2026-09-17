import assert from 'node:assert/strict'
import { it } from 'node:test'
import { trimVisualHistory, VISUAL_UNDO_BYTE_LIMIT } from './noteVisualHistory'

it('bounds undo and redo snapshots together by UTF-16 bytes', () => {
  const history = { past: Array.from({ length: 200 }, () => 'a'.repeat(100_000)), future: ['b'.repeat(100_000)] }
  trimVisualHistory(history)
  assert.ok([...history.past, ...history.future].reduce((sum, text) => sum + text.length * 2, 0) <= VISUAL_UNDO_BYTE_LIMIT)
  assert.equal(history.future.length, 1)
})
