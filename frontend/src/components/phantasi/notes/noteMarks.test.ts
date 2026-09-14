import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { markdownMarksAt, sameMarks } from './noteMarks'

describe('markdownMarksAt', () => {
  it('选区外面包着的记号亮起', () => {
    const md = '甲 **乙** ~~丙~~ `丁` *戊*'
    assert.ok(markdownMarksAt(md, 4, 5).has('bold'))
    assert.ok(markdownMarksAt(md, 10, 11).has('strike'))
    assert.ok(markdownMarksAt(md, 15, 16).has('inline-code'))
    assert.ok(markdownMarksAt(md, 19, 20).has('italic'))
    assert.ok(!markdownMarksAt(md, 4, 5).has('italic'), '双星号不是斜体')
  })

  it('连记号一起选也算', () => {
    assert.ok(markdownMarksAt('**乙**', 0, 5).has('bold'))
  })

  it('行首记号：标题和引用', () => {
    assert.ok(markdownMarksAt('## 节\n正文', 1, 1).has('h2'))
    assert.ok(markdownMarksAt('### 节', 4, 5).has('h3'))
    assert.ok(markdownMarksAt('> 引', 2, 3).has('quote'))
    assert.ok(!markdownMarksAt('## 节\n正文', 6, 7).has('h2'))
  })

  it('光标在链接里', () => {
    assert.ok(markdownMarksAt('看 [这里](https://a.b)', 4, 6).has('link'))
    assert.ok(!markdownMarksAt('看 这里', 2, 4).has('link'))
  })

  it('什么都没有就是空集', () => {
    assert.equal(markdownMarksAt('plain', 1, 3).size, 0)
  })
})

describe('sameMarks', () => {
  it('集合相等比较', () => {
    assert.ok(sameMarks(new Set(['bold']), new Set(['bold'])))
    assert.ok(!sameMarks(new Set(['bold']), new Set(['italic'])))
    assert.ok(!sameMarks(new Set(['bold']), new Set(['bold', 'link'])))
  })
})
