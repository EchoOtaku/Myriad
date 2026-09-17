/** 用户可见手帐路由。内部模块名仍是 phantasi；联邦对象 ID 仍是 `/phantasi/articles/{id}`。 */

import type { PhantasiBoard, PhantasiViewMode, WorkbenchPane } from './board'

export const JOURNAL_ROOT = '/journal'
export const NOTES_RSS_PATH = '/journal/notes.xml'

export type JournalLocation =
  | { kind: 'feeds' }
  | { kind: 'notes' }
  | { kind: 'friends' }
  | { kind: 'starred' }
  | { kind: 'topic'; topic: string }
  | { kind: 'article'; itemId: string }
  | { kind: 'workbench'; pane: WorkbenchPane }

export const WORKBENCH_PANE_PATHS: Record<WorkbenchPane, string> = {
  home: '/journal/workbench',
  notes: '/journal/workbench/notes',
  comments: '/journal/workbench/comments',
  reviews: '/journal/workbench/reviews',
  media: '/journal/workbench/media',
  sources: '/journal/workbench/feeds',
  add: '/journal/workbench/feeds/add',
  topics: '/journal/workbench/feeds/topics',
  rsshub: '/journal/workbench/rsshub',
  notesIo: '/journal/workbench/notes/import',
  feedsIo: '/journal/workbench/feeds/import',
  noteCategories: '/journal/workbench/notes/categories',
  sourceCategories: '/journal/workbench/feeds/categories',
}

/** 先匹配更长的工作台段，避免 `notes` 吃掉 `notes/import`。 */
const WORKBENCH_MATCH_ORDER: readonly WorkbenchPane[] = [
  'noteCategories',
  'sourceCategories',
  'notesIo',
  'feedsIo',
  'add',
  'topics',
  'notes',
  'comments',
  'reviews',
  'media',
  'sources',
  'rsshub',
  'home',
]

export function journalItemPath(itemId: number | string): string {
  return `${JOURNAL_ROOT}/articles/${encodeURIComponent(String(itemId))}`
}

export function journalTopicPath(topic: string): string {
  return `${JOURNAL_ROOT}/topics/${encodeURIComponent(topic)}`
}

/** 跨页进入可以定位网站卡片，但不给卡片独立地址。 */
export function journalSourceFocus(state: unknown): number | null {
  if (!state || typeof state !== 'object' || !('journalSourceId' in state)) return null
  const id = state.journalSourceId
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

export function journalBoardPath(board: PhantasiBoard): string {
  if (board === 'sites') return `${JOURNAL_ROOT}/friends`
  if (board === 'notes') return `${JOURNAL_ROOT}/notes`
  return JOURNAL_ROOT
}

export function journalPathForNavId(navId: string): string {
  if (navId === 'notes') return `${JOURNAL_ROOT}/notes`
  if (navId === 'sites') return `${JOURNAL_ROOT}/friends`
  if (navId === 'starred') return `${JOURNAL_ROOT}/starred`
  if (navId === 'workbench') return WORKBENCH_PANE_PATHS.home
  return JOURNAL_ROOT
}

export function journalListPath(opts: {
  viewMode: PhantasiViewMode
  board: PhantasiBoard
  topic?: string | null
  workbenchPane?: WorkbenchPane
}): string {
  if (opts.viewMode === 'workbench') {
    return WORKBENCH_PANE_PATHS[opts.workbenchPane ?? 'home']
  }
  if (opts.viewMode === 'starred') return `${JOURNAL_ROOT}/starred`
  if (opts.viewMode === 'topic-feed' && opts.topic) {
    return journalTopicPath(opts.topic)
  }
  return journalBoardPath(opts.board)
}

export function isJournalAppPath(pathname: string): boolean {
  return pathname === JOURNAL_ROOT || pathname.startsWith(`${JOURNAL_ROOT}/`)
}

function trimPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '') || '/'
  }
  return pathname
}

function oneSegment(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  if (!rest || rest.includes('/')) return null
  return rest
}

export function parseJournalPath(pathname: string): JournalLocation | null {
  const path = trimPath(pathname)
  if (path === JOURNAL_ROOT || path === `${JOURNAL_ROOT}/feeds`) {
    return { kind: 'feeds' }
  }
  if (path === `${JOURNAL_ROOT}/notes`) return { kind: 'notes' }
  if (path === `${JOURNAL_ROOT}/friends`) return { kind: 'friends' }
  if (path === `${JOURNAL_ROOT}/starred`) return { kind: 'starred' }

  const itemId = oneSegment(path, `${JOURNAL_ROOT}/articles/`)
  if (itemId) return { kind: 'article', itemId }

  const topicSeg = oneSegment(path, `${JOURNAL_ROOT}/topics/`)
  if (topicSeg) {
    try {
      return { kind: 'topic', topic: decodeURIComponent(topicSeg) }
    } catch {
      return { kind: 'topic', topic: topicSeg }
    }
  }

  if (path === `${JOURNAL_ROOT}/workbench` || path.startsWith(`${JOURNAL_ROOT}/workbench/`)) {
    for (const pane of WORKBENCH_MATCH_ORDER) {
      if (path === WORKBENCH_PANE_PATHS[pane]) {
        return { kind: 'workbench', pane }
      }
    }
    return { kind: 'workbench', pane: 'home' }
  }

  return null
}

export function navIdForJournalLocation(
  loc: JournalLocation,
  _isAuthenticated: boolean,
  isAdmin: boolean,
): string {
  if (loc.kind === 'workbench') return isAdmin ? 'workbench' : 'feeds'
  if (loc.kind === 'starred') return isAdmin ? 'starred' : 'feeds'
  if (loc.kind === 'notes') return 'notes'
  if (loc.kind === 'friends') return 'sites'
  return 'feeds'
}

/** 这条地址是否已经落在该二级导航下（含子路径）。文章是叠层，不算停在任何板块首页。 */
export function pathShowsNavId(pathname: string, navId: string): boolean {
  const loc = parseJournalPath(pathname)
  if (!loc || loc.kind === 'article') return false
  return navIdForJournalLocation(loc, true, true) === navId
}

/**
 * 用户点了二级导航才改 URL。路径刚同步过来的 activeId 不得回写，
 * 否则刷新 `/journal/notes` 时默认 `feeds` 与 URL 会互相 navigate。
 */
export function pathForActiveIdChange(
  pathname: string,
  activeId: string,
  fromPathSync: boolean,
): string | null {
  if (fromPathSync) return null
  if (pathShowsNavId(pathname, activeId)) return null
  return journalPathForNavId(activeId)
}

export function seoListNoindex(viewMode: PhantasiViewMode): boolean {
  return (
    viewMode === 'workbench' ||
    viewMode === 'starred' ||
    viewMode === 'topic-feed'
  )
}

/** 主题流可以有链接，但不按自有写作收录。 */
export function isJournalSyndicationPath(pathname: string): boolean {
  const loc = parseJournalPath(pathname)
  return loc?.kind === 'topic'
}

/** 转载页用 noindex,follow；工作台/收藏用 noindex,nofollow。 */
export function seoJournalFollow(pathname: string, viewMode: PhantasiViewMode): boolean {
  return isJournalSyndicationPath(pathname) || viewMode === 'topic-feed'
}
