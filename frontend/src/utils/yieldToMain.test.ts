import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { it } from 'node:test'

it('yieldToMain releases its message ports after the scheduled task finishes', () => {
  const module = new URL('./yieldToMain.ts', import.meta.url).href
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { yieldToMain } from ${JSON.stringify(module)}; await yieldToMain();`], { timeout: 5000, encoding: 'utf8' })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
})
