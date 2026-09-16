/** 收藏在二级导航只给管理员，仍是订阅上的筛选，不是第四板块。 */

import type { SecondaryNavItem } from '../../contexts/NavigationContext'
import { journalPathForNavId } from './logic/journalRoutes'
import {
  LuFolderOpen,
  LuInbox,
  LuLink,
  LuNotebookPen,
  LuStar,
} from '@lib/icons'

const iconClass = 'w-5 h-5'

const feeds = <LuInbox className={iconClass} />
const notes = <LuNotebookPen className={iconClass} />
const sites = <LuLink className={iconClass} />
const starred = <LuStar className={iconClass} />
const workbench = <LuFolderOpen className={iconClass} />

export function phantasiBoardNavItems(
  t: {
    boardFeeds: string
    boardNotes: string
    boardSites: string
    boardWorkbench: string
    starred: string
  },
  options?: { includeStarred?: boolean; includeWorkbench?: boolean },
): SecondaryNavItem[] {
  const items: SecondaryNavItem[] = [
    {
      id: 'feeds',
      icon: feeds,
      label: t.boardFeeds,
      title: t.boardFeeds,
      ariaLabel: t.boardFeeds,
      path: journalPathForNavId('feeds'),
    },
  ]
  if (options?.includeStarred) {
    items.push({
      id: 'starred',
      icon: starred,
      label: t.starred,
      title: t.starred,
      ariaLabel: t.starred,
      path: journalPathForNavId('starred'),
    })
  }
  items.push(
    {
      id: 'notes',
      icon: notes,
      label: t.boardNotes,
      title: t.boardNotes,
      ariaLabel: t.boardNotes,
      path: journalPathForNavId('notes'),
    },
    {
      id: 'sites',
      icon: sites,
      label: t.boardSites,
      title: t.boardSites,
      ariaLabel: t.boardSites,
      path: journalPathForNavId('sites'),
    },
  )
  if (options?.includeWorkbench) {
    items.push({
      id: 'workbench',
      icon: workbench,
      label: t.boardWorkbench,
      title: t.boardWorkbench,
      ariaLabel: t.boardWorkbench,
      path: journalPathForNavId('workbench'),
    })
  }
  return items
}
