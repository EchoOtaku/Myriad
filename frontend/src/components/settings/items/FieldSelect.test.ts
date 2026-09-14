import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('FieldSelect', () => {
  it('下拉挂到 body，不被父级 overflow 裁掉', () => {
    const src = readFileSync(join(dir, 'FieldSelect.tsx'), 'utf8')
    const css = readFileSync(join(dir, 'FieldSelect.css'), 'utf8')
    assert.match(src, /createPortal/)
    assert.match(src, /document\.body/)
    assert.match(src, /is-portal/)
    assert.match(css, /\.field-select-panel\.is-portal/)
    assert.match(css, /position: fixed/)
  })
})
