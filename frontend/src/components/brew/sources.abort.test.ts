import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('source catalog abort', () => {
  it('getSources and getStats bypass shared pending when given a signal', () => {
    const api = readFileSync(join(dir, '../../services/brewApi.ts'), 'utf8')
    assert.match(
      api,
      /export async function getSources\([\s\S]*options\?: \{ signal\?: AbortSignal \}/,
    )
    assert.match(
      api,
      /export async function getStats\([\s\S]*options\?: \{ signal\?: AbortSignal \}/,
    )
    assert.match(api, /if \(options\?\.signal\) \{\s*const sources = await fetchSources/)
    assert.match(api, /if \(options\?\.signal\) \{\s*const stats = await fetchStats/)
  })

  it('catalog load aborts on unmount and retarget', () => {
    const src = readFileSync(join(dir, 'useBrewSources.ts'), 'utf8')
    assert.match(src, /getSources\(undefined, \{ signal \}\)/)
    assert.match(src, /getStats\(undefined, \{ signal \}\)/)
    assert.match(src, /sourceTurns\.current\.cancel\(\)/)
    assert.match(src, /statsTurns\.current\.cancel\(\)/)
  })
})
