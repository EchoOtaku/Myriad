import assert from 'node:assert/strict'
import test from 'node:test'
import { historyStart, revealEarlierHistory } from './conversationHistory'

test('long history initially mounts only its latest page, then every older message remains reachable', () => {
  const ids = Array.from({ length: 10003 }, (_, i) => String(i))
  let start = historyStart(ids.length)
  assert.ok(ids.slice(start).length <= 40)
  assert.equal(ids.slice(start).at(-1), '10002')
  let reached = ids.length - start
  while (start > 0) {
    const previous = start
    start = revealEarlierHistory(start)
    assert.ok(start < previous)
    assert.ok(previous - start <= 40)
    reached += previous - start
  }
  assert.equal(reached, ids.length)
  assert.equal(revealEarlierHistory(0), 0)
  assert.equal(historyStart(3), 0)
})

test('the live window follows new messages without accumulating DOM rows', async () => {
  const { conversationWindow } = await import('./conversationHistory')
  const first = conversationWindow(0, 10000)
  assert.ok(first.end - first.start <= 80)
  const older = conversationWindow(100, 10000)
  assert.equal(older.start, 100)
  assert.ok(older.end - older.start <= 80)
})
