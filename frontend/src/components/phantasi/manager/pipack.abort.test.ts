import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('pipack abort', () => {
  it('export and import take the pack turn signal', () => {
    const io = readFileSync(join(dir, 'pipackIo.ts'), 'utf8')
    const hook = readFileSync(join(dir, 'usePipack.ts'), 'utf8')
    const api = readFileSync(join(dir, '../../../services/phantasiApi.ts'), 'utf8')
    assert.match(
      io,
      /export async function exportPipackFile\([\s\S]*signal\?: AbortSignal/,
    )
    assert.match(
      io,
      /export async function importPipackFile\([\s\S]*signal\?: AbortSignal/,
    )
    assert.match(io, /if \(signal\?\.aborted\) break/)
    assert.match(hook, /exportPipackFile\(sources, copyRef\.current, signal\)/)
    assert.match(hook, /importPipackFile\([\s\S]*signal,\s*\)/)
    assert.match(hook, /exportOpmlFile\(signal\)/)
    assert.match(
      io,
      /export async function exportOpmlFile\(signal\?: AbortSignal\)/,
    )
    assert.match(
      api,
      /export async function getCategories\([\s\S]*options\?: \{ signal\?: AbortSignal \}/,
    )
    assert.match(
      api,
      /export async function listRsshubInstances\([\s\S]*options\?: \{ signal\?: AbortSignal \}/,
    )
  })
})
