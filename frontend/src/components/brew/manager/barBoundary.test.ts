import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('brew manager 栏边界', () => {
  it('标题操作只进口 ui，不进口 skin', () => {
    const source = readFileSync(join(dir, 'BrewSourceTitleTags.tsx'), 'utf8')
    const filter = readFileSync(join(dir, 'BrewFilterTitleTags.tsx'), 'utf8')
    assert.match(source, /from ['"]\.\.\/ui\//)
    assert.match(filter, /SettingTitleTag/)
    assert.doesNotMatch(source, /from ['"]\.\.\/skin\//)
    assert.doesNotMatch(filter, /from ['"]\.\.\/skin\//)
  })

  it('控制栏不进口 skin，也不直接碰 ZIP', () => {
    const src = readFileSync(join(dir, 'BrewControls.tsx'), 'utf8')
    assert.doesNotMatch(src, /from ['"]\.\.\/skin\//)
    assert.doesNotMatch(src, /jszip/i)
    assert.doesNotMatch(src, /from ['"]\.\/brewpackIo['"]/)
    assert.match(src, /from ['"]\.\/useBrewpack['"]/)
    assert.doesNotMatch(src, /from ['"]\.\/useBarWave['"]/)
    assert.doesNotMatch(src, /from ['"]\.\.\/ui\/BrewManagement['"]/)
    assert.doesNotMatch(src, /from ['"]\.\/bar['"]/)
    assert.doesNotMatch(src, /brewApi\.updateSource/)
    assert.doesNotMatch(src, /brewApi\.importOpml/)
    assert.doesNotMatch(src, /brewApi\.deleteSource/)
    assert.doesNotMatch(src, /brewApi\.discoverSource/)
    assert.doesNotMatch(src, /from ['"].*brewApi['"]/)
  })
})
