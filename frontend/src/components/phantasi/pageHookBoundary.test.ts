import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

const loadHooks = [
  'usePhantasiSources.ts',
  'usePhantasiItems.ts',
  'usePhantasiStarred.ts',
  'usePhantasiItemActions.ts',
  'usePhantasiItemRoute.ts',
  'usePhantasiBoardRoute.ts',
  'usePhantasiAgentOpen.ts',
  'usePhantasiSurface.ts',
  'usePhantasiNotes.ts',
  'usePhantasiSeo.ts',
  'usePhantasiNavExpand.ts',
  'useBoardPage.ts',
  'usePhantasiWorkbench.ts',
  'usePhantasiCategories.ts',
]

describe('phantasi page hooks 边界', () => {
  it('加载 hook 不进口 skin / ui / manager', () => {
    for (const name of loadHooks) {
      const src = readFileSync(join(dir, name), 'utf8')
      assert.doesNotMatch(src, /from ['"]\.\/skin/)
      assert.doesNotMatch(src, /from ['"]\.\/ui/)
      assert.doesNotMatch(src, /from ['"]\.\/manager/)
    }
  })

  it('分类 hook 改目录并改写笔记/订阅，不进口 manager / 编辑器', () => {
    const src = readFileSync(join(dir, 'usePhantasiCategories.ts'), 'utf8')
    assert.match(src, /getCategories/)
    assert.match(src, /createCategory/)
    assert.match(src, /updateCategory/)
    assert.match(src, /deleteCategory/)
    assert.match(src, /updateNoteDoc/)
    assert.match(src, /resolveAddCategoryPart/)
    assert.match(src, /formatCategoryFullNotice/)
    assert.match(src, /renameCategoryPart/)
    assert.match(src, /removeCategoryPart/)
    assert.match(src, /\bassign\b/)
    assert.match(src, /categoryFull/)
    assert.match(src, /updateNote/)
    assert.match(src, /updateSource/)
    assert.doesNotMatch(src, /NoteEditor/)
    assert.doesNotMatch(src, /from ['"]\.\/manager/)
  })

  it('工作台 hook 不进口编辑器正文，只调文档和媒体 API', () => {
    const src = readFileSync(join(dir, 'usePhantasiWorkbench.ts'), 'utf8')
    assert.match(src, /listNoteDocs/)
    assert.match(src, /deleteNoteDoc/)
    assert.match(src, /removeNotes/)
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
