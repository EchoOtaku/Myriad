import assert from 'node:assert/strict'
import test from 'node:test'
import { SummaryTextStream } from './summaryTextStream'

test('splits a long thought and partial action markers without retaining the transcript', () => {
  const parser = new SummaryTextStream()
  let content = ''; let thought = ''
  const input = `<think>${'reason'.repeat(20000)}</think>Hello [[wear:stage]]world⟦wear:daily⟧![[music:play]]`
  for (let i = 0; i < input.length; i += 3) {
    const result = parser.push(input.slice(i, i + 3))
    content += result.content; thought += result.thought
    assert.ok(parser.retainedChars < 10)
  }
  const end = parser.push('', true)
  assert.equal(content + end.content, 'Hello world!')
  assert.equal(thought + end.thought, 'reason'.repeat(20000))
})

test('thought boundaries do not merge words in the visible reply', () => {
  assert.equal(new SummaryTextStream().push('Before<think>private</think>After', true).content, 'Before\n\nAfter')
})
