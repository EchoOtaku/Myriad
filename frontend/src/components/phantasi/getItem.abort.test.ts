import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const phantasiDir = dirname(fileURLToPath(import.meta.url))

function listTs(dir: string): string[] {
  const names: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      names.push(...listTs(path))
      continue
    }
    if (!/\.(ts|tsx)$/.test(name) || name.includes('.test.')) continue
    names.push(path)
  }
  return names
}

describe('phantasi getItem abort', () => {
  it('callers pass a signal except the phantasiApi definition', () => {
    const hits: string[] = []
    for (const path of listTs(phantasiDir)) {
      const src = readFileSync(path, 'utf8')
      const stripped = src
        .replaceAll(/\/\*[\s\S]*?\*\//g, '')
        .replaceAll(/\/\/.*$/gm, '')
        .replaceAll(/(?:globalThis\.)?(?:local|session)Storage\??\.getItem\(/g, 'storageGet(')
        .replaceAll(/\bstorage\.getItem\(/g, 'storageGet(')
      for (const match of stripped.matchAll(/(?:phantasiApi\.)?getItem\([^,)\n]+\)/g)) {
        hits.push(`${path.slice(phantasiDir.length + 1)}: ${match[0]}`)
      }
    }
    assert.deepEqual(hits, [])
  })
})
