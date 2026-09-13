import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  insertFootnoteMarkdown,
  insertTableMarkdown,
  markdownToVisualHtml,
  visualHtmlToMarkdown,
} from './noteVisual.ts'

describe('markdownToVisualHtml', () => {
  it('粗体斜体删除线能转过去', () => {
    const html = markdownToVisualHtml('这是 **粗** 和 *斜* 和 ~~删~~')
    assert.match(html, /<strong>粗<\/strong>/)
    assert.match(html, /<em>斜<\/em>/)
    assert.match(html, /<del>删<\/del>/)
  })

  it('任务列表带 data-task', () => {
    assert.match(
      markdownToVisualHtml('- [x] 做完\n- [ ] 还没'),
      /data-task="1"/,
    )
  })
})

describe('visualHtmlToMarkdown', () => {
  it('转一圈还认得粗体和列表', () => {
    const md = '标题段\n\n- 甲\n- 乙'
    const html = markdownToVisualHtml(md)
    const back = visualHtmlToMarkdown(html)
    assert.match(back, /甲/)
    assert.match(back, /乙/)
  })

  it('粗体斜体删除线转一圈还在', () => {
    const md = '这是 **粗** 和 *斜* 和 ~~删~~'
    const back = visualHtmlToMarkdown(markdownToVisualHtml(md))
    assert.match(back, /\*\*粗\*\*/)
    assert.match(back, /\*斜\*/)
    assert.match(back, /~~删~~/)
  })

  it('分隔线、脚注、代码语言转一圈还在', () => {
    const md = '上\n\n---\n\n```rust\nfn n() {}\n```\n\n注[^1]\n\n[^1]: 底'
    const back = visualHtmlToMarkdown(markdownToVisualHtml(md))
    assert.match(back, /^---$/m)
    assert.match(back, /```rust/)
    assert.match(back, /\[\^1\]: 底/)
  })

  it('标题、引用、有序和任务列表、表格转一圈还在', () => {
    const md =
      '## 节\n\n> 引\n\n1. 一\n\n- [x] 做完\n\n| 列 | 列 |\n| --- | --- |\n| 甲 | 乙 |'
    const back = visualHtmlToMarkdown(markdownToVisualHtml(md))
    assert.match(back, /^## 节$/m)
    assert.match(back, /^> 引$/m)
    assert.match(back, /^1\. 一$/m)
    assert.match(back, /- \[x\] 做完/)
    assert.match(back, /\| 甲 \| 乙 \|/)
  })
})

describe('嵌套列表', () => {
  it('缩进的子项进到父项里面', () => {
    const html = markdownToVisualHtml('- 甲\n  - 甲一\n  - 甲二\n- 乙')
    assert.match(html, /<li>甲<ul><li>甲一<\/li><li>甲二<\/li><\/ul><\/li><li>乙<\/li>/)
  })

  it('转一圈缩进还在，有序父项下缩三格', () => {
    const md = '1. 一\n   - 一甲\n   - 一乙\n2. 二'
    const back = visualHtmlToMarkdown(markdownToVisualHtml(md))
    assert.equal(back, md)
  })

  it('任务子项也能嵌', () => {
    const md = '- [ ] 大\n  - [x] 小'
    assert.equal(visualHtmlToMarkdown(markdownToVisualHtml(md)), md)
  })

  it('同名块嵌套不再靠非贪婪：两个列表并排也分得开', () => {
    const md = '- 甲\n  - 乙\n\n1. 丙'
    assert.equal(visualHtmlToMarkdown(markdownToVisualHtml(md)), md)
  })
})

describe('脚注引用', () => {
  it('正文里的 [^1] 是上标，转回来还是 [^1]', () => {
    const html = markdownToVisualHtml('见[^1]。')
    assert.match(html, /<sup data-fnref="1">1<\/sup>/)
    assert.equal(visualHtmlToMarkdown(html), '见[^1]。')
  })
})

describe('insert helpers', () => {
  it('表格和脚注是 Markdown 语法', () => {
    assert.match(insertTableMarkdown(), /\| --- \|/)
    assert.equal(insertFootnoteMarkdown(2).mark, '[^2]')
  })
})
