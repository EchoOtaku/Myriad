import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

const loadHooks = [
  'useBrewSources.ts',
  'useBrewItems.ts',
  'useBrewStarred.ts',
  'useBrewItemActions.ts',
  'useBrewItemRoute.ts',
  'useBrewBoardRoute.ts',
  'useBrewAgentOpen.ts',
  'useBrewSurface.ts',
  'useBrewNotes.ts',
  'useBrewSeo.ts',
  'useBrewNavExpand.ts',
  'useBoardPage.ts',
  'useBrewWorkbench.ts',
]

describe('brew page hooks 边界', () => {
  it('加载 hook 不进口 skin / ui / manager', () => {
    for (const name of loadHooks) {
      const src = readFileSync(join(dir, name), 'utf8')
      assert.doesNotMatch(src, /from ['"]\.\/skin/)
      assert.doesNotMatch(src, /from ['"]\.\/ui/)
      assert.doesNotMatch(src, /from ['"]\.\/manager/)
    }
  })

  it('工作台 hook 不进口编辑器正文，只调文档和媒体 API', () => {
    const src = readFileSync(join(dir, 'useBrewWorkbench.ts'), 'utf8')
    assert.match(src, /listNoteDocs/)
    assert.match(src, /deleteNoteDoc/)
    assert.match(src, /mediaApi/)
    assert.doesNotMatch(src, /NoteEditor/)
    assert.doesNotMatch(src, /useReaderSettings/)
  })

  it('订阅轨手势中按住拼轨，松手再 tick', () => {
    const src = readFileSync(join(dir, 'useBoardPage.ts'), 'utf8')
    assert.match(src, /quietRef/)
    assert.match(src, /pendingBumpRef/)
    assert.match(src, /holdStories/)
    assert.match(src, /releaseStories/)
    assert.match(src, /if \(quietRef\.current\)/)
  })
})
