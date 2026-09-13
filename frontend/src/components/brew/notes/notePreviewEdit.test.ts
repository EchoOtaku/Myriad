import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  alignPlainTextInMarkdown,
  blockSourceRange,
  byteOffsetToIndex,
  previewClickToMarkdownIndex,
} from './notePreviewEdit'

describe('byteOffsetToIndex', () => {
  it('中文三字节、emoji 四字节都换算对', () => {
    const text = '前言\n\n> 引用'
    assert.equal(byteOffsetToIndex(text, 0), 0)
    assert.equal(byteOffsetToIndex(text, 8), 4) // "前言\n\n" = 3+3+1+1 字节 → 4 个字符
    assert.equal(byteOffsetToIndex('a😀b', 5), 3) // 😀 在 JS 里占两个 UTF-16 单元
    assert.equal(byteOffsetToIndex('abc', 99), 3)
  })
})

describe('alignPlainTextInMarkdown', () => {
  it('跳过行内记号，落在对应的字后面', () => {
    const src = '时间线要的是*此刻*，桌子要的是**还能坐得住**。'
    const at = alignPlainTextInMarkdown(src, '时间线要的是此刻，桌')
    assert.equal(src.slice(0, at), '时间线要的是*此刻*，桌')
  })

  it('链接只算文字，地址整段跳过', () => {
    const src = '看 [规范](https://spec.commonmark.org/ "CM") 把边界画出来'
    const at = alignPlainTextInMarkdown(src, '看 规范 把边')
    assert.equal(src.slice(0, at), '看 [规范](https://spec.commonmark.org/ "CM") 把边')
  })

  it('行首标题井号和引用记号不算字', () => {
    assert.equal(alignPlainTextInMarkdown('## 自己的桌子', '自己'), '## 自己'.length)
    const quote = '> 第一行\n> 第二行'
    assert.equal(quote.slice(0, alignPlainTextInMarkdown(quote, '第一行 第二')), '> 第一行\n> 第二')
  })

  it('图片和脚注引用在纯文本里不存在，整段跳过', () => {
    const src = '前 ![alt](https://x/y.png) 后[^didion] 尾'
    assert.equal(src.slice(0, alignPlainTextInMarkdown(src, '前 后')), '前 ![alt](https://x/y.png) 后')
    assert.equal(src.slice(0, alignPlainTextInMarkdown(src, '前 后1 尾')), src.slice(0, src.length - 1))
  })

  it('转义字对上字面本身', () => {
    const src = String.raw`价格 \*不是斜体\* 完`
    assert.equal(src.slice(0, alignPlainTextInMarkdown(src, '价格 *不是')), String.raw`价格 \*不是`)
  })

  it('对不上就停在最后对上的字后面，不乱跳', () => {
    const src = '甲乙丙'
    assert.equal(alignPlainTextInMarkdown(src, '甲X丙'), 1)
    assert.equal(alignPlainTextInMarkdown(src, ''), 0)
  })
})

describe('blockSourceRange / previewClickToMarkdownIndex', () => {
  it('字节区间换成字符区间，再按纯文本落到字上', () => {
    const md = '# 标题\n\n第一段 **粗** 完。'
    // "# 标题\n\n" = 1+1+3+3+1+1 = 10 字节
    const range = blockSourceRange(md, {
      start: '10',
      end: String(new TextEncoder().encode(md).length),
    })!
    assert.equal(md.slice(range.start), '第一段 **粗** 完。')
    const at = previewClickToMarkdownIndex(md, range, '第一段 粗 ')
    assert.equal(md.slice(0, at), '# 标题\n\n第一段 **粗** ')
  })

  it('没打区间就是 null', () => {
    assert.equal(blockSourceRange('x', { start: undefined, end: '3' }), null)
    assert.equal(blockSourceRange('x', { start: '5', end: '3' }), null)
  })
})
