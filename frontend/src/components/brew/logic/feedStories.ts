/** 不调 brewApi。 */

import type { BrewItem, BrewItemPreview } from '../../../types/brew'

export const FEEDS_ARTICLE_MAX = 20
export const FRIENDS_STORY_MAX = 12

export type FeedStory = BrewItemPreview & {
  author?: string | null
  source_name?: string | null
  source_icon?: string | null
  source_id?: number
}

export function toFeedStory(
  item: Pick<
    BrewItem,
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
  }
}

function storyRank(id: number, seed: number): number {
  const value = Math.sin(id * 12.9898 + seed * 78.233) * 43758.5453
  return value - Math.floor(value)
}

export function storiesFromSources(
  sources: ReadonlyArray<{
    id: number
    name: string
    icon: string | null
    recent_items?: readonly BrewItemPreview[] | null
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
      })
    }
  }
  return stories
    .toSorted((a, b) => storyRank(a.id, seed) - storyRank(b.id, seed))
    .slice(0, limit)
}

export interface FeedStorySpan {
  from: number
  to: number
  epoch: number
}

export function clampFeedSpan(from: number, to: number, lastIndex: number): {
  from: number
  to: number
} {
  const last = Math.max(0, lastIndex)
  const start = Math.min(Math.max(0, from), last)
  return { from: start, to: Math.min(last, Math.max(start, to)) }
}

export function jumpFeedSpan(
  current: FeedStorySpan,
  index: number,
  lastIndex: number,
): FeedStorySpan {
  const last = Math.max(0, lastIndex)
  const at = Math.min(Math.max(0, index), last)
  if (at >= current.from && at <= current.to) return current
  const next = clampFeedSpan(
    Math.min(current.from, Math.max(0, at - 1)),
    Math.max(current.to, at + 1),
    last,
  )
  if (next.from === current.from && next.to === current.to) return current
  return { ...next, epoch: current.epoch }
}

export function expandFeedSpan(
  current: FeedStorySpan,
  dir: 1 | -1,
  lastIndex: number,
): FeedStorySpan {
  const last = Math.max(0, lastIndex)
  if (dir > 0) {
    if (current.to >= last) return current
    return { ...current, to: current.to + 1 }
  }
  if (current.from <= 0) return current
  return { ...current, from: current.from - 1 }
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
    recent_items?: readonly BrewItemPreview[] | null
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
    const sourceId = story.source_id
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
  slots: ReadonlyArray<{ story: Pick<FeedStory, 'source_id'>; column: number }>,
  prev: ReadonlyArray<{ id: number; column: number }> = [],
): Array<{ id: number; column: number }> {
  const starts: Array<{ id: number; column: number }> = []
  for (const slot of slots) {
    const id = slot.story.source_id
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

/** 实装窗里的卡没变就沿用上一份，少触发预热 effect。 */
export function reusePaintedSlots<T>(
  prev: readonly T[],
  next: readonly T[],
): T[] {
  if (
    prev.length === next.length
    && prev.every((item, i) => item === next[i])
  ) {
    return prev as T[]
  }
  return next as T[]
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

export function paintedSlotsInWindow<T>(
  byCol: ReadonlyMap<number, readonly T[]>,
  from: number,
  to: number,
): T[] {
  const next: T[] = []
  for (let col = from; col <= to; col++) {
    const slots = byCol.get(col)
    if (!slots) continue
    for (const slot of slots) next.push(slot)
  }
  return next
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

/** 只扩右边时接着上一份；拼轨变了或收窗再扫列。 */
export function extendPaintedSlots<T>(
  prev: readonly T[],
  prevFrom: number,
  prevTo: number,
  byCol: ReadonlyMap<number, readonly T[]>,
  from: number,
  to: number,
  slotsChanged = false,
): T[] {
  if (slotsChanged || from !== prevFrom || to < prevTo || prev.length === 0) {
    return paintedSlotsInWindow(byCol, from, to)
  }
  if (to === prevTo) return prev as T[]
  const next = prev.slice()
  for (let col = prevTo + 1; col <= to; col++) {
    const slots = byCol.get(col)
    if (!slots) continue
    for (const slot of slots) next.push(slot)
  }
  return next
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
  prev: ReadonlyArray<{ story: Pick<FeedStory, 'id'>; column: number }>,
  next: ReadonlyArray<{ story: Pick<FeedStory, 'id'>; column: number }>,
  leadColumn: number,
): number {
  let leadId: number | undefined
  for (const slot of prev) {
    if (slot.column === leadColumn) {
      leadId = slot.story.id
      break
    }
  }
  if (leadId == null) return 0
  for (const slot of next) {
    if (slot.story.id === leadId) return slot.column - leadColumn
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
    a.source_icon === b.source_icon
  )
}

/** 源列没变时沿用上一帧对象，滚动时少造新文章。 */
export function reuseFeedStories(
  prev: readonly FeedStory[],
  next: readonly FeedStory[],
): FeedStory[] {
  if (prev === next) return next as FeedStory[]
  if (prev.length === 0) return next as FeedStory[]
  const byId = new Map<number, FeedStory>()
  for (const story of prev) byId.set(story.id, story)
  let changed = prev.length !== next.length
  const out = next.map((story, index) => {
    const old = byId.get(story.id)
    if (old && sameFeedStory(old, story)) {
      if (prev[index] !== old) changed = true
      return old
    }
    changed = true
    return story
  })
  return changed ? out : (prev as FeedStory[])
}

export function storyGhostColumns(
  slots: ReadonlyArray<{ story: FeedStory; column: number }>,
  from: number,
  to: number,
): Array<{ id: number; column: number }> {
  const seen = new Set<number>()
  const ghosts: Array<{ id: number; column: number }> = []
  for (const slot of slots) {
    if (slot.column >= from && slot.column <= to) continue
    if (seen.has(slot.column)) continue
    seen.add(slot.column)
    ghosts.push({ id: slot.story.id, column: slot.column })
  }
  return ghosts
}

export function storyRailColumns(stories: readonly FeedStory[]): number {
  let cols = 0
  for (const group of groupStoriesBySource(stories)) {
    cols += Math.max(1, Math.ceil(group.stories.length / 2))
  }
  return Math.max(1, cols)
}

export function latestStoryPreview(
  loose: readonly BrewItemPreview[] | null | undefined,
  recent: readonly BrewItemPreview[] | null | undefined,
): BrewItemPreview | undefined {
  return loose?.[0] ?? recent?.[0]
}

export function storiesForSource(
  fetched: { id: number; items: FeedStory[] } | null,
  source: {
    id: number
    name: string
    icon: string | null
    recent_items?: readonly BrewItemPreview[] | null
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
  }))
}

export interface FeedStorySlot {
  stamp: number
  items: FeedStory[]
}

/** 换源先画能用的：精确戳 → 本会话槽 → 宽松缓存 → 旧槽。 */
export function paintReadyStories(
  stamp: number,
  exact: FeedStory[] | null,
  loose: FeedStory[] | null,
  slot?: FeedStorySlot,
): FeedStory[] | null {
  return (
    exact ??
    (slot?.stamp === stamp ? slot.items : null) ??
    loose ??
    slot?.items ??
    null
  )
}

export function storiesAreFresh(
  stamp: number,
  exact: FeedStory[] | null,
  slot?: FeedStorySlot,
): boolean {
  return exact != null || slot?.stamp === stamp
}
