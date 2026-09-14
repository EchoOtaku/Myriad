import type { TransferNote } from './types'
import { parseUnixOrDate } from './text'

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parseFront(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const cut = line.indexOf(':')
    if (cut <= 0) continue
    const key = line.slice(0, cut).trim().toLowerCase()
    const value = line
      .slice(cut + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (key) out[key] = value
  }
  return out
}

export function parseMarkdownFile(name: string, text: string): TransferNote {
  const match = FRONT.exec(text)
  const meta = match ? parseFront(match[1]!) : {}
  const body = match ? text.slice(match[0].length) : text
  const heading = /^# ([^\n]+)$/m.exec(body)
  const title = meta.title || heading?.[1]?.trim() || name.replace(/\.md$/i, '')
  const content = heading ? body.replace(heading[0], '').trim() : body.trim()
  const status = (meta.status || meta.draft || '').toLowerCase()
  return {
    title,
    content_md: content,
    topic: meta.topic || meta.category || meta.tags || null,
    published_at: parseUnixOrDate(meta.date || meta.published || meta.created),
    status:
      status === 'draft' || status === 'true' || status === 'yes'
        ? 'draft'
        : 'published',
  }
}

export function serializeMarkdownFile(note: TransferNote): string {
  const head = [
    '---',
    `title: ${JSON.stringify(note.title || 'untitled')}`,
    note.topic ? `topic: ${JSON.stringify(note.topic)}` : null,
    note.published_at
      ? `date: ${new Date(note.published_at * 1000).toISOString()}`
      : null,
    `status: ${note.status}`,
    '---',
    '',
    note.content_md.trim(),
    '',
  ]
  return head.filter((line): line is string => line != null).join('\n')
}
