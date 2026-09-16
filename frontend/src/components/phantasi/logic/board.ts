/** `sites` 深链 id 不能改。朋友们收「友情链接」分类；订阅墙不收入口型和笔记源。 */

import type { PhantasiSource } from '../../../types/phantasi'
import type { PhantasiViewerRole } from './score'
import {
  phantasiCategoryParts,
  phantasiMainCategory,
  isFriendLinkCategory,
  isMineCategory,
  isOwnPhantasiSource,
} from '../constants'
import { compareByScore } from './score'

export type PhantasiBoard = 'feeds' | 'notes' | 'sites'

/** 收藏和主题流不是板块，是订阅上的筛选。工作台也不是板块。 */
export type PhantasiViewMode = 'sources' | 'starred' | 'topic-feed' | 'workbench'

export type WorkbenchPane =
  | 'home'
  | 'notes'
  | 'comments'
  | 'media'
  | 'sources'
  | 'add'
  | 'topics'
  | 'rsshub'
  | 'notesIo'
  | 'feedsIo'
  | 'noteCategories'
  | 'sourceCategories'
  | 'reviews'

export const NOTE_TRANSFER_KINDS = [
  'wordpress',
  'halo',
  'typecho',
  'markdown',
] as const

export type NoteTransferKind = (typeof NOTE_TRANSFER_KINDS)[number]

const PHANTASI_BOARDS = [
  'feeds',
  'notes',
  'sites',
] as const satisfies readonly PhantasiBoard[]

export function isPhantasiBoard(value: string): value is PhantasiBoard {
  return (PHANTASI_BOARDS as readonly string[]).includes(value)
}

/** 入口型：不抓取、无未读、不进阅读器。 */
export function isSiteSource<T extends { source_type: string }>(
  s: T,
): s is T & { source_type: 'link' } {
  return s.source_type === 'link'
}

/** 朋友们点网站卡：去对方站点，不进阅读器。 */
export function visitFriendHref(
  source: Pick<PhantasiSource, 'site_url' | 'url'>,
): string | null {
  const href = source.site_url?.trim() || source.url?.trim()
  return href || null
}

export function refreshableSourceCount(
  sources: readonly Pick<PhantasiSource, 'source_type'>[],
): number {
  return sources.filter((source) => !isSiteSource(source)).length
}

export function isNotesSource(
  s: Pick<PhantasiSource, 'source_type' | 'category' | 'admin_only'>,
): boolean {
  return s.source_type === 'note' || isOwnPhantasiSource(s)
}

/** 朋友们：分类含「友情链接」的都收，类型不限。入口型没挂分类也收。 */
export function isFriendSource(
  s: Pick<PhantasiSource, 'source_type' | 'category'>,
): boolean {
  if (isSiteSource(s)) return true
  return phantasiCategoryParts(s.category).some(isFriendLinkCategory)
}

export function sourcesForBoard(
  sources: readonly PhantasiSource[],
  board: PhantasiBoard,
): PhantasiSource[] {
  if (board === 'sites') return sources.filter(isFriendSource)
  if (board === 'notes') return sources.filter(isNotesSource)
  return sources.filter(
    (s) => s.source_type !== 'link' && s.source_type !== 'note',
  )
}

export function collectSourceCategories(
  sources: readonly Pick<PhantasiSource, 'category'>[],
): string[] {
  const cats = new Set<string>()
  for (const source of sources) {
    for (const part of phantasiCategoryParts(source.category)) cats.add(part)
  }
  return Iterator.from(cats).toArray()
}

const CANON_FRIEND_CATEGORY = '友情链接'
const CANON_MINE_CATEGORY = '我'

/** 工作台筛选用：预置分类收成官网名，不造「未分类」。 */
export function collectWorkbenchSourceCategories(
  sources: readonly Pick<PhantasiSource, 'category'>[],
): string[] {
  const cats = new Set<string>()
  for (const source of sources) {
    for (const part of phantasiCategoryParts(source.category)) {
      if (isFriendLinkCategory(part)) cats.add(CANON_FRIEND_CATEGORY)
      else if (isMineCategory(part)) cats.add(CANON_MINE_CATEGORY)
      else cats.add(part)
    }
  }
  return [...cats].toSorted((a, b) => a.localeCompare(b, 'zh'))
}

export const WORKBENCH_SOURCE_KINDS = [
  'rss',
  'rsshub',
  'notion',
  'link',
  'note',
] as const

export type WorkbenchSourceKind = (typeof WORKBENCH_SOURCE_KINDS)[number]

export function workbenchSourceKind(
  source: Pick<PhantasiSource, 'source_type' | 'feed_type'>,
): WorkbenchSourceKind {
  if (source.source_type === 'note') return 'note'
  if (source.source_type === 'link') return 'link'
  if (source.source_type === 'rsshub' || source.feed_type === 'rsshub')
    return 'rsshub'
  if (source.feed_type === 'notion') return 'notion'
  return 'rss'
}

export function collectWorkbenchSourceKinds(
  sources: readonly Pick<PhantasiSource, 'source_type' | 'feed_type'>[],
): WorkbenchSourceKind[] {
  const seen = new Set(sources.map(workbenchSourceKind))
  return WORKBENCH_SOURCE_KINDS.filter((kind) => seen.has(kind))
}

export function sourceMatchesKind(
  source: Pick<PhantasiSource, 'source_type' | 'feed_type'>,
  kind: WorkbenchSourceKind,
): boolean {
  return workbenchSourceKind(source) === kind
}

export function sourceMatchesCategory(
  source: Pick<PhantasiSource, 'category'>,
  category: string,
): boolean {
  const parts = phantasiCategoryParts(source.category)
  if (isFriendLinkCategory(category)) return parts.some(isFriendLinkCategory)
  if (isMineCategory(category)) return parts.some(isMineCategory)
  return parts.includes(category)
}

export function haystackMatchesQuery(
  query: string,
  ...parts: Array<string | null | undefined>
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return parts.some((part) => !!part && part.toLowerCase().includes(needle))
}

export function filterSourcesByQuery(
  sources: readonly PhantasiSource[],
  query: string,
): PhantasiSource[] {
  if (!query.trim()) return Iterator.from(sources).toArray()
  return sources.filter((source) =>
    haystackMatchesQuery(query, source.name, source.url, source.description),
  )
}

export function filterItemsByQuery<
  T extends {
    title?: string | null
    source_name?: string | null
    author?: string | null
  },
>(items: readonly T[], query: string): T[] {
  if (!query.trim()) return Iterator.from(items).toArray()
  return items.filter((item) =>
    haystackMatchesQuery(query, item.title, item.source_name, item.author),
  )
}

export type SourceSortMode = 'smart' | 'update' | 'category' | 'pinyin'

export function sortSourcesForBoard(
  sources: readonly PhantasiSource[],
  mode: SourceSortMode,
  role: PhantasiViewerRole,
  now: number,
  locale = 'en-US',
): PhantasiSource[] {
  switch (mode) {
    case 'smart':
      return sources.toSorted((a, b) => compareByScore(a, b, role, now))
    case 'update':
      return sources.toSorted((a, b) => {
        const latestA =
          a.recent_items?.[0]?.published_at || a.last_success_at || 0
        const latestB =
          b.recent_items?.[0]?.published_at || b.last_success_at || 0
        return latestB - latestA
      })
    case 'category':
      return sources.toSorted((a, b) => {
        const catA = phantasiMainCategory(a.category, '')
        const catB = phantasiMainCategory(b.category, '')
        if (catA !== catB) return catA.localeCompare(catB, locale)
        return a.name.localeCompare(b.name, locale)
      })
    case 'pinyin':
      return sources.toSorted((a, b) => a.name.localeCompare(b.name, locale))
    default:
      return Iterator.from(sources).toArray()
  }
}

/** 三个板块都进源墙；收藏仍是订阅上的筛选。工作台不是源墙。 */
export type PhantasiBoardEntry =
  | { view: 'sources'; board: PhantasiBoard }
  | { view: 'starred'; board: 'feeds' }
  | { view: 'workbench' }

export function workbenchEntry(): PhantasiBoardEntry {
  return { view: 'workbench' }
}

export const WORKBENCH_PANES = [
  'home',
  'notes',
  'comments',
  'media',
  'sources',
  'add',
  'topics',
  'rsshub',
  'notesIo',
  'feedsIo',
  'noteCategories',
  'sourceCategories',
  'reviews',
] as const satisfies readonly WorkbenchPane[]

/** 旧深链 pane=list 并进订阅页；pane=add 进添加订阅。导入导出旧名并进两页。 */
export function resolveWorkbenchPane(value: string | null): WorkbenchPane {
  if (value === 'list') return 'sources'
  if (value === 'category' || value === 'categories') return 'noteCategories'
  if (value === 'sourceCategory') return 'sourceCategories'
  if (
    value === 'wordpress' ||
    value === 'halo' ||
    value === 'typecho' ||
    value === 'markdown' ||
    value === 'notesIo'
  ) {
    return 'notesIo'
  }
  if (value === 'pipack' || value === 'opml' || value === 'feedsIo') {
    return 'feedsIo'
  }
  if (value && (WORKBENCH_PANES as readonly string[]).includes(value)) {
    return value as WorkbenchPane
  }
  return 'home'
}

export function boardEntry(board: PhantasiBoard): PhantasiBoardEntry {
  return { view: 'sources', board }
}

/** `?category=friends|mine|all|starred` 深链不能断。starred → 订阅板块 + 收藏视图。 */
const LEGACY_NAV_TO_BOARD: Record<string, PhantasiBoardEntry> = {
  all: { view: 'sources', board: 'feeds' },
  friends: { view: 'sources', board: 'sites' },
  mine: { view: 'sources', board: 'notes' },
  starred: { view: 'starred', board: 'feeds' },
}

/** `?board=` 优先；认不出的取值返回 null，不回落默认板块。 */
export function resolveBoardParam(value: string): PhantasiBoardEntry | null {
  if (isPhantasiBoard(value)) return boardEntry(value)
  if (value === 'friends') return boardEntry('sites')
  if (value === 'workbench') return workbenchEntry()
  return LEGACY_NAV_TO_BOARD[value] ?? null
}

/** 二级导航高亮：登录后收藏用 starred；工作台只给管理员。 */
export function navIdForBoardEntry(
  entry: PhantasiBoardEntry,
  isAuthenticated: boolean,
  isAdmin = false,
): string {
  if (entry.view === 'workbench') return isAdmin ? 'workbench' : 'feeds'
  if (entry.view === 'starred' && isAuthenticated) return 'starred'
  return entry.board
}

/** 游客没有收藏；非管理员没有工作台。 */
export function viewForBoardEntry(
  entry: PhantasiBoardEntry,
  isAuthenticated: boolean,
  isAdmin = false,
): PhantasiViewMode {
  if (entry.view === 'workbench') return isAdmin ? 'workbench' : 'sources'
  if (entry.view === 'starred' && !isAuthenticated) return 'sources'
  return entry.view
}

/** 落地后把 query 吃掉，刷新和后退不再触发一次。 */
export function eatSearchKeys(
  params: URLSearchParams,
  keys: readonly string[],
): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of keys) next.delete(key)
  return next
}

/** 分页 items 只属于收藏和主题流。 */
export function filterLaneItems<T>(
  viewMode: PhantasiViewMode,
  items: T[],
  empty: T[],
): T[] {
  return viewMode === 'starred' || viewMode === 'topic-feed' ? items : empty
}

export function showsFilterLane(
  viewMode: PhantasiViewMode,
  hasTopic: boolean,
  isAuthenticated: boolean,
): boolean {
  return (
    (viewMode === 'topic-feed' && hasTopic) ||
    (viewMode === 'starred' && isAuthenticated)
  )
}
