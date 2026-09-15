/** 不产出 WidgetGrid 坐标。 */

import type { PhantasiItem } from '../../../types/phantasi'

import type { FeedStory } from './feedStories'

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
  guid?: string | null
}

export function toHomeBoardNote(
  item: Pick<
    PhantasiItem,
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
    | 'guid'
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
    guid: item.guid,
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
    guid: note.guid,
    source_type: 'note',
  }
}

export function noteSourceKey(
  sources: Array<{ id: number; source_type: string }>,
): string {
  return sources
    .filter((source) => source.source_type === 'note')
    .map((source) => source.id)
    .toSorted((left, right) => left - right)
    .join(',')
}

/** 笔记墙内容戳：源集合或抓取结果变了才换，收藏/已读不算。 */
export function noteSourceStamp(
  sources: Array<{
    id: number
    source_type: string
    item_count?: number
    last_success_at?: number | null
  }>,
): string {
  return sources
    .filter((source) => source.source_type === 'note')
    .toSorted((left, right) => left.id - right.id)
    .map(
      (source) =>
        `${source.id}:${source.item_count ?? 0}:${source.last_success_at ?? 0}`,
    )
    .join(',')
}
