import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { before, describe, it } from 'node:test'
import {
  extractClipboardFragment,
  htmlHasRichBlocks,
  insertPastedMarkdown,
  looksLikeOfficeHtml,
  looksLikePlainTable,
  normalizePastedHtml,
  pastedClipboardToMarkdown,
  pastedClipboardToVisualHtml,
  pastedHtmlToMarkdown,
  plainTableToMarkdown,
} from './notePaste.ts'
import { markdownToVisualHtml, visualHtmlToMarkdown } from './noteVisual.ts'

const require = createRequire(import.meta.url)
const { JSDOM } = require(
  require.resolve('jsdom', {
    paths: [require.resolve('isomorphic-dompurify')],
  }),
)

before(() => {
  const dom = new JSDOM('')
  globalThis.DOMParser = dom.window.DOMParser
})

const WORD_TABLE = `
<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<style>
<!--
p.MsoNormal { font-size:12.0pt; }
-->
</style>
</head>
<body>
<!--StartFragment-->
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0>
 <tr>
  <td width=120 valign=top style='width:90pt;text-align:center'>
  <p class=MsoNormal><b>列甲</b></p>
  </td>
  <td width=120 valign=top>
  <p class=MsoNormal>列乙</p>
  </td>
 </tr>
 <tr>
  <td>
  <p class=MsoNormal>一</p>
  </td>
  <td>
  <p class=MsoNormal>二</p>
  </td>
 </tr>
</table>
<!--EndFragment-->
</body>
</html>
`

const WORD_COLSPAN = `
<!--StartFragment-->
<table class="MsoTableGrid">
 <tr>
  <td colspan="2" style="text-align:center"><p class="MsoNormal">总标题</p></td>
 </tr>
 <tr>
  <td><p class="MsoNormal">左</p></td>
  <td><p class="MsoNormal">右</p></td>
 </tr>
</table>
<!--EndFragment-->
`

describe('extractClipboardFragment', () => {
  it('只取 StartFragment 到 EndFragment', () => {
    const out = extractClipboardFragment(WORD_TABLE)
    assert.match(out, /MsoTableGrid/)
    assert.doesNotMatch(out, /font-size:12/)
  })
})

describe('looksLikeOfficeHtml / htmlHasRichBlocks', () => {
  it('认得 Word 和普通表', () => {
    assert.equal(looksLikeOfficeHtml(WORD_TABLE), true)
    assert.equal(htmlHasRichBlocks(WORD_TABLE), true)
    assert.equal(htmlHasRichBlocks('<p>只有一段</p>'), false)
    assert.equal(htmlHasRichBlocks('<table><tr><td>a</td></tr></table>'), true)
  })

  it('Chrome 的 StartFragment 不当 Office，有加粗才算富文本', () => {
    const chrome =
      '<html><body><!--StartFragment--><p>一段</p><!--EndFragment--></body></html>'
    assert.equal(looksLikeOfficeHtml(chrome), false)
    assert.equal(htmlHasRichBlocks(chrome), false)
    assert.equal(htmlHasRichBlocks('<p><b>粗</b></p>'), true)
  })
})

describe('normalizePastedHtml / Word 表格', () => {
  it('Mso 表变成干净 table，第一行是 th，对齐还在', () => {
    const html = normalizePastedHtml(WORD_TABLE)
    assert.match(html, /<table>/)
    assert.match(html, /<th align="center"><strong>列甲<\/strong><\/th>/)
    assert.match(html, /<th>列乙<\/th>/)
    assert.match(html, /<td>一<\/td>/)
    assert.doesNotMatch(html, /Mso/)
    assert.doesNotMatch(html, /<style/)
    assert.doesNotMatch(html, /class=/)
  })

  it('合并单元格拆成矩形表', () => {
    const html = normalizePastedHtml(WORD_COLSPAN)
    assert.match(html, /<th align="center">总标题<\/th><th align="center"><\/th>/)
    assert.match(html, /<td>左<\/td><td>右<\/td>/)
    assert.doesNotMatch(html, /colspan/)
  })

  it('脚本和 javascript: 链接丢干净', () => {
    const html = normalizePastedHtml(
      '<p>安全</p><script>alert(1)</script><p><a href="javascript:alert(1)">点</a></p>',
    )
    assert.match(html, /安全/)
    assert.doesNotMatch(html, /<script/)
    assert.doesNotMatch(html, /javascript:/)
    assert.match(html, />点</)
  })

  it('本地图丢掉，https 图留下', () => {
    const html = normalizePastedHtml(
      '<p><img src="file:///C:/Users/a.png" alt="x"><img src="https://cdn.example/a.png" alt="封面"></p>',
    )
    assert.doesNotMatch(html, /file:/)
    assert.match(html, /src="https:\/\/cdn.example\/a.png"/)
    assert.match(html, /alt="封面"/)
  })

  it('span 上的加粗斜体提成标签', () => {
    const html = normalizePastedHtml(
      '<p><span style="font-weight:bold">粗</span>和<span style="font-style:italic">斜</span></p>',
    )
    assert.match(html, /<strong>粗<\/strong>/)
    assert.match(html, /<em>斜<\/em>/)
  })

  it('Google Docs 表也能洗', () => {
    const html = normalizePastedHtml(
      '<table><colgroup><col></colgroup><tbody><tr><td><p dir="ltr">A</p></td><td><p dir="ltr">B</p></td></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
    )
    assert.match(html, /<th>A<\/th><th>B<\/th>/)
    assert.match(html, /<td>1<\/td><td>2<\/td>/)
  })

  it('MathML / KaTeX / 阅读器公式都收成岛', () => {
    const html = normalizePastedHtml(`
      <p>见
        <math xmlns="http://www.w3.org/1998/Math/MathML">
          <semantics>
            <mrow><mi>E</mi></mrow>
            <annotation encoding="application/x-tex">E=mc^2</annotation>
          </semantics>
        </math>
        和
        <span class="katex">
          <span class="katex-mathml">
            <math><annotation encoding="application/x-tex">x^2</annotation></math>
          </span>
        </span>
        以及
        <span class="math math-inline" data-tex="a+b">a+b</span>
      </p>
    `)
    assert.match(html, /note-math-inline/)
    assert.match(html, /data-tex="E=mc\^2"/)
    assert.match(html, /data-tex="x\^2"/)
    assert.match(html, /data-tex="a\+b"/)
    assert.doesNotMatch(html, /<math/)
    assert.doesNotMatch(html, /katex-mathml/)
  })

  it('粘贴里的裸 $ 也收成岛，代码里不动', () => {
    const html = normalizePastedHtml('<p>见 $E=mc^2$</p><pre><code>$E=mc^2$</code></pre>')
    assert.match(html, /note-math-inline/)
    assert.match(html, /data-tex="E=mc\^2"/)
    assert.match(html, /<pre><code>\$E=mc\^2\$<\/code><\/pre>/)
  })

  it('Word 列表段落收成 ul/ol', () => {
    const html = normalizePastedHtml(`
      <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">
        <span style="mso-list:Ignore">1.</span>甲
      </p>
      <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">
        <span style="mso-list:Ignore">2.</span>乙
      </p>
    `)
    assert.match(html, /<ol>/)
    assert.match(html, /<li>甲<\/li>/)
    assert.match(html, /<li>乙<\/li>/)
  })
})

describe('pastedHtmlToMarkdown', () => {
  it('Word 表变成 Markdown 表，对齐进分隔行', () => {
    const md = pastedHtmlToMarkdown(WORD_TABLE)
    assert.match(md, /\| \*\*列甲\*\* \| 列乙 \|/)
    assert.match(md, /\| :---: \| --- \|/)
    assert.match(md, /\| 一 \| 二 \|/)
  })
})

describe('plain table', () => {
  it('制表符表认得并转成 Markdown', () => {
    const text = '列甲\t列乙\n一\t二'
    assert.equal(looksLikePlainTable(text), true)
    assert.equal(looksLikePlainTable('只是一句话'), false)
    assert.equal(plainTableToMarkdown(text), '| 列甲 | 列乙 |\n| --- | --- |\n| 一 | 二 |')
  })

  it('Excel / Word 纯文本回落到表', () => {
    const md = pastedClipboardToMarkdown('', 'A\tB\n1\t2')
    assert.equal(md, '| A | B |\n| --- | --- |\n| 1 | 2 |')
  })
})

describe('pastedClipboardToVisualHtml', () => {
  it('有 HTML 就洗，不把 Mso 带进可视层', () => {
    const html = pastedClipboardToVisualHtml(WORD_TABLE, '列甲\t列乙\n一\t二')
    assert.ok(html)
    assert.match(html!, /<table>/)
    assert.doesNotMatch(html!, /Mso/)
  })
})

describe('insertPastedMarkdown', () => {
  it('块级内容前后补空行，避免粘进段落', () => {
    const next = insertPastedMarkdown('前文后文', 2, 2, '| A | B |\n| --- | --- |\n| 1 | 2 |')
    assert.equal(next.value, '前文\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n后文')
  })
})

describe('visualHtmlToMarkdown 套层', () => {
  it('div 里的表格还能转成 Markdown 表', () => {
    const md = visualHtmlToMarkdown(
      '<div><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></div>',
    )
    assert.match(md, /\| A \| B \|/)
    assert.match(md, /\| 1 \| 2 \|/)
  })

  it('表头 style 对齐也能认', () => {
    const md = visualHtmlToMarkdown(
      '<table><tr><td style="text-align:center">A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>',
    )
    assert.match(md, /\| :---: \| --- \|/)
  })
})

describe('pasted table cell line breaks (#359)', () => {
  it('keeps both model names in the value cell through repeated edits', () => {
    const html =
      '<table><tr><th>PARAM</th><th>VALUE</th></tr><tr><td>model</td><td><code>deepseek-flash</code> (1)<br><code>deepseek-v4-pro</code> (2)</td></tr></table>'
    const expected =
      '| PARAM | VALUE |\n| --- | --- |\n| model | `deepseek-flash` (1)<br>`deepseek-v4-pro` (2) |'
    let md = pastedHtmlToMarkdown(html)
    assert.equal(md, expected)
    for (let i = 0; i < 3; i += 1) {
      const visual = markdownToVisualHtml(md)
      assert.match(
        visual,
        /<td><code>deepseek-flash<\/code> \(1\)<br><code>deepseek-v4-pro<\/code> \(2\)<\/td>/,
      )
      md = visualHtmlToMarkdown(visual)
      assert.equal(md, expected)
    }
  })
})
