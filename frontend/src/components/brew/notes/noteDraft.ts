/** 草稿只在本机：不同步、不进任何载荷。 */

import { sameNoteMinute } from './noteFields'

/** `new` 是还没发布的那篇。 */
export function noteDraftKey(id: number | 'new'): string {
  return `brew:note-draft:${id}`
}

export interface NoteDraft {
  title: string
  contentMd: string
  /** 缺字段表示旧草稿没记过，不能盖掉服务端值。 */
  topic?: string | null
  cover?: string | null
  publishedAt?: number | null
  savedAt: number
}

export const NOTE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function readNoteDraft(
  id: number | 'new',
  now: number = Date.now(),
): NoteDraft | null {
  try {
    const raw = globalThis.localStorage?.getItem(noteDraftKey(id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NoteDraft>
    if (typeof parsed.contentMd !== 'string') return null
    const savedAt = Number(parsed.savedAt)
    if (!Number.isFinite(savedAt)) return null
    if (now - savedAt > NOTE_DRAFT_TTL_MS) return null
    const topic = readOptionalText(parsed, 'topic')
    const cover = readOptionalText(parsed, 'cover')
    const publishedAt = readOptionalTime(parsed, 'publishedAt')
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      contentMd: parsed.contentMd,
      ...(topic !== undefined ? { topic } : {}),
      ...(cover !== undefined ? { cover } : {}),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
      savedAt,
    }
  } catch {
    // 读 localStorage 可能抛。
    return null
  }
}

function readOptionalText(
  parsed: Partial<NoteDraft>,
  key: 'topic' | 'cover',
): string | null | undefined {
  if (!Object.hasOwn(parsed, key)) return undefined
  const value = parsed[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readOptionalTime(
  parsed: Partial<NoteDraft>,
  key: 'publishedAt',
): number | null | undefined {
  if (!Object.hasOwn(parsed, key)) return undefined
  const value = Number(parsed[key])
  return Number.isFinite(value) && value > 0 ? value : null
}

export function writeNoteDraft(
  id: number | 'new',
  draft: {
    title: string
    contentMd: string
    topic?: string | null
    cover?: string | null
    publishedAt?: number | null
  },
  now: number = Date.now(),
): void {
  try {
    globalThis.localStorage?.setItem(
      noteDraftKey(id),
      JSON.stringify({ ...draft, savedAt: now }),
    )
  } catch {
    // 写不进去就不写；草稿丢失不挡住编辑。
  }
}

export function clearNoteDraft(id: number | 'new'): void {
  try {
    globalThis.localStorage?.removeItem(noteDraftKey(id))
  } catch {
  }
}

/** 只比写出过的字段。首尾空白不算差异；发布时间按分钟。 */
export function draftDiffersFrom(
  draft: NoteDraft | null,
  saved: {
    title: string
    contentMd: string
    topic?: string | null
    cover?: string | null
    publishedAt?: number | null
  },
): boolean {
  if (!draft) return false
  const topic = saved.topic?.trim() || null
  const cover = saved.cover?.trim() || null
  const topicChanged =
    draft.topic !== undefined && (draft.topic || null) !== topic
  const coverChanged =
    draft.cover !== undefined && (draft.cover || null) !== cover
  const publishedChanged =
    draft.publishedAt !== undefined &&
    !sameNoteMinute(draft.publishedAt, saved.publishedAt ?? null)
  return (
    draft.title.trim() !== saved.title.trim() ||
    draft.contentMd.trim() !== saved.contentMd.trim() ||
    topicChanged ||
    coverChanged ||
    publishedChanged
  )
}

export interface WrapResult {
  value: string
  selectionStart: number
  selectionEnd: number
}

/** 没有选区时插入 placeholder 并选中。 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder = '',
): WrapResult {
  const selected = value.slice(start, end)
  const body = selected || placeholder
  const next = value.slice(0, start) + before + body + after + value.slice(end)
  return {
    value: next,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + body.length,
  }
}

/**
 * 行内记号是切换不是叠加：选中的字已经被 before/after 包着（在选区外或选区内）
 * 就把记号拆掉，否则包上。没有选区时插入 placeholder 并选中。
 */
export function toggleWrap(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder = '',
): WrapResult {
  const selected = value.slice(start, end)
  const outerStart = start - before.length
  const outerEnd = end + after.length
  if (
    selected &&
    outerStart >= 0 &&
    value.slice(outerStart, start) === before &&
    value.slice(end, outerEnd) === after
  ) {
    return {
      value: value.slice(0, outerStart) + selected + value.slice(outerEnd),
      selectionStart: outerStart,
      selectionEnd: outerStart + selected.length,
    }
  }
  if (
    selected.length > before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  ) {
    const inner = selected.slice(before.length, selected.length - after.length)
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    }
  }
  return wrapSelection(value, start, end, before, after, placeholder)
}

export interface InlineLink {
  start: number
  end: number
  text: string
  url: string
}

/** 光标（或选区起点）落在 `[文字](地址)` 里就把它找出来。 */
export function linkAtCursor(value: string, position: number): InlineLink | null {
  const lineStart = value.lastIndexOf('\n', position - 1) + 1
  const lineEndIndex = value.indexOf('\n', position)
  const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex
  const line = value.slice(lineStart, lineEnd)
  for (const match of line.matchAll(/(?<!!)\[([^\]]*)\]\(([^)\s]*)\)/g)) {
    const start = lineStart + match.index
    const end = start + match[0].length
    if (position >= start && position <= end) {
      return { start, end, text: match[1] ?? '', url: match[2] ?? '' }
    }
  }
  return null
}

/** 改已有链接的地址；地址为空就只留文字。 */
export function replaceLink(
  value: string,
  link: InlineLink,
  url: string | null,
): WrapResult {
  const next = url ? `[${link.text}](${url})` : link.text
  return {
    value: value.slice(0, link.start) + next + value.slice(link.end),
    selectionStart: link.start,
    selectionEnd: link.start + next.length,
  }
}

/** 硬换行：行尾两个空格再换行。 */
export function hardBreak(value: string, start: number, end: number): WrapResult {
  const next = `${value.slice(0, start)}  \n${value.slice(end)}`
  const caret = start + 3
  return { value: next, selectionStart: caret, selectionEnd: caret }
}

/** 正文里已经没有 `[^n]` 引用的脚注定义，删掉。 */
export function pruneOrphanFootnotes(markdown: string): string {
  const refs = new Set<string>()
  for (const match of markdown.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
    refs.add(match[1]!)
  }
  const kept = markdown
    .split('\n')
    .filter((line) => {
      const def = /^\[\^([^\]\s]+)\]:/.exec(line)
      return !def || refs.has(def[1]!)
    })
    .join('\n')
  return kept.replaceAll(/\n{3,}/g, '\n\n').trimEnd()
}

/** 选区覆盖到的整行范围。选区停在换行后，不把下一行带上。 */
function lineSpan(
  value: string,
  start: number,
  end: number,
): { lineStart: number; lineEnd: number } {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const scanFrom = end > start && value[end - 1] === '\n' ? end - 1 : end
  const lineEndIndex = value.indexOf('\n', scanFrom)
  return {
    lineStart,
    lineEnd: lineEndIndex === -1 ? value.length : lineEndIndex,
  }
}

function mapLines(
  value: string,
  start: number,
  end: number,
  fn: (lines: string[]) => string[],
): WrapResult {
  const { lineStart, lineEnd } = lineSpan(value, start, end)
  const next = fn(value.slice(lineStart, lineEnd).split('\n')).join('\n')
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + next.length,
  }
}

/** 按行加前缀，不按选区包裹。已有同样前缀则去掉。 */
export function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: string,
): WrapResult {
  return mapLines(value, start, end, (lines) => {
    const allPrefixed = lines.every((l) => l.startsWith(prefix))
    return lines.map((l) => (allPrefixed ? l.slice(prefix.length) : prefix + l))
  })
}

const HEADING_MARK = /^#{1,6} /

/** 设标题级别：已经是这一级就去掉，其他级别改成这一级。 */
export function setHeadingLevel(
  value: string,
  start: number,
  end: number,
  level: number,
): WrapResult {
  const mark = `${'#'.repeat(level)} `
  return mapLines(value, start, end, (lines) => {
    const allSame = lines.every((l) => l.startsWith(mark))
    return lines.map((l) => {
      const bare = l.replace(HEADING_MARK, '')
      return allSame ? bare : mark + bare
    })
  })
}

const INDENT = '  '

/**
 * 列表缩进：每行进 / 退两格。退格时也吃掉一个制表符。
 * 光标收拢时不选整行，光标跟着字挪。
 */
export function indentLines(
  value: string,
  start: number,
  end: number,
  outdent: boolean,
): WrapResult {
  const { lineStart } = lineSpan(value, start, end)
  const firstLineEnd = value.indexOf('\n', lineStart)
  const firstLine = value.slice(lineStart, firstLineEnd < 0 ? value.length : firstLineEnd)
  const shift = (l: string) => {
    if (!outdent) return INDENT + l
    if (l.startsWith(INDENT)) return l.slice(INDENT.length)
    if (l.startsWith('\t') || l.startsWith(' ')) return l.slice(1)
    return l
  }
  const result = mapLines(value, start, end, (lines) => lines.map(shift))
  if (start !== end) return result
  const delta = shift(firstLine).length - firstLine.length
  const caret = Math.max(lineStart, start + delta)
  return { ...result, selectionStart: caret, selectionEnd: caret }
}
