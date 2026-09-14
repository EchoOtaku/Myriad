/** 收藏在二级导航，仍是订阅上的筛选，不是第四板块。 */

import type { SecondaryNavItem } from '../../contexts/NavigationContext'

const feeds = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
    />
  </svg>
)

const notes = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
    />
  </svg>
)

const sites = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
    />
  </svg>
)

const starred = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
    />
  </svg>
)

const workbench = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 7h16M4 12h16M4 17h10"
    />
  </svg>
)

export function brewBoardNavItems(
  t: {
    boardFeeds: string
    boardFeedsTitle: string
    boardNotes: string
    boardNotesTitle: string
    boardSites: string
    boardSitesTitle: string
    boardWorkbench: string
    boardWorkbenchTitle: string
    starred: string
  },
  options?: { includeStarred?: boolean; includeWorkbench?: boolean },
): SecondaryNavItem[] {
  const items: SecondaryNavItem[] = [
    {
      id: 'feeds',
      icon: feeds,
      label: t.boardFeeds,
      title: t.boardFeedsTitle,
      ariaLabel: t.boardFeedsTitle,
    },
  ]
  if (options?.includeStarred) {
    items.push({
      id: 'starred',
      icon: starred,
      label: t.starred,
      title: t.starred,
      ariaLabel: t.starred,
    })
  }
  items.push(
    {
      id: 'notes',
      icon: notes,
      label: t.boardNotes,
      title: t.boardNotesTitle,
      ariaLabel: t.boardNotesTitle,
    },
    {
      id: 'sites',
      icon: sites,
      label: t.boardSites,
      title: t.boardSitesTitle,
      ariaLabel: t.boardSitesTitle,
    },
  )
  if (options?.includeWorkbench) {
    items.push({
      id: 'workbench',
      icon: workbench,
      label: t.boardWorkbench,
      title: t.boardWorkbenchTitle,
      ariaLabel: t.boardWorkbenchTitle,
    })
  }
  return items
}
