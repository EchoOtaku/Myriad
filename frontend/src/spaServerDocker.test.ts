import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

describe('spa-server Docker runtime closure', () => {
  it('keeps the image script tree complete', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const check = path.join(repoRoot, 'docker/check-frontend-runtime.mjs')
    const result = spawnSync(process.execPath, [check], {
      encoding: 'utf8',
      cwd: repoRoot,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout || 'check-frontend-runtime failed')
  })
})
