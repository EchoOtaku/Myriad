import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'boardNav.tsx'),
  'utf8',
)

describe('phantasiBoardNavItems', () => {
  it('工作台只在管理员选项里出现，id 是 workbench', () => {
    assert.match(src, /includeWorkbench/)
    assert.match(src, /id: 'workbench'/)
    assert.doesNotMatch(src, /id: 'settings'/)
  })

  it('图标按板块含义：信箱、收藏、笔记、朋友、工作台', () => {
    assert.match(src, /LuInbox/)
    assert.match(src, /LuStar/)
    assert.match(src, /LuNotebookPen/)
    assert.match(src, /LuLink/)
    assert.match(src, /LuFolderOpen/)
    assert.match(src, /title: t\.boardFeeds/)
    assert.match(src, /title: t\.starred/)
    assert.doesNotMatch(src, /starredTitle/)
  })
})
