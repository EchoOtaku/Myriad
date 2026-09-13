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

/** 按行加前缀，不按选区包裹。已有同样前缀则去掉。 */
export function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: string,
): WrapResult {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  // 选区停在换行后，不把下一行带上。
  const scanFrom = end > start && value[end - 1] === '\n' ? end - 1 : end
  const lineEndIndex = value.indexOf('\n', scanFrom)
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const allPrefixed = lines.every((l) => l.startsWith(prefix))
  const next = lines
    .map((l) => (allPrefixed ? l.slice(prefix.length) : prefix + l))
    .join('\n')
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + next.length,
  }
}
