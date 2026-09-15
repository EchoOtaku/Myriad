/** 笔记公式：和 pulldown-cmark `ENABLE_MATH` 同一套 `$` / `$$`。 */

export function looksLikeTex(tex: string): boolean {
  const t = tex.trim()
  if (!t || t.length > 4000) return false
  if (/^\d+([.,]\d+)*$/.test(t)) return false
  if (/\\[a-zA-Z]+/.test(t)) return true
  if (/[\^_{}]/.test(t)) return true
  if (/^[A-Za-z][A-Za-z0-9']*$/.test(t)) return true
  return /=/.test(t) && /[A-Za-z\\]/.test(t)
}

export function unwrapMathDelimiters(raw: string): { tex: string; display: boolean } {
  const t = raw.trim()
  if (t.startsWith('$$') && t.endsWith('$$') && t.length >= 4) {
    return { tex: t.slice(2, -2).trim(), display: true }
  }
  if (t.startsWith('$') && t.endsWith('$') && t.length >= 2) {
    return { tex: t.slice(1, -1).trim(), display: false }
  }
  return { tex: t, display: false }
}

export function mathMarkdown(tex: string, display: boolean): string {
  const body = tex.trim()
  return display ? `$$\n${body}\n$$` : `$${body}$`
}

export function mathIslandHtml(
  tex: string,
  display: boolean,
  tag: 'span' | 'div' = display ? 'div' : 'span',
): string {
  const safe = escapeAttr(tex.trim())
  const kind = display ? 'note-math-display' : 'note-math-inline'
  return `<${tag} class="note-math ${kind}" data-tex="${safe}" contenteditable="false"></${tag}>`
}

export function asDisplayMathBlock(text: string): string | null {
  if (!/^\s*\$\$/.test(text) || !/\$\$\s*$/.test(text)) return null
  const trimmed = text.trim()
  if (trimmed.length < 4) return null
  const inner = trimmed.slice(2, -2)
  if (inner.includes('$$')) return null
  return mathIslandHtml(inner.trim(), true)
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function unescapeTex(escaped: string): string {
  return escaped
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .trim()
}

function findMathClose(text: string, from: number, delim: string): number {
  let depth = 0
  let i = from
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '{') {
      depth += 1
      i += 1
      continue
    }
    if (ch === '}' && depth > 0) {
      depth -= 1
      i += 1
      continue
    }
    if (depth === 0 && text.startsWith(delim, i)) {
      if (delim === '$' && i > 0 && text[i - 1] === ' ') {
        i += 1
        continue
      }
      return i
    }
    i += 1
  }
  return -1
}

/** 已转义、代码已挪走的字符串上，把 `$` / `$$` 换成可视层岛。 */
export function replaceMathMarkdown(escaped: string): string {
  let out = ''
  let i = 0
  while (i < escaped.length) {
    if (escaped.startsWith('$$', i)) {
      const close = findMathClose(escaped, i + 2, '$$')
      if (close >= 0) {
        out += mathIslandHtml(unescapeTex(escaped.slice(i + 2, close)), true, 'span')
        i = close + 2
        continue
      }
    }
    const next = escaped[i + 1]
    if (escaped[i] === '$' && next && next !== '$' && next !== ' ' && next !== '\n') {
      const close = findMathClose(escaped, i + 1, '$')
      if (close >= 0) {
        const tex = unescapeTex(escaped.slice(i + 1, close))
        if (tex && !tex.includes('\n')) {
          out += mathIslandHtml(tex, false, 'span')
          i = close + 1
          continue
        }
      }
    }
    out += escaped[i]
    i += 1
  }
  return out
}

export interface BareTexPiece {
  kind: 'text' | 'math'
  value: string
  display?: boolean
}

/** 订阅正文里残留的 `$` / `$$`。行内要看起来像 TeX 才拆。 */
export function splitBareTex(text: string): BareTexPiece[] {
  const pieces: BareTexPiece[] = []
  let i = 0
  let buf = ''
  const flush = () => {
    if (buf) pieces.push({ kind: 'text', value: buf })
    buf = ''
  }
  while (i < text.length) {
    if (text.startsWith('$$', i)) {
      const close = findMathClose(text, i + 2, '$$')
      if (close >= 0) {
        const tex = text.slice(i + 2, close).trim()
        if (tex) {
          flush()
          pieces.push({ kind: 'math', value: tex, display: true })
          i = close + 2
          continue
        }
      }
    }
    const next = text[i + 1]
    if (text[i] === '$' && next && next !== '$' && next !== ' ' && next !== '\n') {
      const close = findMathClose(text, i + 1, '$')
      if (close >= 0) {
        const tex = text.slice(i + 1, close).trim()
        if (tex && !tex.includes('\n') && looksLikeTex(tex)) {
          flush()
          pieces.push({ kind: 'math', value: tex, display: false })
          i = close + 1
          continue
        }
      }
    }
    buf += text[i]
    i += 1
  }
  flush()
  return pieces.length > 0 ? pieces : [{ kind: 'text', value: text }]
}
