import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  asDisplayMathBlock,
  looksLikeTex,
  mathIslandHtml,
  mathMarkdown,
  replaceMathMarkdown,
  splitBareTex,
  unwrapMathDelimiters,
} from './noteMath.ts'

describe('looksLikeTex', () => {
  it('认命令、上下标和单字母', () => {
    assert.equal(looksLikeTex(String.raw`\frac{1}{2}`), true)
    assert.equal(looksLikeTex('x^2'), true)
    assert.equal(looksLikeTex('E=mc^2'), true)
    assert.equal(looksLikeTex('x'), true)
  })

  it('价钱和空串不当公式', () => {
    assert.equal(looksLikeTex('100'), false)
    assert.equal(looksLikeTex('1,200'), false)
    assert.equal(looksLikeTex(''), false)
    assert.equal(looksLikeTex('just words'), false)
  })
})

describe('replaceMathMarkdown', () => {
  it('行内和块级都能换成岛', () => {
    const html = replaceMathMarkdown('见 $E=mc^2$ 和 $$\\frac{a}{b}$$')
    assert.match(html, /note-math-inline/)
    assert.match(html, /data-tex="E=mc\^2"/)
    assert.match(html, /note-math-display/)
    assert.match(html, /data-tex="\\frac\{a\}\{b\}"/)
  })

  it('花括号里的 $ 不当收尾', () => {
    const html = replaceMathMarkdown(String.raw`$f({a$b})$`)
    assert.match(html, /note-math-inline/)
    assert.match(html, /data-tex="f\(\{a\$b\}\)"/)
  })
})

describe('splitBareTex', () => {
  it('块级总拆，行内要像 TeX', () => {
    const pieces = splitBareTex('价 $100$ 和 $x^2$ 以及 $$a+b$$')
    assert.deepEqual(
      pieces.map((p) => [p.kind, p.value, p.display]),
      [
        ['text', '价 $100$ 和 ', undefined],
        ['math', 'x^2', false],
        ['text', ' 以及 ', undefined],
        ['math', 'a+b', true],
      ],
    )
  })
})

describe('math island', () => {
  it('往返 Markdown', () => {
    assert.equal(mathMarkdown('E=mc^2', false), '$E=mc^2$')
    assert.equal(mathMarkdown('E=mc^2', true), '$$\nE=mc^2\n$$')
    assert.match(mathIslandHtml('a<b', false), /data-tex="a&lt;b"/)
    assert.equal(asDisplayMathBlock('$$\nE=mc^2\n$$'), mathIslandHtml('E=mc^2', true))
    assert.equal(asDisplayMathBlock('见 $x$'), null)
    assert.deepEqual(unwrapMathDelimiters('$$ E=mc^2 $$'), {
      tex: 'E=mc^2',
      display: true,
    })
  })
})
