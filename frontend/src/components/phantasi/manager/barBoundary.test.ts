import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('phantasi manager 栏边界', () => {
  it('标题操作只进口 ui，不进口 skin', () => {
    const source = readFileSync(join(dir, 'PhantasiSourceTitleTags.tsx'), 'utf8')
    const filter = readFileSync(join(dir, 'PhantasiFilterTitleTags.tsx'), 'utf8')
    assert.match(source, /from ['"]\.\.\/ui\//)
    assert.match(filter, /SettingTitleTag/)
    assert.doesNotMatch(source, /from ['"]\.\.\/skin\//)
    assert.doesNotMatch(filter, /from ['"]\.\.\/skin\//)
  })

  it('控制栏不进口 skin，也不直接碰 ZIP', () => {
    const search = readFileSync(join(dir, '../ui/PhantasiSearch.tsx'), 'utf8')
    const page = readFileSync(join(dir, '../../../views/Phantasi.tsx'), 'utf8')
    assert.doesNotMatch(search, /from ['"].*\/skin\//)
    assert.doesNotMatch(search, /jszip/i)
    assert.doesNotMatch(page, /jszip/i)
    assert.doesNotMatch(search, /from ['"].*pipackIo['"]/)
    assert.doesNotMatch(page, /from ['"].*pipackIo['"]/)
    assert.doesNotMatch(search, /from ['"].*usePipack['"]/)
    assert.doesNotMatch(page, /from ['"].*usePipack['"]/)
    assert.doesNotMatch(search, /from ['"].*useBarWave['"]/)
    assert.doesNotMatch(page, /from ['"].*useBarWave['"]/)
    assert.doesNotMatch(search, /from ['"].*PhantasiManagement['"]/)
    assert.doesNotMatch(page, /from ['"].*PhantasiManagement['"]/)
    assert.doesNotMatch(page, /PhantasiControls/)
    assert.doesNotMatch(search, /phantasiApi\.updateSource/)
    assert.doesNotMatch(page, /phantasiApi\.updateSource/)
    assert.doesNotMatch(search, /phantasiApi\.importOpml/)
    assert.doesNotMatch(page, /phantasiApi\.importOpml/)
    assert.doesNotMatch(search, /phantasiApi\.deleteSource/)
    assert.doesNotMatch(page, /phantasiApi\.deleteSource/)
    assert.doesNotMatch(search, /phantasiApi\.discoverSource/)
    assert.doesNotMatch(page, /phantasiApi\.discoverSource/)
    assert.doesNotMatch(search, /from ['"].*phantasiApi['"]/)
    assert.doesNotMatch(page, /from ['"].*phantasiApi['"]/)
  })
})
