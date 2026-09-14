import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lineIsBlank, placeBubble, placeGutter } from './noteSelection'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'noteSelection.ts'),
  'utf8',
)

describe('placeBubble', () => {
  const bubble = { width: 200, height: 32 }

  it('居中压在选区上方', () => {
    const placed = placeBubble(
      { top: 300, left: 100, width: 80, height: 24 },
      bubble,
      { width: 800, scrollTop: 0 },
    )
    assert.deepEqual(placed, { top: 260, left: 140 })
  })

  it('左右夹在容器里', () => {
    const left = placeBubble(
      { top: 300, left: 0, width: 10, height: 24 },
      bubble,
      { width: 800, scrollTop: 0 },
    )
    assert.equal(left.left, 108)
    const right = placeBubble(
      { top: 300, left: 790, width: 10, height: 24 },
      bubble,
      { width: 800, scrollTop: 0 },
    )
    assert.equal(right.left, 692)
  })

  it('顶上被滚出去就翻到选区下面', () => {
    const placed = placeBubble(
      { top: 1010, left: 100, width: 20, height: 24 },
      bubble,
      { width: 800, scrollTop: 1000 },
    )
    assert.equal(placed.top, 1010 + 24 + 8)
  })

  it('触屏一律放下面，把上面让给系统菜单', () => {
    const placed = placeBubble(
      { top: 300, left: 100, width: 20, height: 24 },
      bubble,
      { width: 800, scrollTop: 0 },
      8,
      8,
      true,
    )
    assert.equal(placed.top, 300 + 24 + 8)
  })
})

describe('placeGutter', () => {
  it('左边够宽就放在光标行左侧，垂直居中', () => {
    assert.deepEqual(
      placeGutter({ top: 100, left: 120, height: 28 }, 36),
      { top: 96, left: 74 },
    )
  })

  it('左边不够宽就贴着纸边，允许溢出正文', () => {
    assert.deepEqual(
      placeGutter({ top: 100, left: 16, height: 28 }, 36),
      { top: 96, left: 4 },
    )
  })
})

describe('lineIsBlank', () => {
  it('空文档、空行、只有空白都算空行', () => {
    assert.equal(lineIsBlank('', 0), true)
    assert.equal(lineIsBlank('abc\n\ndef', 4), true)
    assert.equal(lineIsBlank('abc\n   \ndef', 5), true)
  })

  it('行上有字就不算，不管光标在行首还是行尾', () => {
    assert.equal(lineIsBlank('abc\ndef', 4), false)
    assert.equal(lineIsBlank('abc\ndef', 7), false)
    assert.equal(lineIsBlank('abc', 0), false)
  })
})

describe('textarea 镜像', () => {
  it('复用一份镜像，量选区不带上光标后的全文', () => {
    assert.match(source, /export function releaseTextareaMirror/)
    assert.match(source, /prefix\.nodeValue = el\.value\.slice\(0, start\)/)
    assert.doesNotMatch(source, /el\.value\.slice\(end\) \|\|/)
    assert.match(source, /doc\.body\.appendChild\(root\)/)
    assert.match(source, /textareaMirror\?\.root\.remove\(\)/)
  })

  it('锚点取整，避免亚像素把浮动条钉着重渲', () => {
    assert.match(source, /function snapPx/)
    assert.match(source, /top: snapPx\(/)
  })
})

describe('可视块种类', () => {
  it('块工具条认分栏和小组件', () => {
    assert.match(source, /'columns' \| 'widget'/)
    assert.match(source, /\.note-columns, \.note-widget/)
  })
})
