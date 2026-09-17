import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const editor = readFileSync(join(dir, 'MediaEditorDialog.css'), 'utf8')
const cards = readFileSync(join(dir, 'WorkbenchMediaCards.css'), 'utf8')

describe('媒体库预览走设置 token', () => {
  it('编辑预览井与工具条用 --cfg 表面，不用死黑底', () => {
    assert.doesNotMatch(editor, /#151517/)
    assert.match(editor, /\.media-editor__visual \{[\s\S]*background: var\(--cfg-fill\)/)
    assert.match(
      editor,
      /\.media-editor__canvas \{[\s\S]*background: var\(--media-preview-check\)/,
    )
    assert.match(
      editor,
      /\.media-editor__toolbar \{[\s\S]*background: var\(--cfg-frost-bg/,
    )
    assert.match(
      editor,
      /\.media-editor__tag \{[\s\S]*background: var\(--cfg-frost-bg/,
    )
  })

  it('网格缩略图 contain + 棋盘格井，对齐设置预览', () => {
    assert.match(cards, /object-fit: contain/)
    assert.match(cards, /repeating-conic-gradient/)
    assert.match(cards, /var\(--cfg-fill\)/)
    assert.match(cards, /var\(--cfg-subtle-border\)/)
  })
})
