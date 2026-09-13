import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { hasNoteWidgetMarkup, stampNoteWidgetNotProse } from './noteWidgetHtml.ts'

const dir = dirname(fileURLToPath(import.meta.url))
const mount = readFileSync(join(dir, 'noteWidgetMount.tsx'), 'utf8')

describe('hasNoteWidgetMarkup', () => {
  it('认发布 HTML 里的占位，不靠一段纯文本', () => {
    assert.equal(
      hasNoteWidgetMarkup(
        '<div class="note-widget" data-widget="weather" data-size="2x2">weather</div>',
      ),
      true,
    )
    assert.equal(hasNoteWidgetMarkup('<div data-widget="quote">quote</div>'), true)
    assert.equal(hasNoteWidgetMarkup('<p>note-widget</p>'), false)
    assert.equal(hasNoteWidgetMarkup(':::widget weather 2x2'), false)
    assert.equal(hasNoteWidgetMarkup(''), false)
    assert.equal(hasNoteWidgetMarkup(null), false)
  })

  it('预览和阅读器都拉真数据，不走宫格样本', () => {
    assert.match(mount, /isPreview=\{false\}/)
    assert.doesNotMatch(mount, /isPreview(?!\s*=\s*\{false\})/)
  })

  it('水合时给旧占位补 not-prose，挡住阅读器 typography', () => {
    assert.match(mount, /host\.classList\.add\('not-prose'\)/)
  })

  it('只认占位上的实例配置，不搬首页宫格', () => {
    assert.doesNotMatch(mount, /useHomeWidgetDefaults|homeWidgetConfigsFromUi/)
    assert.match(mount, /\.\.\.widgetHostConfig\(widgetType\.id\),\s*\n\s*\.\.\.instanceConfig/)
  })

  it('岛自带 Router，报告卡 / 友链 / Tapp 快捷方式才不会一挂就空白', () => {
    assert.match(mount, /from 'react-router-dom'/)
    assert.match(mount, /<MemoryRouter>/)
    assert.match(mount, /NoteWidgetGuard/)
    assert.match(mount, /getDerivedStateFromError/)
  })
})

describe('stampNoteWidgetNotProse', () => {
  it('旧占位补上 not-prose，已经有的不重复', () => {
    assert.equal(
      stampNoteWidgetNotProse(
        '<div class="note-widget" data-widget="game-presence" data-size="4x2">game-presence</div>',
      ),
      '<div class="note-widget not-prose" data-widget="game-presence" data-size="4x2">game-presence</div>',
    )
    assert.equal(
      stampNoteWidgetNotProse(
        '<div class="note-widget not-prose" data-widget="weather" data-size="2x2">weather</div>',
      ),
      '<div class="note-widget not-prose" data-widget="weather" data-size="2x2">weather</div>',
    )
    assert.equal(
      stampNoteWidgetNotProse('<div class="note-columns"><div class="note-column">左</div></div>'),
      '<div class="note-columns"><div class="note-column">左</div></div>',
    )
  })
})
