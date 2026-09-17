import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(dir, 'workbench.css'), 'utf8')
const section = readFileSync(
  join(dir, '../../../settings/SettingSection.css'),
  'utf8',
)

describe('工作台窄屏排版', () => {
  it('标题栏动作卡只在宽屏贴在标题右侧，窄屏走设置页换行', () => {
    const needle =
      '.phantasi-workbench .setting-section > .section-header .section-header-right'
    const idx = css.indexOf(needle)
    assert.notEqual(idx, -1)
    const from = css.lastIndexOf('@media', idx)
    assert.match(css.slice(from, idx), /width >= 1024px/)
    assert.match(
      section,
      /@media \(width < 1024px\)[\s\S]*\.section-header-right \{[\s\S]*flex: 1 1 100%/,
    )
    assert.match(
      section,
      /@media \(width < 1024px\)[\s\S]*section-header-actions-extra[\s\S]*flex-wrap: wrap/,
    )
    assert.match(
      section,
      /@media \(width < 1024px\)[\s\S]*section-header-actions-divider \{[\s\S]*display: none/,
    )
  })

  it('触屏列表操作不再盖住正文', () => {
    assert.match(
      css,
      /@media \(hover: none\)[\s\S]*managed-list:not\(\.managed-list--grid\)[\s\S]*position: static/,
    )
  })
})
