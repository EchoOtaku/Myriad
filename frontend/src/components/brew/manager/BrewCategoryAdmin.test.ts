import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('BrewCategoryAdmin', () => {
  it('分类管理不进口皮，手记和订阅各一页', () => {
    const src = readFileSync(join(dir, 'BrewCategoryAdmin.tsx'), 'utf8')
    const page = readFileSync(join(dir, '../../../views/Brew.tsx'), 'utf8')
    assert.match(src, /workbench-note-categories/)
    assert.match(src, /workbench-source-categories/)
    assert.match(src, /workbenchCategoryNoteUsage/)
    assert.match(src, /workbenchCategorySourceUsage/)
    assert.match(src, /workbenchCategoryLocked/)
    assert.match(src, /noteCategoryNew/)
    assert.match(src, /id: '__new__'/)
    assert.doesNotMatch(src, /formOpen/)
    assert.doesNotMatch(src, /formTitle/)
    assert.doesNotMatch(src, /brew-workbench__category-create/)
    assert.match(src, /workbenchCategoryRename/)
    assert.match(src, /workbenchCategoryDeleteNotesConfirm/)
    assert.match(src, /workbenchCategoryDeleteSourcesConfirm/)
    assert.doesNotMatch(src, /noteCategoryAll/)
    assert.doesNotMatch(src, /未分类/)
    assert.doesNotMatch(src, /from ['"]\.\.\/skin\//)
    assert.doesNotMatch(src, /from ['"].*brewApi['"]/)
    assert.match(page, /BrewCategoryAdmin/)
    assert.match(page, /useBrewCategories/)
    assert.match(page, /workbenchPane === 'noteCategories'/)
    assert.match(page, /workbenchPane === 'sourceCategories'/)
    assert.match(page, /categories\.noteRows/)
    assert.match(page, /categories\.sourceRows/)
  })
})
