import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const postprocess = readFileSync(join(dir, 'contentPostprocess.ts'), 'utf8')
const render = readFileSync(join(dir, 'contentRender.ts'), 'utf8')
const editor = readFileSync(join(dir, '../notes/NoteEditor.tsx'), 'utf8')

describe('阅读器后处理', () => {
  it('不改正文小组件里面的图、链、代码、标题', () => {
    assert.match(postprocess, /img\.closest\('\.note-widget,/)
    assert.match(postprocess, /link\.closest\('\.note-widget'\)/)
    assert.match(postprocess, /pre\.closest\('\.note-widget'\)/)
    assert.match(postprocess, /iframe\.closest\(\s*'\.note-widget,/)
    assert.match(postprocess, /heading\.closest\('\.note-widget'\)/)
  })
})

describe('手记预览和阅读器同一份准备', () => {
  it('手记跳过 RSS 清洗，预览也走 prepareNoteReaderHtml', () => {
    assert.match(render, /guid\.startsWith\('note:'\)/)
    assert.match(render, /prepareNoteReaderHtml\(item\.content, empty\)/)
    assert.match(render, /processRssContent/)
    assert.match(render, /useLayoutEffect\(\(\) => \{/)
    assert.match(render, /replaceNoteHtml\(container, displayHtml\)/)
    assert.match(editor, /prepareNoteReaderHtml\(/)
    assert.match(editor, /useLayoutEffect\(\(\) => \{\s*if \(pane !== 'preview'\)/)
  })
})
