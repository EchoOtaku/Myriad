import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  blockIndexAt,
  blocksWithOffsets,
  expandJammedDefinitions,
  inlineMarkdownTail,
  insertFootnoteMarkdown,
  insertTableMarkdown,
  looksLikeMarkdown,
  markdownToVisualHtml,
  setVisualImageResolver,
  visualHtmlToMarkdown,
  withCodeLangLabels,
  withLinkDefinitions,
} from './noteVisual.ts'

describe('markdownToVisualHtml math', () => {
  it('行内公式变成岛，转一圈还在', () => {
    const md = '见 $E=mc^2$ 即可'
    const html = markdownToVisualHtml(md)
    assert.match(html, /note-math-inline/)
    assert.match(html, /data-tex="E=mc\^2"/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('块级公式整段往返', () => {
    const md = '$$\n\\frac{1}{2}\n$$'
    const html = markdownToVisualHtml(md)
    assert.match(html, /note-math-display/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('代码里的美元不当公式', () => {
    const html = markdownToVisualHtml('`` $E=mc^2$ ``')
    assert.doesNotMatch(html, /note-math/)
    assert.match(html, /<code>/)
  })

  it('水合后的 KaTeX 壳也能回写成 $', () => {
    const html =
      '<p>见 <span class="note-math note-math-inline" data-tex="E=mc^2">' +
      '<span class="katex"><span class="katex-html">E</span></span></span> 即可</p>'
    assert.equal(visualHtmlToMarkdown(html), '见 $E=mc^2$ 即可')
  })

  it('阅读器的 math-inline 也能回写', () => {
    const html =
      '<p><span class="math math-inline" data-tex="x^2"><span class="katex">x</span></span></p>'
    assert.equal(visualHtmlToMarkdown(html), '$x^2$')
  })
})

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

describe('带标题的图片和链接、非数字脚注、邮件自动链接', () => {
  it('`![alt](url "title")` 是图片，标题转一圈还在', () => {
    const md = '![浅焙咖啡豆，颗粒完整](https://upload.wikimedia.org/x/Roasted_coffee_beans.jpg "Wikimedia Commons：Roasted coffee beans")'
    const html = markdownToVisualHtml(md)
    assert.match(html, /<img src="https:\/\/upload\.wikimedia\.org\/x\/Roasted_coffee_beans\.jpg" alt="浅焙咖啡豆，颗粒完整" title="Wikimedia Commons：Roasted coffee beans">/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('`[t](url "title")` 也带标题', () => {
    const md = '看 [规范](https://spec.commonmark.org/0.31.2/ "CommonMark")'
    const html = markdownToVisualHtml(md)
    assert.match(html, /<a href="https:\/\/spec\.commonmark\.org\/0\.31\.2\/" title="CommonMark">规范<\/a>/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('脚注标签可以是字母：[^didion]', () => {
    const md = '她落笔。[^didion]\n\n[^didion]: 底'
    const html = markdownToVisualHtml(md)
    assert.match(html, /<sup data-fnref="didion">didion<\/sup>/)
    assert.match(html, /<p data-fn="didion">底<\/p>/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('<mail@example.com> 是 mailto 自动链接，转回还是尖括号', () => {
    const md = '写信：<mail@example.com>'
    const html = markdownToVisualHtml(md)
    assert.match(html, /<a href="mailto:mail@example\.com" data-autolink="1">mail@example\.com<\/a>/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('富文本里敲完带标题的图片也就地渲染', () => {
    assert.equal(
      inlineMarkdownTail('![a](https://x/y.png "t")')?.html,
      '<img src="https://x/y.png" alt="a" title="t">',
    )
  })
})

describe('图片显示地址', () => {
  it('装上解析器后 src 是显示地址、data-src 是原地址，转回 Markdown 用原地址', () => {
    setVisualImageResolver((src) => (src.startsWith('/media/') ? `http://api${src}` : src))
    try {
      const html = markdownToVisualHtml('![封面](/media/federation/1/a.jpg) 和 ![外](https://x.y/p.png)')
      assert.match(html, /<img src="http:\/\/api\/media\/federation\/1\/a\.jpg" data-src="\/media\/federation\/1\/a\.jpg" alt="封面">/)
      assert.match(html, /<img src="https:\/\/x\.y\/p\.png" alt="外">/)
      assert.equal(
        visualHtmlToMarkdown(html),
        '![封面](/media/federation/1/a.jpg) 和 ![外](https://x.y/p.png)',
      )
    } finally {
      setVisualImageResolver((src) => src)
    }
  })
})

describe('富文本层里敲 Markdown', () => {
  it('尾巴凑成图片 / 链接 / 粗体 / 代码 / 删除线 / 斜体就换成元素', () => {
    assert.deepEqual(inlineMarkdownTail('看 ![封面](https://x/y.png)'), {
      length: '![封面](https://x/y.png)'.length,
      html: '<img src="https://x/y.png" alt="封面">',
    })
    assert.equal(inlineMarkdownTail('看 [这里](https://a.b)')?.html, '<a href="https://a.b">这里</a>')
    assert.equal(inlineMarkdownTail('甲 **乙**')?.html, '<strong>乙</strong>')
    assert.equal(inlineMarkdownTail('甲 `乙`')?.html, '<code>乙</code>')
    assert.equal(inlineMarkdownTail('甲 ~~乙~~')?.html, '<del>乙</del>')
    assert.equal(inlineMarkdownTail('甲 *乙*')?.html, '<em>乙</em>')
    assert.match(inlineMarkdownTail('见 $E=mc^2$')?.html ?? '', /note-math-inline/)
    assert.match(inlineMarkdownTail('见 $$x^2$$')?.html ?? '', /note-math-display/)
  })

  it('没凑成不动；`**` 不会被当成斜体', () => {
    assert.equal(inlineMarkdownTail('甲 **乙'), null)
    assert.equal(inlineMarkdownTail('甲 **'), null)
    assert.equal(inlineMarkdownTail('![未完](https://x'), null)
  })

  it('looksLikeMarkdown', () => {
    assert.ok(looksLikeMarkdown('![a](https://x/y.png)'))
    assert.ok(looksLikeMarkdown('# 标题\n正文'))
    assert.ok(looksLikeMarkdown('- 甲\n- 乙'))
    assert.ok(!looksLikeMarkdown('just a sentence.'))
    assert.ok(!looksLikeMarkdown('https://x.y/z'))
    assert.ok(looksLikeMarkdown('[cm]: https://spec.commonmark.org/0.31.2/'))
    assert.ok(looksLikeMarkdown('看 [规范][cm]'))
    assert.ok(looksLikeMarkdown('[^didion]: 底'))
  })
})

describe('参考式链接和连续脚注', () => {
  it('分行的 [label]: 定义不当段落，[text][label] 能解出来', () => {
    const md =
      '看 [规范][cm] 和 [gfm]。\n\n[cm]: https://spec.commonmark.org/0.31.2/ "CommonMark Spec 0.31.2"\n[gfm]: https://github.github.com/gfm/ "GitHub Flavored Markdown Spec"'
    const html = markdownToVisualHtml(md)
    assert.match(
      html,
      /<a href="https:\/\/spec\.commonmark\.org\/0\.31\.2\/" title="CommonMark Spec 0\.31\.2" data-linkref="cm">规范<\/a>/,
    )
    assert.match(
      html,
      /<a href="https:\/\/github\.github\.com\/gfm\/" title="GitHub Flavored Markdown Spec" data-linkref="gfm" data-shortcut="1">gfm<\/a>/,
    )
    assert.match(html, /data-linkdef="cm"/)
    assert.doesNotMatch(html, /<p>\[cm\]:/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('挤在一行的定义也能拆开', () => {
    const md =
      '[cm]: https://spec.commonmark.org/0.31.2/ "CommonMark Spec 0.31.2" [gfm]: https://github.github.com/gfm/ "GFM"\n\n[^didion]: 一 [^swartz]: 二'
    const html = markdownToVisualHtml(md)
    assert.match(html, /data-linkdef="cm"/)
    assert.match(html, /data-linkdef="gfm"/)
    assert.match(html, /<p data-fn="didion">一<\/p>/)
    assert.match(html, /<p data-fn="swartz">二<\/p>/)
    const back = visualHtmlToMarkdown(html)
    assert.match(back, /^\[cm\]: https:\/\/spec\.commonmark\.org\/0\.31\.2\/ "CommonMark Spec 0\.31\.2"$/m)
    assert.match(back, /^\[gfm\]: https:\/\/github\.github\.com\/gfm\/ "GFM"$/m)
    assert.match(back, /^\[\^didion\]: 一$/m)
    assert.match(back, /^\[\^swartz\]: 二$/m)
  })

  it('![alt][cup] 走参考定义', () => {
    const md =
      '![一小杯咖啡][cup]\n\n[cup]: https://upload.wikimedia.org/wikipedia/commons/4/45/A_small_cup_of_coffee.JPG "Wikimedia Commons：A small cup of coffee"'
    const html = markdownToVisualHtml(md)
    assert.match(
      html,
      /<img data-linkref="cup" src="https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/4\/45\/A_small_cup_of_coffee\.JPG" alt="一小杯咖啡" title="Wikimedia Commons：A small cup of coffee">/,
    )
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('文末挤成一段的参考链接和脚注定义也能拆开', () => {
    const md =
      '[cm]: https://spec.commonmark.org/0.31.2/ "CommonMark Spec 0.31.2" [gfm]: https://github.github.com/gfm/ "GitHub Flavored Markdown Spec" [didion-link]: https://www.parisreview.org/interviews/3439/the-art-of-fiction-no-71-joan-didion "The Art of Fiction No. 71: Joan Didion" [cup]: https://upload.wikimedia.org/wikipedia/commons/4/45/A_small_cup_of_coffee.JPG "Wikimedia Commons：A small cup of coffee"\n\n[^didion]: Joan Didion, “Why I Write,” *The New York Times Book Review*, 1976。后收入 *The White Album* 的周边论述里常被一并提起；我这里只用她反复说过的那句动机：写，是为了看见自己的想法。 [^swartz]: Aaron Swartz, “Guerilla Open Access Manifesto,” 2008。关心的是获取，不是声量。 [^render]: 全站把 Markdown 收成 HTML 的入口只有 `render_markdown`。阅读器、RSS、联邦和预览走同一份结果，见 `crates/myriad-phantasi-notes/src/lib.rs:175`。 [^words]: 汉字按字、拉丁按词，见 `crates/myriad-phantasi-notes/src/lib.rs:272`；每分钟 400，见同文件 `:27`。'
    const html = markdownToVisualHtml(md)
    assert.match(html, /data-linkdef="cm"/)
    assert.match(html, /data-linkdef="gfm"/)
    assert.match(html, /data-linkdef="didion-link"/)
    assert.match(html, /data-linkdef="cup"/)
    assert.match(html, /data-fn="didion"/)
    assert.match(html, /data-fn="swartz"/)
    assert.match(html, /data-fn="render"/)
    assert.match(html, /data-fn="words"/)
    assert.doesNotMatch(html, /<p>\[cm\]:/)
    const back = visualHtmlToMarkdown(html)
    assert.match(back, /^\[cm\]: https:\/\/spec\.commonmark\.org\/0\.31\.2\/ "CommonMark Spec 0\.31\.2"$/m)
    assert.match(back, /^\[gfm\]: https:\/\/github\.github\.com\/gfm\/ "GitHub Flavored Markdown Spec"$/m)
    assert.match(back, /^\[\^didion\]: Joan Didion/m)
    assert.match(back, /^\[\^words\]: 汉字按字/m)
    assert.doesNotMatch(back, /\[cm\]: .+ \[gfm\]:/)
  })

  it('Setext 下划线是标题，不是和正文挤成一行', () => {
    const html = markdownToVisualHtml('早晨的三件事\n---\n\n一张更大的牌子\n==============')
    assert.match(html, /<h2>早晨的三件事<\/h2>/)
    assert.match(html, /<h1>一张更大的牌子<\/h1>/)
    assert.doesNotMatch(html, /一张更大的牌子 =/)
  })

  it('引用空行上的 > 不会变成正文大于号', () => {
    const html = markdownToVisualHtml('> 上\n>\n> 下')
    assert.match(html, /<blockquote>上\s+下<\/blockquote>/)
    assert.doesNotMatch(html, /&gt;/)
  })

  it('波浪线围栏不和下文粘成 ~~~第一杯', () => {
    const html = markdownToVisualHtml('~~~\n围栏里\n~~~\n\n第一杯：16g')
    assert.match(html, /<pre><code>围栏里<\/code><\/pre>/)
    assert.match(html, /<p>第一杯：16g<\/p>/)
  })

  it('未闭合围栏不把文末定义吞进去', () => {
    const md =
      '看 [规范][cm]\n\n~~~第一杯：16g\n备忘\n\n[cm]: https://spec.commonmark.org/0.31.2/ "CommonMark Spec 0.31.2"'
    const expanded = expandJammedDefinitions(md)
    assert.match(expanded, /~~~\n\n\[cm\]:/)
    const html = markdownToVisualHtml(expanded)
    assert.match(html, /data-linkdef="cm"/)
    assert.match(html, /<pre[^>]*>[\s\S]*备忘/)
    assert.doesNotMatch(html, /<pre[^>]*>[\s\S]*\[cm\]:/)
  })

  it('expandJammedDefinitions 把挤在一行的定义拆开，围栏里不动', () => {
    const jammed =
      '[cm]: https://spec.commonmark.org/0.31.2/ "CommonMark Spec 0.31.2" [gfm]: https://github.github.com/gfm/ "GFM"'
    const expanded = expandJammedDefinitions(jammed)
    assert.equal(
      expanded,
      '[cm]: https://spec.commonmark.org/0.31.2/ "CommonMark Spec 0.31.2"\n[gfm]: https://github.github.com/gfm/ "GFM"',
    )
    assert.equal(
      expandJammedDefinitions(`\`\`\`\n${jammed}\n\`\`\``),
      `\`\`\`\n${jammed}\n\`\`\``,
    )
  })

  it('withLinkDefinitions 和后端一样在脚注前补参考定义；读路径不再调用', () => {
    const md =
      '看 [规范][cm]\n\n[cm]: https://spec.commonmark.org/0.31.2/ "CommonMark Spec 0.31.2"\n\n[^1]: 底'
    const html = withLinkDefinitions('<p>看</p><div class="footnote-definition">底</div>', md)
    assert.match(html, /<div class="link-definition"><a href="https:\/\/spec\.commonmark\.org\/0\.31\.2\/" title="CommonMark Spec 0\.31\.2">\[cm\] CommonMark Spec 0\.31\.2<\/a><\/div><div class="footnote-definition">/)
    const stamped = withLinkDefinitions(
      '<p>看</p><div data-md-start="8" data-md-end="20" class="footnote-definition">底</div>',
      md,
    )
    assert.match(
      stamped,
      /link-definition"><a href="https:\/\/spec\.commonmark\.org\/0\.31\.2\/" title="CommonMark Spec 0\.31\.2">\[cm\] CommonMark Spec 0\.31\.2<\/a><\/div><div data-md-start="8" data-md-end="20" class="footnote-definition">/,
    )
  })
})

describe('脚注引用', () => {
  it('正文里的 [^1] 是上标，转回来还是 [^1]', () => {
    const html = markdownToVisualHtml('见[^1]。')
    assert.match(html, /<sup data-fnref="1">1<\/sup>/)
    assert.equal(visualHtmlToMarkdown(html), '见[^1]。')
  })
})

describe('blocksWithOffsets / blockIndexAt', () => {
  it('每块记住起点，下标落到对应块', () => {
    const md = '# 标题\n\n第一段\n续行\n\n- 甲\n- 乙\n\n```js\nx\n```'
    const blocks = blocksWithOffsets(md)
    assert.deepEqual(
      blocks.map((b) => [b.start, b.text.split('\n')[0]]),
      [
        [0, '# 标题'],
        [6, '第一段'],
        [14, '- 甲'],
        [23, '```js'],
      ],
    )
    assert.equal(blockIndexAt(md, 0), 0)
    assert.equal(blockIndexAt(md, 7), 1)
    assert.equal(blockIndexAt(md, 13), 1)
    assert.equal(blockIndexAt(md, 14), 2)
    assert.equal(blockIndexAt(md, 99), 3)
  })

  it('预览 HTML 里 pre 带了别的属性，语言角标照样加', () => {
    assert.equal(
      withCodeLangLabels('<pre data-md-start="1" data-md-end="9"><code class="language-rust">x</code></pre>'),
      '<pre data-md-start="1" data-md-end="9" data-lang="rust"><code class="language-rust">x</code></pre>',
    )
  })
})

describe('insert helpers', () => {
  it('表格和脚注是 Markdown 语法', () => {
    assert.match(insertTableMarkdown(), /\| --- \|/)
    assert.equal(insertFootnoteMarkdown(2).mark, '[^2]')
  })
})

describe('正文分栏和正文小组件', () => {
  it('分栏和小组件转一圈还在', () => {
    const md = ':::columns\n左 **粗**\n:::col\n右\n:::\n\n:::widget weather 2x2'
    const html = markdownToVisualHtml(md)
    assert.match(html, /class="note-columns"/)
    assert.match(html, /class="note-column"/)
    assert.match(html, /<strong>粗<\/strong>/)
    assert.match(html, /data-widget="weather"/)
    assert.match(html, /data-size="2x2"/)
    assert.match(html, /class="note-widget not-prose"/)
    const back = visualHtmlToMarkdown(html)
    assert.match(back, /:::columns/)
    assert.match(back, /左 \*\*粗\*\*/)
    assert.match(back, /:::col/)
    assert.match(back, /:::widget weather 2x2/)
  })

  it('配置跟原文走，HTML 只放编码后的 data-config', () => {
    const md = ':::widget github-repos 2x2 {"repo":"owner/name"}'
    const html = markdownToVisualHtml(md)
    assert.match(html, /data-widget="github-repos"/)
    assert.match(html, /data-config="%7B%22repo%22%3A%22owner%2Fname%22%7D"/)
    assert.doesNotMatch(html, /onclick/)
    assert.equal(visualHtmlToMarkdown(html), md)
  })

  it('小组件只认属性，里面的 DOM 不进原文', () => {
    const html =
      '<div class="note-widget" data-widget="weather" data-size="2x2"><div onclick="alert(1)">内部</div></div>'
    assert.equal(visualHtmlToMarkdown(html), ':::widget weather 2x2')
  })

  it('水合后面的 face 再复杂也不写回原文', () => {
    const face = `
      <div class="note-widget__face">
        <h2>Freundeslinks</h2>
        <hr>
        <ul><li><a href="https://example.com">友链</a></li></ul>
        <div class="card"><p>Bilibili</p><div>1,234</div></div>
        <pre><code class="language-js">secret</code></pre>
      </div>`
    const visual =
      `<p>前</p><div class="note-widget not-prose" data-widget="friend-links" data-size="4x2" contenteditable="false">${face}</div>` +
      `<div class="note-widget not-prose" data-widget="report-bilibili" data-size="4x2" data-config="%7B%22platformId%22%3A%22bilibili%22%7D">${face}</div>` +
      `<div class="note-widget not-prose" data-widget="tapp-shortcut" data-size="1x1">${face}</div><p>后</p>`
    const back = visualHtmlToMarkdown(visual)
    assert.equal(
      back,
      '前\n\n:::widget friend-links 4x2\n\n:::widget report-bilibili 4x2 {"platformId":"bilibili"}\n\n:::widget tapp-shortcut 1x1\n\n后',
    )
    assert.doesNotMatch(back, /Freundeslinks|secret|1,234|友链|Bilibili/)
  })

  it('普通 div 仍按块切开，不吞进一行', () => {
    assert.equal(visualHtmlToMarkdown('<div>甲</div><div>乙</div>'), '甲\n\n乙')
  })

  it('代码围栏里的 ::: 不当分栏', () => {
    const html = markdownToVisualHtml('```\n:::columns\n左\n:::\n```')
    assert.doesNotMatch(html, /note-columns/)
    assert.match(html, /:::columns/)
  })
})

