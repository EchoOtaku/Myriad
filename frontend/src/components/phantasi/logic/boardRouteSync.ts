/** 手帐地址 ↔ 二级导航：只让「用户点导航」改 URL，刷新深链不得回写。 */

import {
  JOURNAL_ROOT,
  NOTES_RSS_PATH,
  isJournalAppPath,
  navIdForJournalLocation,
  parseJournalPath,
  pathForActiveIdChange,
} from './journalRoutes.ts'

export type PathSync =
  | { action: 'none' }
  | { action: 'keep-article' }
  | { action: 'apply'; navId: string }
  | { action: 'bounce'; to: string }

/** 路径同步还没落到 activeId 时记下「从哪来、要去哪」，避免把首屏旧值当成用户点击。 */
export type PendingPathSync = { target: string; from: string }

export function decidePathSync(
  pathname: string,
  isAuthenticated: boolean,
  isAdmin: boolean,
): PathSync {
  if (!isJournalAppPath(pathname) || pathname === NOTES_RSS_PATH) {
    return { action: 'none' }
  }
  const loc = parseJournalPath(pathname)
  if (!loc) return { action: 'bounce', to: JOURNAL_ROOT }
  if (loc.kind === 'article') return { action: 'keep-article' }
  if (loc.kind === 'starred' && !isAdmin) {
    return { action: 'bounce', to: JOURNAL_ROOT }
  }
  if (loc.kind === 'workbench' && !isAdmin) {
    return { action: 'bounce', to: JOURNAL_ROOT }
  }
  return {
    action: 'apply',
    navId: navIdForJournalLocation(loc, isAuthenticated, isAdmin),
  }
}

export function decideNavWrite(opts: {
  activeId: string
  prevActiveId: string
  pathname: string
  pending: PendingPathSync | null
}): {
  pending: PendingPathSync | null
  prevActiveId: string
  navigateTo: string | null
  applyBoard: boolean
} {
  const { activeId, prevActiveId, pathname, pending } = opts

  if (pending) {
    if (activeId === pending.target) {
      return {
        pending: null,
        prevActiveId: activeId,
        navigateTo: null,
        applyBoard: false,
      }
    }
    if (activeId === pending.from) {
      return {
        pending,
        prevActiveId: pending.target,
        navigateTo: null,
        applyBoard: false,
      }
    }
  }

  if (!pending && prevActiveId === activeId) {
    return {
      pending: null,
      prevActiveId,
      navigateTo: null,
      applyBoard: false,
    }
  }

  return {
    pending: null,
    prevActiveId: activeId,
    navigateTo: pathForActiveIdChange(pathname, activeId, false),
    applyBoard: true,
  }
}
