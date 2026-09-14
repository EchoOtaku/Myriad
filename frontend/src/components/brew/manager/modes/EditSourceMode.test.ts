import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('EditSourceMode', () => {
  it('编辑订阅跟添加订阅同一套 settings 表单，不再用 Sheet', () => {
    const src = readFileSync(join(dir, 'EditSourceMode.tsx'), 'utf8')
    assert.match(src, /brew-add-form/)
    assert.match(src, /SourceKindControl/)
    assert.match(src, /onChange=\{pickKind\}/)
    assert.match(src, /SourceCategoryField/)
    assert.match(src, /<InputItem/)
    assert.match(src, /<SwitchItem/)
    assert.match(src, /<SelectItem/)
    assert.match(src, /<SettingsButton/)
    assert.match(src, /pauseFetch/)
    assert.match(src, /onDiscover/)
    assert.match(src, /RSSHubConfigComponent/)
    assert.match(src, /onGenerateStyleTags\(source\.id, signal\)/)
    assert.doesNotMatch(src, /from ['"]\.\.\/\.\.\/ui\/Sheet['"]/)
    assert.doesNotMatch(src, /<Sheet/)
    assert.doesNotMatch(src, /<SourceKindControl value=\{fieldKind\} disabled \/>/)
  })
})
