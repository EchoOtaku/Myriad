import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderTexToHtml } from './renderMath.ts'

describe('renderTexToHtml', () => {
  it('行内和块级都产出 KaTeX', () => {
    const inline = renderTexToHtml('E=mc^2', false)
    assert.match(inline, /class="katex"/)
    assert.doesNotMatch(inline, /katex-display/)
    const display = renderTexToHtml(String.raw`\frac{1}{2}`, true)
    assert.match(display, /katex-display/)
  })

  it('坏公式不抛，标出错误', () => {
    const html = renderTexToHtml(String.raw`\notacommand{`, false)
    assert.match(html, /katex-error|ParseError|\\\\notacommand/)
  })
})
