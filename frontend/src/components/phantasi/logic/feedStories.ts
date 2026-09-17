/** 不调 phantasiApi。 */

import type { PhantasiItem, PhantasiItemPreview } from '../../../types/phantasi'
import { normalizeTopicName } from './topics'

export const FEEDS_ARTICLE_MAX = 20
export const FRIENDS_STORY_MAX = 12
/** 订阅墙上第一张「最新」卡。不是 phantasi_sources 行，勿跟 source_id ?? 0 撞车。 */
export const LATEST_FEED_ID = -1
/** 最新卡右边叠卡：同时看见几张，池子按混排源去重。 */
export const LATEST_FEED_STACK = 3
export const LATEST_FEED_STACK_POOL = 8

export interface LatestFeedStackFace {
  key: string
  src: string | null
  mark: string
  ink: string | null
}

export type FeedStory = PhantasiItemPreview & {
  author?: string | null
  source_name?: string | null
  source_icon?: string | null
  source_id?: number
  guid?: string | null
  source_type?: string
  /** 有则按它拼列；最新聚合卡用，不改真实 source_id。 */
  rail_group?: number
}

export function isLatestFeedId(
  id: number | string | null | undefined,
): boolean {
  return Number(id) === LATEST_FEED_ID
}

/** 工作台勾上的主题卡。-2 起，跟 cards 数组下标对齐。 */
export function topicFeedId(index: number): number {
  return -2 - Math.max(0, Math.floor(index))
}

export function isTopicFeedId(
  id: number | string | null | undefined,
): boolean {
  const n = Number(id)
  return Number.isFinite(n) && n <= -2
}

export function isAggregateFeedId(
  id: number | string | null | undefined,
): boolean {
  return isLatestFeedId(id) || isTopicFeedId(id)
}

export function storyRailGroup(
  story: Pick<FeedStory, 'source_id' | 'rail_group'>,
): number {
  return story.rail_group ?? story.source_id ?? 0
}

export function firstStoryForRailGroup(
  stories: readonly FeedStory[],
  groupId: number,
): FeedStory | undefined {
  return stories.find((story) => storyRailGroup(story) === groupId)
}

export function railGroupSourceCount(
  stories: readonly Pick<FeedStory, 'source_id' | 'rail_group'>[],
  groupId: number,
): number {
  const ids = new Set<number>()
  for (const story of stories) {
    if (storyRailGroup(story) !== groupId || story.source_id == null) continue
    ids.add(story.source_id)
  }
  return ids.size
}

export function stackFaceWindow<T>(
  faces: readonly T[],
  offset: number,
  size = LATEST_FEED_STACK,
): T[] {
  if (faces.length === 0) return []
  if (faces.length <= size) return faces.slice()
  const start = ((offset % faces.length) + faces.length) % faces.length
  return Array.from(
    { length: size },
    (_, index) => faces[(start + index) % faces.length] as T,
  )
}

/** 混排里先露过的源在前，笔记和入口型不进叠卡。 */
export function latestFeedStackFaces(
  sources: ReadonlyArray<{
    id: number
    name: string
    icon: string | null
    theme_color?: string | null
    source_type?: string
  }>,
  stories: ReadonlyArray<
    Pick<FeedStory, 'source_id' | 'source_icon' | 'source_name' | 'rail_group'>
  >,
  limit = LATEST_FEED_STACK_POOL,
  groupId = LATEST_FEED_ID,
): LatestFeedStackFace[] {
  const byId = new Map(sources.map((source) => [source.id, source]))
  const mix = stories.filter((story) => story.rail_group === groupId)
  const ordered =
    mix.length > 0 ? mix : groupId === LATEST_FEED_ID ? stories : []
  const seen = new Set<number>()
  const faces: LatestFeedStackFace[] = []

  const push = (
    id: number,
    name: string,
    src: string | null,
    ink: string | null,
  ) => {
    if (seen.has(id) || faces.length >= limit) return
    seen.add(id)
    faces.push({
      key: String(id),
      src,
      mark: name.trim().slice(0, 1) || '·',
      ink,
    })
  }

  for (const story of ordered) {
    const id = story.source_id
    if (id == null) continue
    const source = byId.get(id)
    if (source && !isInboxFeedSource(source)) continue
    push(
      id,
      source?.name || story.source_name || '',
      source?.icon || story.source_icon || null,
      source?.theme_color ?? null,
    )
  }

  for (const source of sources) {
    if (!isInboxFeedSource(source)) continue
    push(source.id, source.name, source.icon, source.theme_color ?? null)
  }

  return faces
}

export function isInboxFeedSource(source: {
  source_type?: string
}): boolean {
  return source.source_type !== 'note' && source.source_type !== 'link'
}

export function toFeedStory(
  item: Pick<
    PhantasiItem,
    | 'id'
    | 'title'
    | 'summary'
    | 'image'
    | 'published_at'
    | 'is_read'
    | 'is_starred'
    | 'topic'
    | 'author'
    | 'source_id'
    | 'source_name'
    | 'source_icon'
    | 'guid'
  >,
): FeedStory {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    image: item.image,
    published_at: item.published_at,
    is_read: item.is_read,
    is_starred: item.is_starred,
    topic: item.topic,
    author: item.author,
    source_id: item.source_id,
    source_name: item.source_name,
    source_icon: item.source_icon,
    guid: item.guid,
  }
}

export function seedRank(id: number, seed: number): number {
  const value = Math.sin(id * 12.9898 + seed * 78.233) * 43758.5453
  return value - Math.floor(value)
}

export function shuffleBySeed<T extends { id: number }>(
  items: readonly T[],
  seed: number,
): T[] {
  return items.toSorted((a, b) => seedRank(a.id, seed) - seedRank(b.id, seed))
}

export function storiesFromSources(
  sources: ReadonlyArray<{
    id: number
    name: string
    icon: string | null
    source_type?: string
    recent_items?: readonly PhantasiItemPreview[] | null
  }>,
  seed: number,
  limit = FRIENDS_STORY_MAX,
): Array<FeedStory & { source_id: number }> {
  const seen = new Set<number>()
  const stories: Array<FeedStory & { source_id: number }> = []
  for (const source of sources) {
    for (const item of source.recent_items ?? []) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      stories.push({
        ...item,
        source_id: source.id,
        source_name: source.name,
        source_icon: source.icon,
        source_type: source.source_type,
      })
    }
  }
  return shuffleBySeed(stories, seed).slice(0, limit)
}

export function clampFeedSpan(from: number, to: number, lastIndex: number): {
  from: number
  to: number
} {
  const last = Math.max(0, lastIndex)
  const start = Math.min(Math.max(0, from), last)
  return { from: start, to: Math.min(last, Math.max(start, to)) }
}

/** 已拉过的源只增不减；焦点附近再预取后几源。 */
export function coverFeedIndices(
  current: readonly number[],
  index: number,
  lastIndex: number,
  ahead = 2,
): number[] {
  const last = Math.max(0, lastIndex)
  const at = Math.min(Math.max(0, index), last)
  const next = new Set(current.filter((item) => item >= 0 && item <= last))
  for (let i = Math.max(0, at - 1); i <= Math.min(last, at + ahead); i++) {
    next.add(i)
  }
  if (next.size === 0) next.add(0)
  const sorted = [...next].toSorted((a, b) => a - b)
  if (
    sorted.length === current.length &&
    sorted.every((item, i) => item === current[i])
  ) {
    return current as number[]
  }
  return sorted
}

export function expandFeedCover(
  current: readonly number[],
  dir: 1 | -1,
  lastIndex: number,
): number[] {
  const last = Math.max(0, lastIndex)
  if (current.length === 0) {
    return coverFeedIndices([], dir > 0 ? 0 : last, last)
  }
  const edge = dir > 0 ? Math.max(...current) + 1 : Math.min(...current) - 1
  if (edge < 0 || edge > last) return [...current].toSorted((a, b) => a - b)
  return coverFeedIndices(current, edge, last, 0)
}

export function stitchStoriesBySources(
  sources: ReadonlyArray<{
    id: number
    name: string
    icon: string | null
    source_type?: string
    recent_items?: readonly PhantasiItemPreview[] | null
  }>,
  fetched: ReadonlyMap<number, FeedStory[]>,
  from: number,
  to: number,
): FeedStory[] {
  const stories: FeedStory[] = []
  const last = sources.length - 1
  const span = clampFeedSpan(from, to, last)
  for (let i = span.from; i <= span.to; i++) {
    const source = sources[i]
    if (!source) continue
    const items = fetched.get(source.id)
    stories.push(
      ...storiesForSource(items ? { id: source.id, items } : null, source),
    )
  }
  return stories
}

export function groupStoriesBySource(
  stories: readonly FeedStory[],
): Array<{ sourceId: number; stories: FeedStory[] }> {
  const groups: Array<{ sourceId: number; stories: FeedStory[] }> = []
  for (const story of stories) {
    const sourceId = story.rail_group ?? story.source_id
    const last = groups.at(-1)
    if (sourceId != null && last?.sourceId === sourceId) {
      last.stories.push(story)
      continue
    }
    groups.push({ sourceId: sourceId ?? 0, stories: [story] })
  }
  return groups
}

/** 每个源自己排成两行一块，下一块从下一列接着，不把两个源叠在同一列。 */
export function storyRailSlots(
  stories: readonly FeedStory[],
  prev: ReadonlyArray<{ story: FeedStory; column: number; row: 1 | 2 }> = [],
): Array<{ story: FeedStory; column: number; row: 1 | 2 }> {
  const slots: Array<{ story: FeedStory; column: number; row: 1 | 2 }> = []
  let column = 1
  let index = 0
  let same = prev.length > 0
  for (const group of groupStoriesBySource(stories)) {
    const cols = Math.max(1, Math.ceil(group.stories.length / 2))
    group.stories.forEach((story, storyIndex) => {
      const nextColumn = column + (storyIndex % cols)
      const nextRow = (Math.floor(storyIndex / cols) + 1) as 1 | 2
      const old = prev[index]
      if (
        old
        && old.story === story
        && old.column === nextColumn
        && old.row === nextRow
      ) {
        slots.push(old)
      } else {
        same = false
        slots.push({ story, column: nextColumn, row: nextRow })
      }
      index += 1
    })
    column += cols
  }
  if (same && index === prev.length) {
    return prev as Array<{
      story: FeedStory
      column: number
      row: 1 | 2
    }>
  }
  return slots
}

export function sourceColumnStarts(
  slots: ReadonlyArray<{
    story: Pick<FeedStory, 'source_id' | 'rail_group'>
    column: number
  }>,
  prev: ReadonlyArray<{ id: number; column: number }> = [],
): Array<{ id: number; column: number }> {
  const starts: Array<{ id: number; column: number }> = []
  for (const slot of slots) {
    const id = slot.story.rail_group ?? slot.story.source_id
    if (id == null || starts.at(-1)?.id === id) continue
    starts.push({ id, column: slot.column })
  }
  if (
    prev.length === starts.length
    && prev.every((block, i) => {
      return block.id === starts[i]?.id && block.column === starts[i]?.column
    })
  ) {
    return prev as Array<{ id: number; column: number }>
  }
  return starts
}

/** 按列收卡，扩窗时只接右边，不扫整轨。列里的卡没变就沿用上一份。 */
export function storySlotsByColumn<T extends { column: number }>(
  slots: readonly T[],
  prev?: ReadonlyMap<number, readonly T[]>,
): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const slot of slots) {
    const col = slot.column
    const list = map.get(col)
    if (list) list.push(slot)
    else map.set(col, [slot])
  }
  if (!prev || prev.size !== map.size) return map
  let reused = 0
  for (const [col, list] of map) {
    const old = prev.get(col)
    if (
      old
      && old.length === list.length
      && old.every((slot, i) => slot === list[i])
    ) {
      map.set(col, old as T[])
      reused += 1
    }
  }
  if (reused === map.size) return prev as Map<number, T[]>
  return map
}

/** 窗重叠的列接着上一份；拼轨变了或错开再造。 */
export function extendPaintedRange<T>(
  prev: readonly T[],
  prevFrom: number,
  prevTo: number,
  from: number,
  to: number,
  make: (col: number) => T,
  reset = false,
): T[] {
  if (reset || prev.length === 0 || from > to) {
    const next: T[] = []
    for (let col = from; col <= to; col++) next.push(make(col))
    return next
  }
  if (from === prevFrom && to === prevTo) return prev as T[]
  const keepFrom = Math.max(from, prevFrom)
  const keepTo = Math.min(to, prevTo)
  if (keepFrom > keepTo) {
    const next: T[] = []
    for (let col = from; col <= to; col++) next.push(make(col))
    return next
  }
  if (from === prevFrom && to > prevTo) {
    const next = prev.slice()
    for (let col = prevTo + 1; col <= to; col++) next.push(make(col))
    return next
  }
  const next: T[] = []
  for (let col = from; col < keepFrom; col++) next.push(make(col))
  const at = keepFrom - prevFrom
  for (let i = 0; i < keepTo - keepFrom + 1; i++) next.push(prev[at + i] as T)
  for (let col = keepTo + 1; col <= to; col++) next.push(make(col))
  return next
}

/** 整批还在窗里就原样留下；只切到边上的那批。 */
export function clipPaintedBatches<
  T,
  B extends { from: number; to: number; nodes: readonly T[] },
>(
  batches: readonly B[],
  from: number,
  to: number,
  all: readonly T[],
): { from: number; to: number; nodes: readonly T[]; keep: B | null }[] {
  if (from > to) return []
  if (batches.length === 0) {
    return [{ from, to, nodes: all, keep: null }]
  }
  const out: { from: number; to: number; nodes: readonly T[]; keep: B | null }[] = []
  let cursor = from
  for (const batch of batches) {
    if (batch.to < from) continue
    if (batch.from > to) break
    if (cursor < batch.from) {
      const fillTo = Math.min(batch.from - 1, to)
      out.push({
        from: cursor,
        to: fillTo,
        nodes: all.slice(cursor - from, fillTo - from + 1),
        keep: null,
      })
      cursor = fillTo + 1
    }
    if (batch.from >= from && batch.to <= to) {
      out.push({
        from: batch.from,
        to: batch.to,
        nodes: batch.nodes,
        keep: batch,
      })
      cursor = batch.to + 1
      continue
    }
    const clipFrom = Math.max(batch.from, from)
    const clipTo = Math.min(batch.to, to)
    if (clipFrom <= clipTo) {
      out.push({
        from: clipFrom,
        to: clipTo,
        nodes: all.slice(clipFrom - from, clipTo - from + 1),
        keep: null,
      })
      cursor = clipTo + 1
    }
  }
  if (cursor <= to) {
    out.push({
      from: cursor,
      to,
      nodes: all.slice(cursor - from),
      keep: null,
    })
  }
  return out
}

/** 每列第一张的下标。列不是单调递增，不能按列号直接算。 */
export function storyColumnLeads(
  slots: ReadonlyArray<{ column: number }>,
): Map<number, number> {
  const map = new Map<number, number>()
  for (let i = 0; i < slots.length; i++) {
    const col = slots[i]?.column
    if (col != null && !map.has(col)) map.set(col, i)
  }
  return map
}

export function storyColumnCount(
  slots: ReadonlyArray<{ column: number }>,
): number {
  let count = 1
  for (const slot of slots) count = Math.max(count, slot.column)
  return count
}

export function storySlotAtColumn<T extends { column: number }>(
  slots: readonly T[],
  col: number,
  leads?: ReadonlyMap<number, number>,
): T | undefined {
  const at = leads?.get(col)
  if (at != null) return slots[at]
  return slots.find((slot) => slot.column === col)
}

/** 前面的源变长时，当前领头卡的列差，用来把滚动补回去。 */
export function storyColumnShift(
  prev: ReadonlyArray<{
    story: Pick<FeedStory, 'id' | 'source_id' | 'rail_group'>
    column: number
  }>,
  next: ReadonlyArray<{
    story: Pick<FeedStory, 'id' | 'source_id' | 'rail_group'>
    column: number
  }>,
  leadColumn: number,
): number {
  let leadStory:
    | Pick<FeedStory, 'id' | 'source_id' | 'rail_group'>
    | undefined
  for (const slot of prev) {
    if (slot.column === leadColumn) {
      leadStory = slot.story
      break
    }
  }
  if (!leadStory) return 0
  const leadGroup = storyRailGroup(leadStory)
  for (const slot of next) {
    if (
      slot.story.id === leadStory.id
      && storyRailGroup(slot.story) === leadGroup
    ) {
      return slot.column - leadColumn
    }
  }
  return 0
}

export function sourceScrollStarts(
  columns: ReadonlyArray<{ id: number; column: number }>,
  colW: number,
): Array<{ id: number; start: number }> {
  const width = Math.max(1, colW)
  return columns.map((block) => ({
    id: block.id,
    start: (block.column - 1) * width,
  }))
}

export function sameFeedStory(a: FeedStory, b: FeedStory): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.summary === b.summary &&
    a.image === b.image &&
    a.published_at === b.published_at &&
    a.is_read === b.is_read &&
    a.is_starred === b.is_starred &&
    a.topic === b.topic &&
    a.author === b.author &&
    a.source_id === b.source_id &&
    a.source_name === b.source_name &&
    a.source_icon === b.source_icon &&
    a.rail_group === b.rail_group
  )
}

function storyReuseKey(story: FeedStory): string {
  return `${story.rail_group ?? 's'}:${story.id}`
}

/** 源列没变时沿用上一帧对象，滚动时少造新文章。 */
export function reuseFeedStories(
  prev: readonly FeedStory[],
  next: readonly FeedStory[],
): FeedStory[] {
  if (prev === next) return next as FeedStory[]
  if (prev.length === 0) return next as FeedStory[]
  const byId = new Map<string, FeedStory>()
  for (const story of prev) byId.set(storyReuseKey(story), story)
  let changed = prev.length !== next.length
  const out = next.map((story, index) => {
    const old = byId.get(storyReuseKey(story))
    if (old && sameFeedStory(old, story)) {
      if (prev[index] !== old) changed = true
      return old
    }
    changed = true
    return story
  })
  return changed ? out : (prev as FeedStory[])
}

export function latestStoryPreview(
  loose: readonly PhantasiItemPreview[] | null | undefined,
  recent: readonly PhantasiItemPreview[] | null | undefined,
): PhantasiItemPreview | undefined {
  return loose?.[0] ?? recent?.[0]
}

/** 订阅 inbox：各源最新按时间混排。笔记和入口型不进这条。 */
export function latestFeedStories(
  sources: ReadonlyArray<{
    id: number
    name: string
    icon: string | null
    source_type?: string
    recent_items?: readonly PhantasiItemPreview[] | null
  }>,
  fetched: ReadonlyMap<number, FeedStory[]>,
  limit = FEEDS_ARTICLE_MAX,
): FeedStory[] {
  const seen = new Set<number>()
  const stories: FeedStory[] = []
  for (const source of sources) {
    if (!isInboxFeedSource(source)) continue
    const items = fetched.get(source.id)
    const group = storiesForSource(
      items && items.length > 0 ? { id: source.id, items } : null,
      source,
    )
    for (const item of group) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      stories.push({ ...item, rail_group: LATEST_FEED_ID })
    }
  }
  return stories
    .toSorted((a, b) => {
      const byTime = (b.published_at ?? 0) - (a.published_at ?? 0)
      return byTime !== 0 ? byTime : b.id - a.id
    })
    .slice(0, limit)
}

export function topicFeedStories(
  sources: ReadonlyArray<{
    id: number
    name: string
    icon: string | null
    source_type?: string
    recent_items?: readonly PhantasiItemPreview[] | null
  }>,
  fetched: ReadonlyMap<number, FeedStory[]>,
  topic: string,
  groupId: number,
  limit = FEEDS_ARTICLE_MAX,
  loaded?: readonly FeedStory[],
): FeedStory[] {
  const key = normalizeTopicName(topic)
  if (!key) return []
  const seen = new Set<number>()
  const stories: FeedStory[] = []
  if (loaded) {
    for (const item of loaded) {
      if (normalizeTopicName(item.topic) !== key || seen.has(item.id)) continue
      seen.add(item.id)
      stories.push({ ...item, rail_group: groupId })
    }
    return stories.slice(0, limit)
  }
  for (const source of sources) {
    if (!isInboxFeedSource(source)) continue
    const items = fetched.get(source.id)
    const group = storiesForSource(
      items && items.length > 0 ? { id: source.id, items } : null,
      source,
    )
    for (const item of group) {
      if (normalizeTopicName(item.topic) !== key) continue
      if (seen.has(item.id)) continue
      seen.add(item.id)
      stories.push({ ...item, rail_group: groupId })
    }
  }
  return stories
    .toSorted((a, b) => {
      const byTime = (b.published_at ?? 0) - (a.published_at ?? 0)
      return byTime !== 0 ? byTime : b.id - a.id
    })
    .slice(0, limit)
}

export function storiesForSource(
  fetched: { id: number; items: FeedStory[] } | null,
  source: {
    id: number
    name: string
    icon: string | null
    source_type?: string
    recent_items?: readonly PhantasiItemPreview[] | null
  } | null,
): FeedStory[] {
  if (!source) return []
  const base =
    fetched?.id === source.id && fetched.items.length > 0
      ? fetched.items
      : (source.recent_items ?? [])
  return base.map((item) => ({
    ...item,
    source_id: source.id,
    source_name: source.name,
    source_icon: source.icon,
    source_type: source.source_type,
  }))
}

export interface FeedStorySlot {
  stamp: number
  items: FeedStory[]
}
