/** 和 `myriad-phantasi-notes` 同一套上限，提交前先拦。 */

import { normalizeNoteCategory } from './noteCategory'

export const MAX_NOTE_TITLE_CHARS = 200
export const MAX_NOTE_BODY_CHARS = 200_000

type NoteFieldError = 'empty-title' | 'title-too-long' | 'body-too-long'
type NoteScheduleError = 'missing-time' | 'already-due'

export function countNoteChars(value: string): number {
  // Spreading the string materializes one array entry per character. Count only
  // surrogate pairs instead, so large ASCII/CJK drafts allocate no such array.
  let count = value.length
  const pairs = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g
  while (pairs.test(value)) count--
  return count
}

export function noteFieldError(
  title: string,
  body: string,
): NoteFieldError | null {
  const trimmed = title.trim()
  if (!trimmed) return 'empty-title'
  const titleChars = countNoteChars(trimmed)
  if (titleChars > MAX_NOTE_TITLE_CHARS) return 'title-too-long'
  if (countNoteChars(body) > MAX_NOTE_BODY_CHARS) return 'body-too-long'
  return null
}

/** 正文第一张图，给封面空位看。行内 `![](url)` 和参考式 `![][id]` 都认。 */
export function firstMarkdownImage(markdown: string): string | null {
  const inline = /!\[[^\]]*\]\(([^\s)]+)/.exec(markdown)
  const ref = /!\[([^\]]*)\]\[([^\]\s]*)\]/.exec(markdown)
  const inlineAt = inline?.index ?? Number.POSITIVE_INFINITY
  const refAt = ref?.index ?? Number.POSITIVE_INFINITY
  if (inline && inlineAt <= refAt) return inline[1]!.trim() || null
  if (!ref) return null
  const key = (ref[2] || ref[1]).trim().toLowerCase()
  for (const match of markdown.matchAll(
    /\[(?!\^)([^\]]+)\]:\s+(?:<([^>\s]+)>|(\S+))/g,
  )) {
    if (match[1]!.trim().toLowerCase() === key) {
      return (match[2] || match[3] || '').trim() || null
    }
  }
  return null
}

export function toDatetimeLocal(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromDatetimeLocal(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const ms = new Date(trimmed).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** 和后端 `schedule_at` 同一口径：必须给一个还没到的时间。 */
export function noteScheduleError(
  scheduledAt: number | null | undefined,
  now = Date.now(),
): NoteScheduleError | null {
  if (scheduledAt == null || !Number.isFinite(scheduledAt)) return 'missing-time'
  if (scheduledAt <= now) return 'already-due'
  return null
}

export function sameNoteMinute(left: number | null, right: number | null): boolean {
  if (left == null || right == null) return left == null && right == null
  return Math.floor(left / 60_000) === Math.floor(right / 60_000)
}

export function normalizeNoteTopic(topic: string | null | undefined): string | null {
  return normalizeNoteCategory(topic)
}

export function normalizeNoteCover(cover: string | null | undefined): string | null {
  const value = cover?.trim()
  return value || null
}

/** 没指定封面就不带 `image`，后端改用正文第一张图。 */
export function toNoteWritePayload(
  title: string,
  contentMd: string,
  topic: string | null | undefined,
  cover: string | null | undefined,
  publishedAt: number | null | undefined,
): {
  title: string
  content_md: string
  topic: string | null
  image?: string
  published_at?: number
} {
  const image = normalizeNoteCover(cover)
  const published = publishedAt != null && publishedAt > 0 ? publishedAt : null
  return {
    title: title.trim(),
    content_md: contentMd,
    topic: normalizeNoteTopic(topic),
    ...(image ? { image } : {}),
    ...(published != null ? { published_at: published } : {}),
  }
}
