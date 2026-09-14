import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('BatchCategoryPick', () => {
  it('没勾选也能打开下拉，空名单不把控件整段禁用', () => {
    const src = readFileSync(join(dir, 'BatchCategoryPick.tsx'), 'utf8')
    const admin = readFileSync(join(dir, 'manager/BrewWorkbenchAdmin.tsx'), 'utf8')
    const skin = readFileSync(join(dir, 'skin/BrewWorkbench.tsx'), 'utf8')
    const list = readFileSync(
      join(dir, '../settings/ManagedList.tsx'),
      'utf8',
    )
    assert.match(src, /<FieldSelect/)
    assert.match(src, /searchable/)
    assert.doesNotMatch(src, /names\.length === 0/)
    assert.doesNotMatch(admin, /sourceSelect\.picked === 0/)
    assert.doesNotMatch(skin, /notesSelect\.picked === 0/)
    assert.match(list, /managed-list-filter-tools/)
    assert.match(list, /toolbarExtra/)
  })
})
