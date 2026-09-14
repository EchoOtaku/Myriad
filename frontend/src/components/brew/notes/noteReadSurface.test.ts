import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const surface = readFileSync(join(dir, 'noteReadSurface.ts'), 'utf8')
const render = readFileSync(join(dir, '../reader/contentRender.ts'), 'utf8')
const postprocess = readFileSync(join(dir, '../reader/contentPostprocess.ts'), 'utf8')
const editor = readFileSync(join(dir, 'NoteEditor.tsx'), 'utf8')

describe('decorateNoteReadSurface', () => {
  it('图、链、代码、iframe 都跳过正文小组件', () => {
    assert.match(surface, /img\.closest\('\.note-widget,/)
    assert.match(surface, /link\.closest\('\.note-widget'\)/)
    assert.match(surface, /pre\.closest\('\.note-widget'\)/)
    assert.match(surface, /iframe\.closest\(\s*'\.note-widget,/)
    assert.match(surface, /code-block-wrapper/)
    const highlight = readFileSync(join(dir, '../../../utils/codeHighlight.ts'), 'utf8')
    assert.match(highlight, /!code\.closest\('\.note-widget'\)/)
  })

  it('预览和阅读器共用这一份，预览不再单独 highlight', () => {
    assert.match(render, /decorateNoteReadSurface\(container, copyCodeLabel\)/)
    assert.match(editor, /decorateNoteReadSurface\(/)
    assert.match(editor, /getArticleProseClass\(/)
    assert.match(surface, /import\('\.\.\/\.\.\/\.\.\/utils\/codeHighlight'\)/)
    assert.doesNotMatch(surface, /import \{ highlightCodeBlocks \}/)
    assert.doesNotMatch(editor, /highlightCodeBlocks/)
    assert.doesNotMatch(postprocess, /highlightCodeBlocks/)
  })
})
