import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const phantasiDir = dirname(fileURLToPath(import.meta.url))
const viewsDir = join(phantasiDir, '../../views')

describe('article prefetch cancel', () => {
  it('hover leave cancels the in-flight prefetch', () => {
    const feeds =
      readFileSync(join(phantasiDir, 'skin/PhantasiFeeds.tsx'), 'utf8') +
      readFileSync(join(phantasiDir, 'skin/PhantasiFeedsStories.tsx'), 'utf8')
    const board = readFileSync(join(phantasiDir, 'skin/PhantasiBoard.tsx'), 'utf8')
    const grid = readFileSync(join(phantasiDir, 'PhantasiSourceGrid.tsx'), 'utf8')
    const page = readFileSync(join(viewsDir, 'Phantasi.tsx'), 'utf8')
    const filter = readFileSync(join(phantasiDir, 'PhantasiFilterLane.tsx'), 'utf8')
    const list = readFileSync(join(phantasiDir, 'skin/PhantasiList.tsx'), 'utf8')
    assert.match(feeds, /onPeekEnd\?\.\(\)/)
    assert.match(board, /onPeekEnd=\{onPeekEnd\}/)
    assert.match(grid, /onPeekEnd=\{onPeekEnd\}/)
    assert.match(filter, /onPeekEnd=\{starredMode\?\.isEditMode \? undefined : onPeekEnd\}/)
    assert.match(list, /usePhantasiPeekLane/)
    assert.match(list, /onPeekEnd/)
    assert.match(page, /onPeekEnd=\{handlePeekEnd\}/)
    assert.match(page, /cancelArticlePrefetch\(\)/)
  })
})
