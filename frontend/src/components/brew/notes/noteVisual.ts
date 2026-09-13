/**
 * 可视编辑只服务输入。预览和发布仍走后端渲染。
 *
 * 前半是纯字符串转换（Markdown ↔ 可视层 HTML），能在 node 里测；
 * 后半是对 contenteditable 的 DOM 操作，只在浏览器里跑。
 */

import {
  decodeWidgetConfigAttr,
  eatMdFence,
  encodeWidgetConfigAttr,
  hasNoteClass,
  insertColumnsMarkdown,
  insertWidgetMarkdown,
  layoutAttr,
  mdFenceClose,
  mdFenceOpen,
  NOTE_MAX_COLUMNS,
  normalizeNoteWidgetSize,
  parseNoteLayout,
  serializeColumns,
  serializeWidget,
  type MdFence,
  type NoteWidgetConfig,
} from './noteLayout'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 反斜杠转义先挪成占位符，免得被下面的规则当记号；转回 Markdown 时还原成 `\x`。 */
const ESCAPABLE = '\\`*_{}[]()#+-.!~<>|'
const ESC_MARK = '\uE000'

function stashEscapes(text: string): string {
  return text.replaceAll(/\\([\\`*_{}[\]()#+\-.!~<>|])/g, (_m, ch: string) => {
    const index = ESCAPABLE.indexOf(ch)
    return `${ESC_MARK}${String.fromCharCode(0xE100 + index)}`
  })
}

function renderEscapes(html: string): string {
  return html.replaceAll(/\uE000([\uE100-\uE1FF])/g, (_m, code: string) => {
    const ch = ESCAPABLE[code.charCodeAt(0) - 0xE100] ?? ''
    return `<span data-esc="${escapeHtml(ch)}">${escapeHtml(ch)}</span>`
  })
}

/**
 * 图片显示地址的解析器。Markdown 里存原地址（写在 data-src），浏览器看的是解析后的 src。
 * 默认不解析；编辑器装上 `displayImageUrl` 后本站媒体会改走当前 API origin。
 */
let resolveImageSrc: (src: string) => string = (src) => src

export function setVisualImageResolver(resolver: (src: string) => string): void {
  resolveImageSrc = resolver
}

function imgTag(src: string, alt: string, title = ''): string {
  const shown = resolveImageSrc(src)
  const original = shown === src ? '' : ` data-src="${src}"`
  const titled = title ? ` title="${title}"` : ''
  return `<img src="${shown}"${original} alt="${alt}"${titled}>`
}

/**
 * 链接 / 图片的目标：`(地址)`、`(地址 "标题")`、`(地址 '标题')`。
 * 文字已经过 escapeHtml，所以标题的双引号在这里是 `&quot;`。
 */
const LINK_DEST = String.raw`\(\s*([^\s)]+)(?:\s+(?:&quot;((?:(?!&quot;)[^)])*)&quot;|'([^')]*)'))?\s*\)`
const IMAGE_RE = new RegExp(String.raw`!\[([^\]]*)\]${LINK_DEST}`, 'g')
const LINK_RE = new RegExp(String.raw`(?<!!)\[([^\]]+)\]${LINK_DEST}`, 'g')
/** `[label]: dest "title"`，label 不能是脚注的 `^id`。 */
const LINK_DEF_RE =
  /\[(?!\^)([^\]]+)\]:\s+(?:<([^>\s]+)>|(\S+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?/
const LINK_DEF_LINE = new RegExp(`^\\s*${LINK_DEF_RE.source}\\s*$`)
const FN_DEF_START = /^\[\^([^\]\s]+)\]:\s*/

interface LinkDef {
  label: string
  href: string
  title: string
}

const EMPTY_DEFS: ReadonlyMap<string, LinkDef> = new Map()

function parseLinkDef(text: string): LinkDef | null {
  const match = LINK_DEF_LINE.exec(text.trim())
  if (!match) return null
  return {
    label: match[1]!.trim(),
    href: match[2] || match[3] || '',
    title: match[4] ?? match[5] ?? match[6] ?? '',
  }
}

function collectLinkDefs(markdown: string): Map<string, LinkDef> {
  const defs = new Map<string, LinkDef>()
  const fence = { current: null as MdFence | null }
  for (const line of markdown.split('\n')) {
    if (eatMdFence(line, fence)) continue
    const def = parseLinkDef(line)
    if (!def) continue
    const key = def.label.toLowerCase()
    if (defs.has(key)) continue
    defs.set(key, def)
  }
  return defs
}

function nextDefIndex(text: string): number {
  const footnote = text.search(/\[\^[^\]\s]+\]:/)
  const link = text.search(/\[(?!\^)[^\]]+\]:\s+\S/)
  if (footnote < 0) return link
  if (link < 0) return footnote
  return Math.min(footnote, link)
}

/** 同一段里挤了多条 `[id]:` / `[^id]:` 时拆开。已经分行的定义保持原样。 */
export function expandJammedDefinitions(markdown: string): string {
  const fence = { current: null as MdFence | null }
  const expanded = markdown
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => {
      if (eatMdFence(line, fence)) return line
      const pieces = splitDefinitionBlocks(line)
      return pieces.length > 1 ? pieces.join('\n') : line
    })
    .join('\n')
  return closeFenceBeforeTrailingDefs(expanded)
}

function isDefinitionLine(line: string): boolean {
  const trimmed = line.trim()
  return FN_DEF_START.test(trimmed) || parseLinkDef(trimmed) != null
}

function closeFenceBeforeTrailingDefs(markdown: string): string {
  const lines = markdown.split('\n')
  let open: MdFence | null = null
  let openerAt = -1
  for (const [index, line] of lines.entries()) {
    if (!open) {
      const next = mdFenceOpen(line)
      if (next) {
        open = next
        openerAt = index
      }
      continue
    }
    if (mdFenceClose(line, open)) open = null
  }
  if (!open || openerAt < 0) return markdown
  let end = lines.length
  while (end > 0 && lines[end - 1]!.trim() === '') end -= 1
  let start = end
  while (start > 0 && isDefinitionLine(lines[start - 1]!)) start -= 1
  if (start === end || start <= openerAt) return markdown
  const closer = open.ch.repeat(open.n)
  return [...lines.slice(0, start), closer, '', ...lines.slice(start)].join('\n')
}

function splitDefinitionBlocks(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[')) return [text]
  const out: string[] = []
  let rest = trimmed
  while (rest) {
    const footnote = FN_DEF_START.exec(rest)
    if (footnote) {
      const after = rest.slice(footnote[0].length)
      const next = nextDefIndex(after)
      const body = (next < 0 ? after : after.slice(0, next)).trim()
      out.push(`${footnote[0]}${body}`.trim())
      rest = next < 0 ? '' : after.slice(next).trimStart()
      continue
    }
    const link = new RegExp(`^${LINK_DEF_RE.source}`).exec(rest)
    if (link) {
      out.push(link[0].trim())
      rest = rest.slice(link[0].length).trimStart()
      continue
    }
    if (out.length === 0) return [text]
    out.push(rest)
    break
  }
  return out.length > 0 ? out : [text]
}

function resolveDefinedLink(
  defs: ReadonlyMap<string, LinkDef>,
  label: string,
  id: string,
): string | null {
  const def = defs.get((id || label).toLowerCase())
  if (!def) return null
  const title = def.title ? ` title="${escapeHtml(def.title)}"` : ''
  const ref = escapeHtml(id || label)
  return `<a href="${escapeHtml(def.href)}"${title} data-linkref="${ref}">${label}</a>`
}

/** 行内 Markdown → HTML。`  \n` 和 `\\\n` 是硬换行，普通换行只是空格。 */
function inlineMarkdown(text: string, defs: ReadonlyMap<string, LinkDef> = EMPTY_DEFS): string {
  const html = escapeHtml(stashEscapes(text))
    .replaceAll(/(?: {2,}|\\)\n/g, '<br>')
    .replaceAll('\n', ' ')
    .replace(IMAGE_RE, (_m, alt: string, src: string, dq?: string, sq?: string) =>
      imgTag(src, alt, dq ?? sq ?? ''),
    )
    .replace(/!\[([^\]]*)\]\[([^\]\s]*)\]/g, (match, alt: string, id: string) => {
      const def = defs.get((id || alt).toLowerCase())
      if (!def) return match
      const ref = escapeHtml(id || alt)
      return imgTag(escapeHtml(def.href), alt, escapeHtml(def.title)).replace(
        /<img /,
        `<img data-linkref="${ref}" `,
      )
    })
    .replace(/\[\^([^\]\s]+)\](?!:)/g, '<sup data-fnref="$1">$1</sup>')
    .replace(LINK_RE, (_m, label: string, href: string, dq?: string, sq?: string) => {
      const title = dq ?? sq ?? ''
      return `<a href="${href}"${title ? ` title="${title}"` : ''}>${label}</a>`
    })
    .replace(
      /\[([^\]]+)\]\[([^\]\s]*)\]/g,
      (match, label: string, id: string) => resolveDefinedLink(defs, label, id) ?? match,
    )
    .replace(/\[(?!\^)([^\]\s]+)\](?!\(|\[|:)/g, (match, id: string) => {
      const def = defs.get(id.toLowerCase())
      if (!def) return match
      const title = def.title ? ` title="${escapeHtml(def.title)}"` : ''
      return `<a href="${escapeHtml(def.href)}"${title} data-linkref="${id}" data-shortcut="1">${id}</a>`
    })
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" data-autolink="1">$1</a>')
    .replace(
      /&lt;([\w.+-]+@[\w-]+(?:\.[\w-]+)+)&gt;/g,
      '<a href="mailto:$1" data-autolink="1">$1</a>',
    )
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return renderEscapes(html)
}

const LIST_LINE = /^( *)([-*]|\d+\.) (\[([ x])\] )?(.*)$/i

export interface MarkdownBlock {
  text: string
  /** 块第一行在原文里的字符下标。 */
  start: number
}

/** 切块，并记住每块从原文哪个下标开始；可视层的第 i 个块就是这里的第 i 个。 */
function splitPlainBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let current: string[] = []
  let currentStart = 0
  let offset = 0
  const fence = { current: null as MdFence | null }
  const flush = () => {
    const text = current.join('\n').trimEnd()
    if (text.trim()) {
      let next = currentStart
      for (const piece of splitDefinitionBlocks(text)) {
        blocks.push({ text: piece, start: next })
        next += piece.length + 1
      }
    }
    current = []
  }
  for (const line of lines) {
    const lineStart = offset
    offset += line.length + 1
    if (fence.current) {
      current.push(line)
      if (mdFenceClose(line, fence.current)) {
        fence.current = null
        flush()
      }
      continue
    }
    const open = mdFenceOpen(line)
    if (open) {
      flush()
      currentStart = lineStart
      current.push(line)
      fence.current = open
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    if (
      current.length === 1 &&
      blockKind(current[0]!) === 'text' &&
      isSetextUnderline(line)
    ) {
      current.push(line)
      flush()
      continue
    }
    const head = current[0]
    if (head !== undefined) {
      const headKind = blockKind(head)
      const lineKind = blockKind(line)
      // 标题、分隔线只有一行；别的块换了种类就断开；普通行接在任何块后面都是续行。
      if (
        headKind === 'heading' ||
        headKind === 'hr' ||
        headKind === 'footnote' ||
        headKind === 'linkdef' ||
        lineKind === 'footnote' ||
        lineKind === 'linkdef' ||
        (lineKind !== 'text' && lineKind !== headKind)
      ) {
        flush()
      }
    }
    if (current.length === 0) currentStart = lineStart
    current.push(line)
  }
  flush()
  return blocks
}

export function blocksWithOffsets(markdown: string): MarkdownBlock[] {
  const src = markdown.replaceAll('\r\n', '\n')
  const blocks: MarkdownBlock[] = []
  for (const seg of parseNoteLayout(src)) {
    if (seg.kind === 'text') {
      for (const block of splitPlainBlocks(seg.text)) {
        blocks.push({ text: block.text, start: seg.start + block.start })
      }
      continue
    }
    blocks.push({ text: src.slice(seg.start, seg.end), start: seg.start })
  }
  return blocks
}

function blocksOf(markdown: string): string[] {
  return blocksWithOffsets(markdown).map((block) => block.text)
}

/** 原文下标落在第几个块里（块序号从 0 起；落在两块之间算前一块）。 */
export function blockIndexAt(markdown: string, index: number): number {
  const blocks = blocksWithOffsets(markdown)
  let found = 0
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i]!.start <= index) found = i
    else break
  }
  return found
}

/** 把光标放到元素里第 n 个纯文本字符后面；文字不够就放到末尾。 */
export function placeCaretAtTextOffset(root: HTMLElement, target: HTMLElement, offset: number): void {
  const doc = root.ownerDocument
  const selection = doc.getSelection()
  const range = doc.createRange()
  const walker = doc.createTreeWalker(target, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let last: Text | null = null
  let node = walker.nextNode() as Text | null
  while (node) {
    last = node
    if (remaining <= node.data.length) {
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    remaining -= node.data.length
    node = walker.nextNode() as Text | null
  }
  if (last) range.setStart(last, last.data.length)
  else range.selectNodeContents(target)
  range.collapse(!last)
  if (!last) range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

type BlockKind =
  | 'heading'
  | 'hr'
  | 'quote'
  | 'table'
  | 'ul'
  | 'ol'
  | 'footnote'
  | 'linkdef'
  | 'text'

function isSetextUnderline(line: string): boolean {
  return /^(={3,}|-{3,})\s*$/.test(line.trim())
}

function blockKind(line: string): BlockKind {
  if (/^#{1,6} /.test(line)) return 'heading'
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) return 'hr'
  if (line.startsWith('> ')) return 'quote'
  if (line.startsWith('|')) return 'table'
  if (/^[-*] /.test(line)) return 'ul'
  if (/^\d+\. /.test(line)) return 'ol'
  if (/^\[\^[^\]\s]+\]:/.test(line)) return 'footnote'
  if (LINK_DEF_LINE.test(line)) return 'linkdef'
  return 'text'
}

interface ListNode {
  text: string
  ordered: boolean
  task: boolean | null
  children: ListNode[]
}

/** 按缩进把列表行搭成树。缩进只看相对深浅，不要求恰好两格。 */
function parseListTree(
  block: string,
  defs: ReadonlyMap<string, LinkDef> = EMPTY_DEFS,
): ListNode[] {
  const roots: ListNode[] = []
  const stack: { indent: number; node: ListNode }[] = []
  for (const row of block.split('\n')) {
    const match = LIST_LINE.exec(row)
    if (!match) {
      // 续行接到上一项
      const last = stack.at(-1)?.node
      if (last) last.text += `<br>${inlineMarkdown(row.trim(), defs)}`
      continue
    }
    const indent = match[1]!.length
    const node: ListNode = {
      text: inlineMarkdown(match[5] ?? '', defs),
      ordered: /\d/.test(match[2]!),
      task: match[3] ? match[4]!.toLowerCase() === 'x' : null,
      children: [],
    }
    while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop()
    const parent = stack.at(-1)?.node
    if (parent) parent.children.push(node)
    else roots.push(node)
    stack.push({ indent, node })
  }
  return roots
}

function renderListTree(nodes: ListNode[]): string {
  if (nodes.length === 0) return ''
  const ordered = nodes[0]!.ordered
  const tag = ordered ? 'ol' : 'ul'
  const listAttr = nodes[0]!.task != null ? ' data-task="1"' : ''
  const items = nodes
    .map((node) => {
      const attr = node.task == null ? '' : ` data-task="${node.task ? '1' : '0'}"`
      return `<li${attr}>${node.text}${renderListTree(node.children)}</li>`
    })
    .join('')
  return `<${tag}${listAttr}>${items}</${tag}>`
}

type CellAlign = 'left' | 'center' | 'right' | null

function splitTableRow(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
}

function parseAlignRow(row: string): CellAlign[] {
  return splitTableRow(row).map((cell) => {
    const spec = cell.trim()
    const left = spec.startsWith(':')
    const right = spec.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function alignAttr(align: CellAlign): string {
  return align ? ` align="${align}"` : ''
}

/** 表格：第二行 `:---:` 决定每列对齐，落在单元格的 `align` 属性上，和后端一致。 */
function renderTable(
  block: string,
  defs: ReadonlyMap<string, LinkDef> = EMPTY_DEFS,
): string {
  const lines = block.split('\n')
  const alignIndex = lines.findIndex((row) => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(row))
  const aligns = alignIndex >= 0 ? parseAlignRow(lines[alignIndex]!) : []
  const rows = lines.filter((_row, index) => index !== alignIndex)
  const html = rows
    .map((row, index) => {
      const tag = index === 0 ? 'th' : 'td'
      const cells = splitTableRow(row)
        .map(
          (cell, col) =>
            `<${tag}${alignAttr(aligns[col] ?? null)}>${inlineMarkdown(cell.trim(), defs)}</${tag}>`,
        )
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  return `<table>${html}</table>`
}

function renderPlainVisual(markdown: string, defs: ReadonlyMap<string, LinkDef>): string {
  return splitPlainBlocks(markdown)
    .map((block) => {
      const text = block.text
      if (mdFenceOpen(text.split('\n')[0] ?? '')) {
        const lines = text.split('\n')
        const open = lines[0] ?? ''
        const lang = open.replace(/^ {0,3}(?:```|~~~)/, '').trim()
        const closed = lines.length > 1 && mdFenceClose(lines[lines.length - 1]!, mdFenceOpen(open)!)
        const body = lines.slice(1, closed ? -1 : undefined).join('\n')
        const attr = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
        return `<pre${attr}><code>${escapeHtml(body)}</code></pre>`
      }
      const setext = text.split('\n')
      if (setext.length === 2 && isSetextUnderline(setext[1]!)) {
        const level = setext[1]!.trim().startsWith('=') ? 1 : 2
        return `<h${level}>${inlineMarkdown(setext[0]!, defs)}</h${level}>`
      }
      if (/^#{1,6} /.test(text)) {
        const level = text.match(/^#{1,6}/)?.[0].length ?? 2
        return `<h${level}>${inlineMarkdown(text.replace(/^#{1,6} /, ''), defs)}</h${level}>`
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(text.trim())) return '<hr>'
      const linkDef = parseLinkDef(text)
      if (linkDef) {
        const title = linkDef.title ? ` data-title="${escapeHtml(linkDef.title)}"` : ''
        const shown = escapeHtml(linkDef.title || linkDef.href)
        return `<p data-linkdef="${escapeHtml(linkDef.label)}" data-href="${escapeHtml(linkDef.href)}"${title}>${shown}</p>`
      }
      const footnote = /^\[\^([^\]\s]+)\]:/.exec(text)
      if (footnote) {
        const body = text.slice(footnote[0].length).trimStart()
        return `<p data-fn="${footnote[1]}">${inlineMarkdown(body, defs)}</p>`
      }
      if (/^>/.test(text)) {
        return `<blockquote>${inlineMarkdown(text.replace(/^(> ?)/gm, ''), defs)}</blockquote>`
      }
      if (/^([-*] |\d+\. )/.test(text)) return renderListTree(parseListTree(text, defs))
      if (/^\|/.test(text)) return renderTable(text, defs)
      return `<p>${inlineMarkdown(text, defs)}</p>`
    })
    .join('')
}

function renderVisualLayout(
  markdown: string,
  defs: ReadonlyMap<string, LinkDef>,
): string {
  return parseNoteLayout(markdown)
    .map((seg) => {
      if (seg.kind === 'columns') {
        const cols = seg.columns
          .map((col) => {
            const inner = renderVisualLayout(col, defs)
            return `<div class="note-column">${inner || '<p><br></p>'}</div>`
          })
          .join('')
        return `<div class="note-columns">${cols}</div>`
      }
      if (seg.kind === 'widget') {
        const encoded = encodeWidgetConfigAttr(seg.config)
        const configAttr = encoded ? ` data-config="${escapeHtml(encoded)}"` : ''
        return `<div class="note-widget not-prose" data-widget="${escapeHtml(seg.type)}" data-size="${escapeHtml(seg.size)}"${configAttr} contenteditable="false"></div>`
      }
      return renderPlainVisual(seg.text, defs)
    })
    .join('')
}

/** Markdown → 可视层 HTML。不是发布用的消毒 HTML。 */
export function markdownToVisualHtml(markdown: string): string {
  const defs = collectLinkDefs(markdown)
  return renderVisualLayout(markdown, defs)
}

function decode(value: string): string {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function inlineHtml(html: string): string {
  return decode(
    html
      .replace(/<img\b([^>]*)>/gi, (_tag, attrs: string) => {
        // data-src 是 Markdown 里的原地址；src 只是给浏览器看的。
        const src =
          /\bdata-src="([^"]*)"/i.exec(attrs)?.[1] ??
          /\bsrc="([^"]*)"/i.exec(attrs)?.[1] ??
          ''
        const alt = /\balt="([^"]*)"/i.exec(attrs)?.[1] ?? ''
        const title = /\btitle="([^"]*)"/i.exec(attrs)?.[1]
        const ref = /\bdata-linkref="([^"]+)"/i.exec(attrs)?.[1]
        if (ref) return `![${alt}][${ref}]`
        return `![${alt}](${src}${title ? ` "${title}"` : ''})`
      })
      .replace(/<span[^>]*data-esc="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi, (_m, ch: string) =>
        `\\${decode(ch)}`,
      )
      .replace(/<sup[^>]*data-fnref="([^"]+)"[^>]*>[\s\S]*?<\/sup>/gi, '[^$1]')
      .replace(/<a(\s[^>]*data-autolink="1"[^>]*)>[\s\S]*?<\/a>/gi, (_m, attrs: string) => {
        const href = /\bhref="([^"]*)"/i.exec(attrs)?.[1] ?? ''
        return `${AUTO_OPEN}${href.replace(/^mailto:/, '')}${AUTO_CLOSE}`
      })
      .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, label: string) => {
        const href = /\bhref="([^"]*)"/i.exec(attrs)?.[1] ?? ''
        const title = /\btitle="([^"]*)"/i.exec(attrs)?.[1]
        const ref = /\bdata-linkref="([^"]+)"/i.exec(attrs)?.[1]
        if (ref && /\bdata-shortcut="1"/i.test(attrs)) return `[${decode(ref)}]`
        if (ref) return `[${label}][${decode(ref)}]`
        return `[${label}](${href}${title ? ` "${title}"` : ''})`
      })
      .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<strong><em>([\s\S]*?)<\/em><\/strong>/gi, '***$1***')
      .replace(/<em><strong>([\s\S]*?)<\/strong><\/em>/gi, '***$1***')
      .replace(/<\/?(strong|b)>/gi, '**')
      .replace(/<\/?(em|i)>/gi, '*')
      .replace(/<\/?(del|s|strike)>/gi, '~~')
      .replace(/<br\s*\/?>/gi, '  \n')
      .replace(/<[^>]+>/g, '')
      .replaceAll(AUTO_OPEN, '<')
      .replaceAll(AUTO_CLOSE, '>'),
  )
}

/** 自动链接的尖括号先用占位符顶着，等把标签剥完再换回来。 */
const AUTO_OPEN = '\uE010'
const AUTO_CLOSE = '\uE011'

function unwrap(html: string, tag: string): string {
  return html.replace(new RegExp(`^<${tag}[^>]*>|</${tag}>$`, 'gi'), '')
}

interface HtmlBlock {
  tag: string
  attrs: string
  body: string
}

const BLOCK_TAG = /<(\/?)(h[1-6]|p|pre|blockquote|ul|ol|table|hr|li|div)\b([^>]*)>/gi

/** 把顶层块切出来。同名块可以嵌套（列表里的列表），靠深度计数，不靠非贪婪。 */
function splitBlocks(html: string, only?: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = []
  let depth = 0
  let open: { tag: string; attrs: string; bodyStart: number } | null = null
  for (const match of html.matchAll(BLOCK_TAG)) {
    const closing = match[1] === '/'
    const tag = match[2]!.toLowerCase()
    if (only && tag !== only && depth === 0) continue
    if (!closing) {
      if (depth === 0) {
        open = { tag, attrs: match[3] ?? '', bodyStart: match.index + match[0].length }
      }
      depth += 1
      continue
    }
    depth = Math.max(0, depth - 1)
    if (depth === 0 && open) {
      blocks.push({
        tag: open.tag,
        attrs: open.attrs,
        body: html.slice(open.bodyStart, match.index),
      })
      open = null
    }
  }
  return blocks
}

/** 列表 → Markdown，子列表按父项记号的宽度缩进。 */
function serializeList(body: string, ordered: boolean, listAttrs: string, indent: string): string {
  const items = splitBlocks(body, 'li')
  return items
    .map((item, index) => {
      const nested = splitBlocks(item.body).filter(
        (child) => child.tag === 'ul' || child.tag === 'ol',
      )
      let own = item.body
      for (const child of nested) {
        const raw = `<${child.tag}${child.attrs}>${child.body}</${child.tag}>`
        own = own.replace(raw, '')
      }
      const text = inlineHtml(own).trim()
      const taskItem = /data-task=/.test(item.attrs)
      const taskList = /data-task="1"/.test(listAttrs) && !/data-task=/.test(item.attrs)
      let marker: string
      if (taskItem || taskList) {
        const checked = /data-task="1"/.test(item.attrs)
        marker = `- [${checked ? 'x' : ' '}] `
      } else {
        marker = ordered ? `${index + 1}. ` : '- '
      }
      const line = `${indent}${marker}${text}`
      const childIndent = indent + ' '.repeat(ordered ? 3 : 2)
      const children = nested
        .map((child) => serializeList(child.body, child.tag === 'ol', child.attrs, childIndent))
        .filter(Boolean)
      return [line, ...children].join('\n')
    })
    .join('\n')
}

/** 可视层 HTML → Markdown。认编辑器产出的标签，也认工具栏 execCommand。 */
export function visualHtmlToMarkdown(html: string): string {
  const normalized = html
    .replaceAll(/<div><br\s*\/?><\/div>/gi, '<p></p>')
    .replaceAll(/\n+/g, '')
    .replaceAll(/<hr\s*\/?>/gi, '<hr></hr>')
  const blocks = splitBlocks(normalized)
  if (blocks.length === 0) return inlineHtml(normalized).trim()
  const parts = blocks
    .map(({ tag, attrs, body }) => {
      if (tag === 'div') {
        if (hasNoteClass(attrs, 'note-columns')) {
          const cols = splitBlocks(body, 'div').filter((child) =>
            hasNoteClass(child.attrs, 'note-column'),
          )
          return serializeColumns(cols.map((col) => visualHtmlToMarkdown(col.body)))
        }
        if (hasNoteClass(attrs, 'note-widget') || layoutAttr(attrs, 'data-widget')) {
          const type = layoutAttr(attrs, 'data-widget') ?? ''
          if (!type) return ''
          return serializeWidget(
            type,
            layoutAttr(attrs, 'data-size') ?? '2x2',
            decodeWidgetConfigAttr(layoutAttr(attrs, 'data-config')),
          )
        }
        if (hasNoteClass(attrs, 'note-column')) return visualHtmlToMarkdown(body)
        return inlineHtml(body)
      }
      if (tag === 'hr') return '---'
      if (tag.startsWith('h')) {
        const level = Number(tag.slice(1))
        return `${'#'.repeat(level)} ${inlineHtml(body)}`
      }
      if (tag === 'pre') {
        const lang = attrs.match(/data-lang="([^"]*)"/)?.[1] ?? ''
        const code = decode(unwrap(body, 'code'))
        return `\`\`\`${lang}\n${code}\n\`\`\``
      }
      if (tag === 'blockquote') return `> ${inlineHtml(body).replaceAll('\n', '\n> ')}`
      if (tag === 'ul' || tag === 'ol') return serializeList(body, tag === 'ol', attrs, '')
      if (tag === 'table') {
        const aligns: CellAlign[] = []
        const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row, rowIndex) => {
          const cells = [...row[1]!.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map(
            (cell, col) => {
              if (rowIndex === 0) {
                const align = /\balign="(left|center|right)"/i.exec(cell[1] ?? '')?.[1]
                aligns[col] = (align?.toLowerCase() as CellAlign) ?? null
              }
              return inlineHtml(cell[2]!).trim().replaceAll('|', String.raw`\|`)
            },
          )
          return `| ${cells.join(' | ')} |`
        })
        if (rows.length === 0) return ''
        const width = (rows[0]!.match(/\|/g)?.length ?? 1) - 1
        const sep = `| ${Array.from({ length: width }, (_x, col) => {
          const align = aligns[col] ?? null
          if (align === 'center') return ':---:'
          if (align === 'right') return '---:'
          if (align === 'left') return ':---'
          return '---'
        }).join(' | ')} |`
        return [rows[0], sep, ...rows.slice(1)].join('\n')
      }
      const linkdef = attrs.match(/data-linkdef="([^"]+)"/)?.[1]
      if (linkdef) {
        const href = attrs.match(/data-href="([^"]*)"/)?.[1] ?? ''
        const title = attrs.match(/data-title="([^"]*)"/)?.[1]
        return `[${decode(linkdef)}]: ${decode(href)}${title ? ` "${decode(title)}"` : ''}`
      }
      const fn = attrs.match(/data-fn="([^"]+)"/)?.[1]
      if (fn) return `[^${fn}]: ${inlineHtml(body)}`
      return inlineHtml(body)
    })
    .filter((block) => block.length > 0)
  return parts
    .map((block, index) => {
      if (index === 0) return block
      const prev = parts[index - 1]!
      const glue = isDefinitionMarkdown(prev) && isDefinitionMarkdown(block) ? '\n' : '\n\n'
      return glue + block
    })
    .join('')
}

function isDefinitionMarkdown(block: string): boolean {
  return /^\[\^[^\]\s]+\]:/.test(block) || LINK_DEF_LINE.test(block)
}

/** 预览 HTML 补上参考链接定义。后端没热更新时也靠这一层，免得页脚只剩原文。 */
export function withLinkDefinitions(html: string, markdown: string): string {
  if (/class=["']link-definition["']/.test(html)) return html
  const extra = [...collectLinkDefs(expandJammedDefinitions(markdown)).values()]
    .map((def) => {
      const shown = escapeHtml(def.title || def.href)
      const title = def.title ? ` title="${escapeHtml(def.title)}"` : ''
      return `<div class="link-definition"><a href="${escapeHtml(def.href)}"${title}>[${escapeHtml(def.label)}] ${shown}</a></div>`
    })
    .join('')
  if (!extra) return html
  const at = html.indexOf('<div class="footnote-definition"')
  return at < 0 ? html + extra : html.slice(0, at) + extra + html.slice(at)
}

/** 后端渲染的代码块只有 `class="language-x"`，挪成 `data-lang` 让样式能把语言写在角上。 */
export function withCodeLangLabels(html: string): string {
  return html.replaceAll(
    /<pre((?:\s[^>]*)?)><code class="language-([\w+#.-]+)">/g,
    '<pre$1 data-lang="$2"><code class="language-$2">',
  )
}

export function insertTableMarkdown(): string {
  return '| 列 | 列 |\n| --- | --- |\n|  |  |'
}

export function insertFootnoteMarkdown(index: number): {
  mark: string
  definition: string
} {
  return {
    mark: `[^${index}]`,
    definition: `[^${index}]: `,
  }
}

export { insertColumnsMarkdown, insertWidgetMarkdown }

/* ---------------- 下面是浏览器里的 DOM 操作 ---------------- */

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'TD',
  'TH',
])

function elementOf(node: Node): HTMLElement | null {
  return node.nodeType === Node.TEXT_NODE
    ? node.parentElement
    : (node as HTMLElement)
}

/** 光标所在的块级元素；找不到就是 root。 */
export function visualBlockAt(root: HTMLElement): HTMLElement {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return root
  let el = elementOf(selection.getRangeAt(0).startContainer)
  if (!el || !root.contains(el)) return root
  while (el && el !== root && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement
  return el ?? root
}

/** 光标往上找最近的某种祖先，越过 root 就没有。 */
export function visualClosest<K extends keyof HTMLElementTagNameMap>(
  root: HTMLElement,
  tag: K,
): HTMLElementTagNameMap[K] | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const el = elementOf(selection.getRangeAt(0).startContainer)
  if (!el || !root.contains(el)) return null
  const found = el.closest(tag)
  return found && root.contains(found) && found !== root ? found : null
}

export function visualClosestClass(
  root: HTMLElement,
  className: string,
): HTMLElement | null {
  const selection = root.ownerDocument.getSelection()
  const fromSelection = (() => {
    if (!selection || selection.rangeCount === 0) return null
    return elementOf(selection.getRangeAt(0).startContainer)
  })()
  const el = fromSelection
  if (!el || !root.contains(el)) return null
  const found = el.closest(`.${className}`)
  return found && root.contains(found) && found !== root ? found : null
}

export function columnsAddColumn(root: HTMLElement, columns: HTMLElement): string {
  const count = columns.querySelectorAll(':scope > .note-column').length
  if (count >= NOTE_MAX_COLUMNS) return visualHtmlToMarkdown(root.innerHTML)
  const col = root.ownerDocument.createElement('div')
  col.className = 'note-column'
  col.innerHTML = '<p><br></p>'
  columns.append(col)
  return visualHtmlToMarkdown(root.innerHTML)
}

export function columnsRemoveColumn(root: HTMLElement, columns: HTMLElement): string {
  const current = visualClosestClass(root, 'note-column')
  const cols = [...columns.querySelectorAll<HTMLElement>(':scope > .note-column')]
  const target =
    current && columns.contains(current) ? current : cols.at(-1)
  if (!target) return visualHtmlToMarkdown(root.innerHTML)
  if (cols.length <= 1) columns.remove()
  else target.remove()
  return visualHtmlToMarkdown(root.innerHTML)
}

export function columnsRemove(root: HTMLElement, columns: HTMLElement): string {
  columns.remove()
  return visualHtmlToMarkdown(root.innerHTML)
}

export function insertColumnsVisual(root: HTMLElement): string {
  return runVisualCommand(root, 'insertHTML', markdownToVisualHtml(insertColumnsMarkdown()))
}

export function insertWidgetVisual(
  root: HTMLElement,
  type: string,
  size: string,
  config: NoteWidgetConfig | null = null,
): string {
  return runVisualCommand(
    root,
    'insertHTML',
    markdownToVisualHtml(insertWidgetMarkdown(type, size, config)),
  )
}

export function setNoteWidgetSize(
  root: HTMLElement,
  widget: HTMLElement,
  size: string,
): string {
  widget.dataset.size = normalizeNoteWidgetSize(size)
  return visualHtmlToMarkdown(root.innerHTML)
}

export function setNoteWidgetConfig(
  root: HTMLElement,
  widget: HTMLElement,
  config: NoteWidgetConfig | null,
): string {
  const encoded = encodeWidgetConfigAttr(config)
  if (encoded) widget.dataset.config = encoded
  else delete widget.dataset.config
  return visualHtmlToMarkdown(root.innerHTML)
}

export function removeNoteWidget(root: HTMLElement, widget: HTMLElement): string {
  widget.remove()
  return visualHtmlToMarkdown(root.innerHTML)
}

export function runVisualCommand(root: HTMLElement, command: string, value?: string): string {
  root.focus()
  document.execCommand(command, false, value)
  return visualHtmlToMarkdown(root.innerHTML)
}

/** 标题按级别切换：已经是这一级就回到段落。 */
export function toggleVisualHeading(root: HTMLElement, level: number): string {
  const block = visualBlockAt(root)
  const target = `h${level}`
  return runVisualCommand(
    root,
    'formatBlock',
    block.tagName.toLowerCase() === target ? 'p' : target,
  )
}

/** 行内代码：execCommand 没有这个，用 Range 包一层 `<code>`；已在里面就解开。 */
export function toggleVisualInlineCode(root: HTMLElement): string {
  root.focus()
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return visualHtmlToMarkdown(root.innerHTML)
  const range = selection.getRangeAt(0)
  const existing = elementOf(range.startContainer)?.closest('code')
  if (existing && root.contains(existing) && !existing.closest('pre')) {
    const parent = existing.parentNode
    while (existing.firstChild) parent?.insertBefore(existing.firstChild, existing)
    existing.remove()
  } else if (!range.collapsed) {
    const code = root.ownerDocument.createElement('code')
    code.append(range.extractContents())
    range.insertNode(code)
    selection.removeAllRanges()
    const after = root.ownerDocument.createRange()
    after.selectNodeContents(code)
    selection.addRange(after)
  }
  return visualHtmlToMarkdown(root.innerHTML)
}

/** 勾 / 取消勾任务项。 */
export function toggleVisualTask(root: HTMLElement, item: HTMLElement): string {
  item.dataset.task = item.dataset.task === '1' ? '0' : '1'
  return visualHtmlToMarkdown(root.innerHTML)
}

export function tableAddRow(root: HTMLElement, table: HTMLTableElement): string {
  const last = table.rows[table.rows.length - 1]
  const width = last?.cells.length ?? 2
  const row = table.insertRow()
  for (let i = 0; i < width; i += 1) row.insertCell().innerHTML = '<br>'
  return visualHtmlToMarkdown(root.innerHTML)
}

export function tableAddColumn(root: HTMLElement, table: HTMLTableElement): string {
  for (const row of table.rows) {
    const isHead = row.cells[0]?.tagName === 'TH'
    const cell = root.ownerDocument.createElement(isHead ? 'th' : 'td')
    cell.innerHTML = '<br>'
    row.appendChild(cell)
  }
  return visualHtmlToMarkdown(root.innerHTML)
}

export function tableRemove(root: HTMLElement, table: HTMLTableElement): string {
  table.remove()
  return visualHtmlToMarkdown(root.innerHTML)
}

/** 光标所在的单元格；不在表格里就是 null。 */
function currentCell(root: HTMLElement): HTMLTableCellElement | null {
  return visualClosest(root, 'td') ?? visualClosest(root, 'th')
}

/** 删光标所在的行。表头行不删；只剩表头就删整张表。 */
export function tableRemoveRow(root: HTMLElement, table: HTMLTableElement): string {
  const cell = currentCell(root)
  const row = cell?.parentElement
  if (row instanceof HTMLTableRowElement && row.rowIndex > 0) {
    row.remove()
  } else if (table.rows.length <= 1) {
    table.remove()
  }
  return visualHtmlToMarkdown(root.innerHTML)
}

/** 删光标所在的列。最后一列删掉就是删表。 */
export function tableRemoveColumn(root: HTMLElement, table: HTMLTableElement): string {
  const cell = currentCell(root)
  if (!cell) return visualHtmlToMarkdown(root.innerHTML)
  const index = cell.cellIndex
  if ((table.rows[0]?.cells.length ?? 0) <= 1) {
    table.remove()
  } else {
    for (const row of table.rows) row.cells[index]?.remove()
  }
  return visualHtmlToMarkdown(root.innerHTML)
}

/** 给光标所在的列设对齐；写在每个单元格的 `align` 上，Markdown 只看表头那一格。 */
export function tableSetAlign(
  root: HTMLElement,
  table: HTMLTableElement,
  align: 'left' | 'center' | 'right' | null,
): string {
  const cell = currentCell(root)
  if (!cell) return visualHtmlToMarkdown(root.innerHTML)
  const index = cell.cellIndex
  for (const row of table.rows) {
    const target = row.cells[index]
    if (!target) continue
    if (align) target.setAttribute('align', align)
    else target.removeAttribute('align')
  }
  return visualHtmlToMarkdown(root.innerHTML)
}

export function currentColumnAlign(
  root: HTMLElement,
  table: HTMLTableElement,
): 'left' | 'center' | 'right' | null {
  const cell = currentCell(root)
  if (!cell) return null
  const head = table.rows[0]?.cells[cell.cellIndex]
  const align = head?.getAttribute('align')?.toLowerCase()
  return align === 'left' || align === 'center' || align === 'right' ? align : null
}

/* ---- 图片 ---- */

export function setImageAlt(root: HTMLElement, img: HTMLImageElement, alt: string): string {
  img.alt = alt
  return visualHtmlToMarkdown(root.innerHTML)
}

export function setImageSrc(root: HTMLElement, img: HTMLImageElement, src: string): string {
  const shown = resolveImageSrc(src)
  img.setAttribute('src', shown)
  if (shown === src) img.removeAttribute('data-src')
  else img.dataset.src = src
  return visualHtmlToMarkdown(root.innerHTML)
}

/** 图片在 Markdown 里的地址（不是显示地址）。 */
export function imageSourceOf(img: HTMLImageElement): string {
  return img.dataset.src ?? img.getAttribute('src') ?? ''
}

export function removeImage(root: HTMLElement, img: HTMLImageElement): string {
  const parent = img.parentElement
  img.remove()
  if (parent && parent !== root && !parent.textContent?.trim() && parent.childElementCount === 0) {
    parent.remove()
  }
  return visualHtmlToMarkdown(root.innerHTML)
}

/** 在光标处插一张图。 */
export function insertImage(root: HTMLElement, src: string, alt = ''): string {
  return runVisualCommand(root, 'insertHTML', imgTag(escapeHtml(src), escapeHtml(alt)))
}

/** 表格里 Tab：下一格；最后一格再 Tab 就加一行。 */
export function tableStep(
  root: HTMLElement,
  cell: HTMLTableCellElement,
  backwards: boolean,
): string | null {
  const table = cell.closest('table')
  if (!table) return null
  const cells = [...table.querySelectorAll<HTMLTableCellElement>('td, th')]
  const index = cells.indexOf(cell)
  let target = cells[index + (backwards ? -1 : 1)]
  let changed: string | null = null
  if (!target && !backwards) {
    changed = tableAddRow(root, table)
    target = [...table.querySelectorAll<HTMLTableCellElement>('td, th')][index + 1]
  }
  if (!target) return changed
  const selection = root.ownerDocument.getSelection()
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(target)
  selection?.removeAllRanges()
  selection?.addRange(range)
  return changed
}

export function setCodeLang(root: HTMLElement, pre: HTMLElement, lang: string): string {
  if (lang.trim()) pre.dataset.lang = lang.trim()
  else delete pre.dataset.lang
  return visualHtmlToMarkdown(root.innerHTML)
}

/** 当前块有字时，在它后面开一个空段落并把光标放进去；本来就是空块就原地不动。 */
export function visualOpenBlockBelow(root: HTMLElement): void {
  const block = visualBlockAt(root)
  const solid = block.matches(
    '.note-widget, .note-columns, .note-column, img, table, hr, pre',
  )
  if (
    block === root
      ? !root.textContent?.trim()
      : !block.textContent?.trim() &&
        !solid &&
        !block.querySelector('img, table, hr, pre, .note-widget, .note-columns')
  ) {
    return
  }
  root.focus()
  const selection = root.ownerDocument.getSelection()
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(block === root ? root : block)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
  document.execCommand('insertParagraph')
}

/* ---- 富文本层里直接敲 / 贴 Markdown：就地变成对应的东西 ---- */

const INLINE_TAIL_RULES: Array<{ pattern: RegExp; render: (m: RegExpExecArray) => string }> = [
  {
    pattern: /!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)$/,
    render: (m) => imgTag(escapeHtml(m[2]!), escapeHtml(m[1]!), escapeHtml(m[3] ?? '')),
  },
  {
    pattern: /(?<!!)\[([^\]]+)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)$/,
    render: (m) =>
      `<a href="${escapeHtml(m[2]!)}"${m[3] ? ` title="${escapeHtml(m[3])}"` : ''}>${escapeHtml(m[1]!)}</a>`,
  },
  { pattern: /`([^`]+)`$/, render: (m) => `<code>${escapeHtml(m[1]!)}</code>` },
  { pattern: /\*\*([^*]+)\*\*$/, render: (m) => `<strong>${escapeHtml(m[1]!)}</strong>` },
  { pattern: /~~([^~]+)~~$/, render: (m) => `<del>${escapeHtml(m[1]!)}</del>` },
  { pattern: /(?<![*\w])\*([^*\s][^*]*)\*$/, render: (m) => `<em>${escapeHtml(m[1]!)}</em>` },
]

/** 光标前的文字尾巴刚好凑成一个行内记号：返回要替换掉的长度和替换成的 HTML。 */
export function inlineMarkdownTail(text: string): { length: number; html: string } | null {
  for (const rule of INLINE_TAIL_RULES) {
    const match = rule.pattern.exec(text)
    if (match) return { length: match[0].length, html: rule.render(match) }
  }
  return null
}

/** 粗看一眼像不像 Markdown：贴纯文本时决定要不要按 Markdown 解。 */
export function looksLikeMarkdown(text: string): boolean {
  return /!\[[^\]]*\]\([^)\s]+\)|(?<!!)\[[^\]]+\]\([^)\s]+\)|(?<!!)\[[^\]]+\]\[[^\]]*\]|(^|\n)(#{1,6} |[-*] |\d+\. |> |```|:::|\[\^?[^\]\s]+\]:)|\*\*[^*\n]+\*\*|`[^`\n]+`|~~[^~\n]+~~/.test(
    text,
  )
}

/**
 * 在富文本层敲完一个行内记号（`![a](u)`、`[t](u)`、`**x**`、`` `x` ``、`~~x~~`、`*x*`）
 * 的收尾字符时调用：把那段字换成真正的元素。没凑成就返回 null。
 */
export function applyInlineMarkdownAtCaret(root: HTMLElement): string | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null
  const text = (node as Text).data.slice(0, range.startOffset)
  const tail = inlineMarkdownTail(text)
  if (!tail) return null
  // 代码里敲的记号就是代码，不动。
  if ((node.parentElement ?? root).closest('code, pre')) return null
  const replace = root.ownerDocument.createRange()
  replace.setStart(node, range.startOffset - tail.length)
  replace.setEnd(node, range.startOffset)
  const template = root.ownerDocument.createElement('template')
  template.innerHTML = tail.html
  const fragment = template.content
  const last = fragment.lastChild
  replace.deleteContents()
  replace.insertNode(fragment)
  if (last) {
    const after = root.ownerDocument.createRange()
    after.setStartAfter(last)
    after.collapse(true)
    selection.removeAllRanges()
    selection.addRange(after)
  }
  return visualHtmlToMarkdown(root.innerHTML)
}

/** 贴进来的纯文本按 Markdown 解成块和行内元素插在光标处。 */
export function pasteMarkdownIntoVisual(root: HTMLElement, text: string): string {
  const html = markdownToVisualHtml(text)
  const single = /^<p>([\s\S]*)<\/p>$/.exec(html)
  // 只有一段就当行内插，别把当前段落劈开。
  return runVisualCommand(root, 'insertHTML', single ? single[1]! : html)
}

/** 块开头到光标的文字。 */
export function textBeforeCaret(root: HTMLElement, block: HTMLElement): string {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return ''
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(block)
  range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset)
  return range.toString()
}

const TASK_LIST_HTML = '<ul data-task="1"><li data-task="0"><br></li></ul>'

/** 把光标所在的空记号块就地换成对应结构。 */
export function applyVisualInputRule(
  root: HTMLElement,
  block: HTMLElement,
  rule:
    | { kind: 'heading'; level: number }
    | { kind: 'bullet' }
    | { kind: 'ordered' }
    | { kind: 'task' }
    | { kind: 'quote' }
    | { kind: 'code'; lang: string }
    | { kind: 'divider' },
): string {
  block.textContent = ''
  block.innerHTML = '<br>'
  const selection = root.ownerDocument.getSelection()
  const range = root.ownerDocument.createRange()
  range.setStart(block, 0)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
  root.focus()
  switch (rule.kind) {
    case 'heading':
      document.execCommand('formatBlock', false, `h${rule.level}`)
      break
    case 'bullet':
      document.execCommand('insertUnorderedList')
      break
    case 'ordered':
      document.execCommand('insertOrderedList')
      break
    case 'task':
      document.execCommand('insertHTML', false, TASK_LIST_HTML)
      break
    case 'quote':
      document.execCommand('formatBlock', false, 'blockquote')
      break
    case 'code': {
      document.execCommand('formatBlock', false, 'pre')
      const pre = visualClosest(root, 'pre')
      if (pre && rule.lang) pre.dataset.lang = rule.lang
      break
    }
    case 'divider':
      document.execCommand('insertHorizontalRule')
      break
  }
  return visualHtmlToMarkdown(root.innerHTML)
}
