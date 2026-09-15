import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('content Io abort', () => {
  it('导入导出吃同一条 turn signal', () => {
    const io = readFileSync(join(dir, 'contentIo/contentIo.ts'), 'utf8')
    const hook = readFileSync(join(dir, 'useNoteTransfer.ts'), 'utf8')
    assert.match(
      io,
      /export async function exportTransferFile\([\s\S]*signal\?: AbortSignal/,
    )
    assert.match(
      io,
      /export async function importTransferFile\([\s\S]*signal\?: AbortSignal/,
    )
    assert.match(io, /if \(signal\?\.aborted\) break/)
    assert.match(hook, /getNoteDoc\(doc\.id, signal\)/)
    assert.match(
      hook,
      /exportTransferFile\(\s*kind,\s*full,\s*copyRef\.current,\s*signal/,
    )
    assert.match(hook, /importTransferFile\([\s\S]*signal,\s*\)/)
    assert.match(hook, /RequestTurn/)
    assert.doesNotMatch(hook, /from ['"]\.\.\/skin/)
  })
})
