/**
 * 可视编辑只服务输入。预览和发布仍走后端渲染。
 *
 * 前半是纯字符串转换（Markdown ↔ 可视层 HTML），能在 node 里测；
 * 后半是对 contenteditable 的 DOM 操作，只在浏览器里跑。
 */

export function escapeHtml(value: string): string {
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

/** 行内 Markdown → HTML。`  \n` 和 `\\\n` 是硬换行，普通换行只是空格。 */
function inlineMarkdown(text: string): string {
  const html = escapeHtml(stashEscapes(text))
    .replaceAll(/(?: {2,}|\\)\n/g, '<br>')
    .replaceAll('\n', ' ')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[\^(\d+)\](?!:)/g, '<sup data-fnref="$1">$1</sup>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" data-autolink="1">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return renderEscapes(html)
}

const LIST_LINE = /^( *)([-*]|\d+\.) (\[([ x])\] )?(.*)$/i

function blocksOf(markdown: string): string[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let inFence = false
  const flush = () => {
    const text = current.join('\n').trimEnd()
    if (text.trim()) blocks.push(text)
    current = []
  }
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inFence) flush()
      current.push(line)
      if (inFence) flush()
      inFence = !inFence
      continue
    }
    if (inFence) {
      current.push(line)
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const grouped =
      /^([-*] |\d+\. |> |\|)/.test(line) &&
      current.length > 0 &&
      /^([-*] |\d+\. |> |\|)/.test(current[0] ?? '')
    if (!grouped && current.length > 0 && !/^(> |\||[-*] |\d+\. )/.test(current[0] ?? '')) {
      flush()
    }
    current.push(line)
  }
  flush()
  return blocks
}

interface ListNode {
  text: string
  ordered: boolean
  task: boolean | null
  children: ListNode[]
}

/** 按缩进把列表行搭成树。缩进只看相对深浅，不要求恰好两格。 */
function parseListTree(block: string): ListNode[] {
  const roots: ListNode[] = []
  const stack: { indent: number; node: ListNode }[] = []
  for (const row of block.split('\n')) {
    const match = LIST_LINE.exec(row)
    if (!match) {
      // 续行接到上一项
      const last = stack.at(-1)?.node
      if (last) last.text += `<br>${inlineMarkdown(row.trim())}`
      continue
    }
    const indent = match[1]!.length
    const node: ListNode = {
      text: inlineMarkdown(match[5] ?? ''),
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

/** Markdown → 可视层 HTML。不是发布用的消毒 HTML。 */
export function markdownToVisualHtml(markdown: string): string {
  return blocksOf(markdown)
    .map((block) => {
      if (block.startsWith('```')) {
        const lang = block.match(/^```([^\n]*)/)?.[1]?.trim() ?? ''
        const body = block.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
        const attr = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
        return `<pre${attr}><code>${escapeHtml(body)}</code></pre>`
      }
      if (/^#{1,6} /.test(block)) {
        const level = block.match(/^#{1,6}/)?.[0].length ?? 2
        return `<h${level}>${inlineMarkdown(block.replace(/^#{1,6} /, ''))}</h${level}>`
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(block.trim())) return '<hr>'
      const footnote = /^\[\^(\d+)\]:/.exec(block)
      if (footnote) {
        const body = block.slice(footnote[0].length).trimStart()
        return `<p data-fn="${footnote[1]}">${inlineMarkdown(body)}</p>`
      }
      if (block.startsWith('> ')) {
        return `<blockquote>${inlineMarkdown(block.replace(/^(> )/gm, ''))}</blockquote>`
      }
      if (/^([-*] |\d+\. )/.test(block)) return renderListTree(parseListTree(block))
      if (/^\|/.test(block)) {
        const rows = block.split('\n').filter((row) => !/^\|?\s*-+/.test(row))
        const html = rows
          .map((row, index) => {
            const cells = row
              .split('|')
              .slice(1, -1)
              .map((cell) =>
                index === 0
                  ? `<th>${inlineMarkdown(cell.trim())}</th>`
                  : `<td>${inlineMarkdown(cell.trim())}</td>`,
              )
              .join('')
            return `<tr>${cells}</tr>`
          })
          .join('')
        return `<table>${html}</table>`
      }
      return `<p>${inlineMarkdown(block)}</p>`
    })
    .join('')
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
        const src = /\bsrc="([^"]*)"/i.exec(attrs)?.[1] ?? ''
        const alt = /\balt="([^"]*)"/i.exec(attrs)?.[1] ?? ''
        return `![${alt}](${src})`
      })
      .replace(/<sup[^>]*data-fnref="(\d+)"[^>]*>[\s\S]*?<\/sup>/gi, '[^$1]')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<\/?(strong|b)>/gi, '**')
      .replace(/<\/?(em|i)>/gi, '*')
      .replace(/<\/?(del|s|strike)>/gi, '~~')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
}

function unwrap(html: string, tag: string): string {
  return html.replace(new RegExp(`^<${tag}[^>]*>|</${tag}>$`, 'gi'), '')
}

interface HtmlBlock {
  tag: string
  attrs: string
  body: string
}

const BLOCK_TAG = /<(\/?)(h[1-6]|p|pre|blockquote|ul|ol|table|hr|li)\b([^>]*)>/gi

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
    .replaceAll(/<div>/gi, '<p>')
    .replaceAll(/<\/div>/gi, '</p>')
    .replaceAll(/\n+/g, '')
    .replaceAll(/<hr\s*\/?>/gi, '<hr></hr>')
  const blocks = splitBlocks(normalized)
  if (blocks.length === 0) return inlineHtml(normalized).trim()
  return blocks
    .map(({ tag, attrs, body }) => {
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
        const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((row) => {
          const cells = [...row[1]!.matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/gi)].map(
            (cell) => inlineHtml(cell[1]!).trim(),
          )
          return `| ${cells.join(' | ')} |`
        })
        if (rows.length === 0) return ''
        const width = (rows[0]!.match(/\|/g)?.length ?? 1) - 1
        const sep = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`
        return [rows[0], sep, ...rows.slice(1)].join('\n')
      }
      const fn = attrs.match(/data-fn="(\d+)"/)?.[1]
      if (fn) return `[^${fn}]: ${inlineHtml(body)}`
      return inlineHtml(body)
    })
    .filter((block) => block.length > 0)
    .join('\n\n')
}

/** 后端渲染的代码块只有 `class="language-x"`，挪成 `data-lang` 让样式能把语言写在角上。 */
export function withCodeLangLabels(html: string): string {
  return html.replaceAll(
    /<pre><code class="language-([\w+#.-]+)">/g,
    '<pre data-lang="$1"><code class="language-$1">',
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
