import assert from 'node:assert/strict'
import test from 'node:test'
import { BODY_PAGE_CHARS, BodyWriter } from './messageBody'

test('streaming a multi-megabyte body keeps only one preview in memory and preserves every page', async () => {
  const pages = new Map<number, string>()
  const store = { append: async (_id: string, text: string, offset: number) => {
    for (let i = 0; i < text.length; i++) { const at = offset + i; const page = Math.floor(at / BODY_PAGE_CHARS); pages.set(page, (pages.get(page) ?? '') + text[i]) }
  } }
  const writer = new BodyWriter('test', new AbortController().signal, store)
  const token = '界'.repeat(8192)
  for (let i = 0; i < 512; i++) {
    const result = await writer.append(token)
    assert.ok(result.content.length <= BODY_PAGE_CHARS)
    assert.ok(writer.retainedChars <= BODY_PAGE_CHARS)
  }
  assert.equal(writer.snapshot().body?.chars, 4194304)
  assert.equal([...pages.values()].join(''), token.repeat(512))
})

test('slow storage backpressures append and errors stop admission without an unbounded pending queue', async () => {
  const held = Promise.withResolvers<void>()
  const writer = new BodyWriter('test', new AbortController().signal, { append: () => held.promise })
  const pending = writer.append('x'.repeat(BODY_PAGE_CHARS + 1))
  await assert.rejects(writer.append('later'), /busy/)
  held.reject(new Error('disk full'))
  await assert.rejects(pending, /disk full/)
  assert.ok(writer.retainedChars <= BODY_PAGE_CHARS)
})
