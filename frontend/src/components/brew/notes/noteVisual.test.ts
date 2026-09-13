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

describe('行内解析对齐后端', () => {
  it('*** 是粗斜，转回来还是 ***', () => {
    const html = markdownToVisualHtml('这是 ***粗斜***')
    assert.match(html, /<strong><em>粗斜<\/em><\/strong>/)
    assert.equal(visualHtmlToMarkdown(html), '这是 ***粗斜***')
  })

  it('反斜杠转义的字不当记号，转回来还带反斜杠', () => {
    const md = String.raw`价格 \*不是斜体\* 和 \[不是链接\]`
    const html = markdownToVisualHtml(md)
    assert.doesNotMatch(html, /<em>/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('<https://…> 自动链接转一圈还是尖括号', () => {
    const md = '看 <https://a.b/c>'
    const html = markdownToVisualHtml(md)
    assert.match(html, /<a href="https:\/\/a\.b\/c" data-autolink="1">/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('硬换行是两个空格，软换行只是空格', () => {
    assert.match(markdownToVisualHtml('甲  \n乙'), /甲<br>乙/)
    assert.match(markdownToVisualHtml('甲\n乙'), /<p>甲 乙<\/p>/)
    assert.equal(visualHtmlToMarkdown('<p>甲<br>乙</p>'), '甲  \n乙')
  })
})

describe('表格对齐', () => {
  it('分隔行的冒号落到 align 属性，转回来还在', () => {
    const md = '| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| a | b | c |'
    const html = markdownToVisualHtml(md)
    assert.match(html, /<th align="left">左<\/th><th align="center">中<\/th><th align="right">右<\/th>/)
    assert.match(html, /<td align="center">b<\/td>/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('单元格里的竖线要转义', () => {
    assert.match(visualHtmlToMarkdown('<table><tr><th>a|b</th></tr></table>'), /a\\\|b/)
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
