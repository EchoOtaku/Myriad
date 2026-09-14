import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('BrewWorkbenchAdmin', () => {
  it('工作台管理面接手添加、RSSHub、订阅列表和 OPML', () => {
    const src = readFileSync(join(dir, 'BrewWorkbenchAdmin.tsx'), 'utf8')
    const page = readFileSync(join(dir, '../../../views/Brew.tsx'), 'utf8')
    assert.match(src, /<AddMode/)
    assert.match(src, /<RSSHubInstances/)
    assert.match(src, /<EditSourceMode/)
    assert.match(src, /onRefreshSource/)
    assert.match(src, /query\?: string/)
    assert.match(src, /onRemoveSources/)
    assert.doesNotMatch(src, /search=\{\{/)
    assert.doesNotMatch(src, /key: 'refresh-all'/)
    assert.match(src, /filterGroups/)
    assert.match(src, /collectWorkbenchSourceCategories/)
    assert.match(src, /collectWorkbenchSourceKinds/)
    assert.match(src, /sourceTypeLabel/)
    assert.match(src, /brew\.category/)
    assert.doesNotMatch(src, /workbenchSourceBoard/)
    assert.doesNotMatch(src, /未分类/)
    assert.match(src, /workbench-sources/)
    assert.match(src, /workbench-add/)
    assert.match(src, /workbench-rsshub/)
    assert.match(src, /workbench-opml/)
    assert.doesNotMatch(src, /formOpen/)
    assert.match(page, /BrewWorkbenchAdmin/)
    assert.match(page, /useNoteTransfer/)
    assert.match(page, /feedsIo/)
    assert.doesNotMatch(src, /from ['"]\.\.\/skin\//)
  })
})
