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
  it('读路径装饰共用一份；目录仍跳过正文小组件', () => {
    assert.match(render, /decorateNoteReadSurface\(container, copyCodeLabel\)/)
    assert.match(postprocess, /heading\.closest\('\.note-widget'\)/)
    const decorations = readFileSync(join(dir, 'textDecorations.ts'), 'utf8')
    const anchors = readFileSync(join(dir, 'commentAnchors.ts'), 'utf8')
    const events = readFileSync(join(dir, 'hooks/useContentEvents.ts'), 'utf8')
    const controls = readFileSync(join(dir, 'hooks/useReaderControls.ts'), 'utf8')
    assert.match(decorations, /\.note-widget/)
    assert.match(anchors, /\.note-widget/)
    assert.match(events, /\.note-widget, \.brew-embed-card/)
    assert.match(controls, /!item\.closest\('\.note-widget'\)/)
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
    assert.match(editor, /decorateNoteReadSurface\(/)
    assert.match(editor, /getArticleProseClass\(/)
    assert.match(editor, /brew-note__article/)
    assert.match(editor, /className=\{previewSurfaceClass\}/)
    assert.match(editor, /style=\{readerSurfaceStyle\}/)
    assert.match(editor, /ref=\{previewRef\}/)
    assert.match(editor, /hidden=\{!html\}/)
    assert.doesNotMatch(editor, /: html \? \(/)
    assert.match(editor, /useLayoutEffect\(\(\) => \{\s*if \(pane !== 'preview'\)/)
    assert.doesNotMatch(editor, /setHtml\(markdownToVisualHtml/)
    assert.doesNotMatch(editor, /setHtml\(withLinkDefinitions/)
    assert.doesNotMatch(editor, /withLinkDefinitions/)
    assert.match(editor, /setHtml\(rendered\)/)
    assert.doesNotMatch(editor, /withCodeLangLabels/)
  })
})
