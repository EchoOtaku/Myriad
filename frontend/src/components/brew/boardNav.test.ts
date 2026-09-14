import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'boardNav.tsx'),
  'utf8',
)

describe('brewBoardNavItems', () => {
  it('工作台只在管理员选项里出现，id 是 workbench', () => {
    assert.match(src, /includeWorkbench/)
    assert.match(src, /id: 'workbench'/)
    assert.doesNotMatch(src, /id: 'settings'/)
  })
})
