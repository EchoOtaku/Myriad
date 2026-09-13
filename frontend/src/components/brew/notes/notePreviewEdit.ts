/**
 * 点预览即编辑：把「预览里点到的位置」换算成 Markdown 原文里的下标。
 *
 * 块级靠后端在预览 HTML 上打的 `data-md-start/end`（原文字节区间），准；
 * 字级靠把点击处之前的纯文本和这一块的 Markdown 逐字对齐，跳过记号，尽量准。
 */

/** UTF-8 字节偏移 → JS 字符串下标。中文全是多字节，这一步不能省。 */
export function byteOffsetToIndex(text: string, byteOffset: number): number {
  let bytes = 0
  let index = 0
  for (const ch of text) {
    if (bytes >= byteOffset) break
    const code = ch.codePointAt(0)!
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    index += ch.length
  }
  return index
}

/** 行首的块级记号：标题井号、引用、列表、任务框、有序号。 */
const LINE_MARKERS = /^(?: {0,3}(?:#{1,6} |> |[-*+] (?:\[[ x]\] )?|\d+[.)] ))+/i

function skipLinkDestination(source: string, from: number): number {
  // 紧跟在 `]` 后面的 `(…)`：整段是地址和标题，纯文本里没有。
  if (source[from] !== '(') return from
  let depth = 0
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === '(') { depth += 1
}
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return source.length
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\u00A0'
}

/**
 * 在这一块的 Markdown 里找到「渲染后纯文本的前 N 个字」结束的位置。
 * 逐字符走源码：记号字符跳过，普通字符和纯文本比对；空白宽松匹配。
 * 对不上就停在对上的最后一个字后面——宁可差几个字，不要跳到别的地方。
 */
export function alignPlainTextInMarkdown(source: string, plainPrefix: string): number {
  const target = plainPrefix
  let t = 0
  let i = 0
  let lineStart = true
  let inCode = false
  const skipSpaces = () => {
    while (t < target.length && isSpace(target[t]!)) t += 1
  }
  while (i < source.length && t < target.length) {
    if (lineStart) {
      const marker = LINE_MARKERS.exec(source.slice(i))
      if (marker && marker[0].length > 0) i += marker[0].length
      lineStart = false
      if (source.startsWith('```', i)) {
        // 围栏行整行是记号
        const eol = source.indexOf('\n', i)
        i = eol < 0 ? source.length : eol + 1
        lineStart = true
        inCode = !inCode
        continue
      }
    }
    const ch = source[i]!
    if (ch === '\n') {
      i += 1
      lineStart = true
      // 源码换行在纯文本里是空格或者硬换行，两边都把空白吃掉
      skipSpaces()
      continue
    }
    if (!inCode) {
      if (ch === '\\' && i + 1 < source.length) {
        // 转义：下一个字才是字面
        i += 1
        if (source[i] === target[t]) {
          i += 1
          t += 1
          continue
        }
        continue
      }
      if (ch === '*' || ch === '_' || ch === '~' || ch === '`') {
        i += 1
        continue
      }
      if (ch === '!' && source[i + 1] === '[') {
        // 图片：alt 不在纯文本里（渲染成 <img>），整段跳过
        const close = source.indexOf(']', i + 2)
        i = close < 0 ? source.length : skipLinkDestination(source, close + 1)
        continue
      }
      if (ch === '[') {
        // 脚注引用 [^x] 渲染成编号，正文里不是这串字，跳过整段
        if (source[i + 1] === '^') {
          const close = source.indexOf(']', i + 2)
          i = close < 0 ? source.length : close + 1
          continue
        }
        i += 1
        continue
      }
      if (ch === ']') {
        i = skipLinkDestination(source, i + 1)
        continue
      }
      if (ch === '<' || ch === '>') {
        i += 1
        continue
      }
    }
    if (isSpace(ch)) {
      // 源码里的连续空白 ↔ 纯文本里的一个空白
      while (i < source.length && isSpace(source[i]!) && source[i] !== '\n') i += 1
      skipSpaces()
      continue
    }
    if (isSpace(target[t]!)) {
      skipSpaces()
      continue
    }
    if (ch === target[t]) {
      i += 1
      t += 1
      continue
    }
    // 对不上：停在这里
    break
  }
  return i
}

/** 预览里点到的块 → 原文区间（字符下标）。没打区间的块（比如脚注定义里的段落）返回 null。 */
export function blockSourceRange(
  markdown: string,
  block: { start: string | undefined; end: string | undefined },
): { start: number; end: number } | null {
  if (block.start === undefined || block.end === undefined) return null
  const startBytes = Number(block.start)
  const endBytes = Number(block.end)
  if (!Number.isFinite(startBytes) || !Number.isFinite(endBytes) || endBytes < startBytes) return null
  return {
    start: byteOffsetToIndex(markdown, startBytes),
    end: byteOffsetToIndex(markdown, endBytes),
  }
}

/** 点击落点：块的原文区间 + 点击前的纯文本 → Markdown 下标。 */
export function previewClickToMarkdownIndex(
  markdown: string,
  range: { start: number; end: number },
  plainPrefix: string,
): number {
  const source = markdown.slice(range.start, range.end)
  return range.start + alignPlainTextInMarkdown(source, plainPrefix)
}
