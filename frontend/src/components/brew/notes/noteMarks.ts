/** 选区上已经有哪些记号：浮动条按钮据此亮起。写栏看 Markdown，可视层看 DOM。 */

import { linkAtCursor } from './noteDraft'

export type NoteMark =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inline-code'
  | 'link'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'

const WRAPS: Array<[NoteMark, string]> = [
  ['bold', '**'],
  ['strike', '~~'],
  ['inline-code', '`'],
]

function wrappedBy(value: string, start: number, end: number, mark: string): boolean {
  const selected = value.slice(start, end)
  if (
    start >= mark.length &&
    value.slice(start - mark.length, start) === mark &&
    value.slice(end, end + mark.length) === mark
  ) {
    return true
  }
  return (
    selected.length > mark.length * 2 &&
    selected.startsWith(mark) &&
    selected.endsWith(mark)
  )
}

/** 斜体是单星号，但要排除掉粗体的双星号。 */
function italicAround(value: string, start: number, end: number): boolean {
  const before = value.slice(Math.max(0, start - 2), start)
  const after = value.slice(end, end + 2)
  if (before.endsWith('*') && !before.endsWith('**') && after.startsWith('*') && !after.startsWith('**')) {
    return true
  }
  if (before.endsWith('***') || before === '***') return true
  const selected = value.slice(start, end)
  return (
    selected.length > 2 &&
    selected.startsWith('*') &&
    !selected.startsWith('**') &&
    selected.endsWith('*') &&
    !selected.endsWith('**')
  )
}

export function markdownMarksAt(value: string, start: number, end: number): Set<NoteMark> {
  const marks = new Set<NoteMark>()
  for (const [mark, token] of WRAPS) {
    if (wrappedBy(value, start, end, token)) marks.add(mark)
  }
  if (italicAround(value, start, end)) marks.add('italic')
  if (linkAtCursor(value, start)) marks.add('link')
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const line = value.slice(lineStart, value.indexOf('\n', start) < 0 ? value.length : value.indexOf('\n', start))
  const heading = /^(#{1,3}) /.exec(line)
  if (heading) marks.add(`h${heading[1]!.length}` as NoteMark)
  if (line.startsWith('> ')) marks.add('quote')
  return marks
}

/** 可视层：问浏览器 + 往上找祖先。 */
export function visualMarksAt(root: HTMLElement): Set<NoteMark> {
  const marks = new Set<NoteMark>()
  const doc = root.ownerDocument
  const selection = doc.getSelection()
  if (!selection || selection.rangeCount === 0) return marks
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return marks
  const query = (command: string) => {
    try {
      return doc.queryCommandState(command)
    } catch {
      return false
    }
  }
  if (query('bold')) marks.add('bold')
  if (query('italic')) marks.add('italic')
  if (query('strikeThrough')) marks.add('strike')
  const node = range.startContainer
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
  if (!el) return marks
  if (el.closest('code') && !el.closest('pre')) marks.add('inline-code')
  if (el.closest('a')) marks.add('link')
  const block = el.closest('h1, h2, h3, blockquote')
  if (block) {
    const tag = block.tagName.toLowerCase()
    if (tag === 'blockquote') marks.add('quote')
    else marks.add(tag as NoteMark)
  }
  return marks
}

export function sameMarks(a: Set<NoteMark>, b: Set<NoteMark>): boolean {
  if (a.size !== b.size) return false
  for (const mark of a) if (!b.has(mark)) return false
  return true
}
