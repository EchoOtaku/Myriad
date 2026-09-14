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
    const src = readFileSync(join(dir, 'PhantasiControls.tsx'), 'utf8')
    assert.doesNotMatch(src, /from ['"]\.\.\/skin\//)
    assert.doesNotMatch(src, /jszip/i)
    assert.doesNotMatch(src, /from ['"]\.\/pipackIo['"]/)
    assert.doesNotMatch(src, /from ['"]\.\/usePipack['"]/)
    assert.doesNotMatch(src, /from ['"]\.\/useBarWave['"]/)
    assert.doesNotMatch(src, /from ['"]\.\.\/ui\/PhantasiManagement['"]/)
    assert.doesNotMatch(src, /from ['"]\.\/bar['"]/)
    assert.doesNotMatch(src, /phantasiApi\.updateSource/)
    assert.doesNotMatch(src, /phantasiApi\.importOpml/)
    assert.doesNotMatch(src, /phantasiApi\.deleteSource/)
    assert.doesNotMatch(src, /phantasiApi\.discoverSource/)
    assert.doesNotMatch(src, /from ['"].*phantasiApi['"]/)
  })
})
