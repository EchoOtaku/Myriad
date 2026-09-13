/** 不产出 WidgetGrid 坐标。 */

import type { BrewItem } from '../../../types/brew'

import type { FeedStory } from './feedStories'

export const NOTES_FEATURED_MAX = 3

export interface HomeBoardNote {
  id: number
  title: string
  summary: string | null
  image: string | null
  published_at: number | null
  source_id: number
  is_starred?: boolean
  topic?: string | null
  author?: string | null
  source_name?: string | null
  source_icon?: string | null
}

export function toHomeBoardNote(
  item: Pick<
    BrewItem,
    | 'id'
    | 'title'
    | 'summary'
    | 'image'
    | 'published_at'
    | 'source_id'
    | 'is_starred'
    | 'topic'
    | 'author'
    | 'source_name'
    | 'source_icon'
  >,
): HomeBoardNote {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    image: item.image,
    published_at: item.published_at,
    source_id: item.source_id,
    is_starred: item.is_starred,
    topic: item.topic,
    author: item.author,
    source_name: item.source_name,
    source_icon: item.source_icon,
  }
}

export function toNoteStory(
  note: HomeBoardNote,
  source?: { name: string; icon: string | null },
): FeedStory {
  return {
    id: note.id,
    title: note.title,
    summary: note.summary,
    image: note.image,
    published_at: note.published_at,
    is_read: true,
    is_starred: note.is_starred,
    topic: note.topic,
    author: note.author,
    source_id: note.source_id,
    source_name: note.source_name?.trim() || source?.name || '',
    source_icon: note.source_icon ?? source?.icon ?? null,
  }
}

export function pickHomeBoardNotes(
  items: Array<
    Pick<
      BrewItem,
      | 'id'
      | 'title'
      | 'summary'
      | 'image'
      | 'published_at'
      | 'source_id'
      | 'is_starred'
      | 'topic'
      | 'author'
      | 'source_name'
      | 'source_icon'
    >
  >,
  sources: Array<{ id: number; source_type: string }>,
): HomeBoardNote[] {
  const noteSourceIds = new Set(
    sources
      .filter((source) => source.source_type === 'note')
      .map((source) => source.id),
  )
  if (noteSourceIds.size === 0) return []
  return Iterator.from(items)
    .filter((item) => noteSourceIds.has(item.source_id))
    .take(NOTES_FEATURED_MAX)
    .map(toHomeBoardNote)
    .toArray()
}

export function noteSourceKey(
  sources: Array<{ id: number; source_type: string }>,
): string {
  return sources
    .filter((source) => source.source_type === 'note')
    .map((source) => source.id)
    .join(',')
}
