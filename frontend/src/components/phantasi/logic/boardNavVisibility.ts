import type { ModuleVisibilityLevel } from '../../../utils/moduleVisibility'
import { canAccessModuleVisibility } from '../../../utils/moduleVisibility'

export const JOURNAL_BOARD_NAV_PANES = [
  'feeds',
  'starred',
  'notes',
  'sites',
  'workbench',
] as const

/** 可改可见性的子页。工作台只跟管理员身份走，不进这张表。 */
export const JOURNAL_BOARD_NAV_OPTIONS = [
  'feeds',
  'notes',
  'sites',
] as const

export type JournalBoardNavPane = (typeof JOURNAL_BOARD_NAV_PANES)[number]

export type BoardNavVisibility = Record<JournalBoardNavPane, ModuleVisibilityLevel>

export const BOARD_NAV_STORAGE_KEY = 'phantasi-board-nav'
export const BOARD_NAV_VISIBILITY_CHANGED = 'phantasi-board-nav-visibility'

const LEVEL_RANK: Record<ModuleVisibilityLevel, number> = {
  all: 0,
  authenticated: 1,
  admin: 2,
}

export const DEFAULT_BOARD_NAV_VISIBILITY: BoardNavVisibility = {
  feeds: 'all',
  starred: 'admin',
  notes: 'all',
  sites: 'all',
  workbench: 'admin',
}

export function boardNavLevelsForPane(
  pane: JournalBoardNavPane,
): readonly ModuleVisibilityLevel[] {
  if (pane === 'workbench' || pane === 'starred') return ['admin']
  return ['all', 'authenticated', 'admin']
}

export function clampBoardNavLevel(
  pane: JournalBoardNavPane,
  level: ModuleVisibilityLevel,
): ModuleVisibilityLevel {
  if (pane === 'workbench' || pane === 'starred') return 'admin'
  return level
}

export function isJournalBoardNavPane(
  value: string,
): value is JournalBoardNavPane {
  return (JOURNAL_BOARD_NAV_PANES as readonly string[]).includes(value)
}

export function isModuleVisibilityLevel(
  value: unknown,
): value is ModuleVisibilityLevel {
  return value === 'all' || value === 'authenticated' || value === 'admin'
}

/** 模块更严的一侧胜出：手帐全关则子页全关；全开则自定义生效。 */
export function tighterVisibility(
  parent: ModuleVisibilityLevel,
  custom: ModuleVisibilityLevel,
): ModuleVisibilityLevel {
  return LEVEL_RANK[parent] >= LEVEL_RANK[custom] ? parent : custom
}

export function parseBoardNavLevel(value: unknown): ModuleVisibilityLevel | null {
  if (isModuleVisibilityLevel(value)) return value
  if (value === true) return 'all'
  if (value === false) return 'admin'
  return null
}

export function normalizeBoardNavVisibility(raw: unknown): BoardNavVisibility {
  const next = { ...DEFAULT_BOARD_NAV_VISIBILITY }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    for (const pane of JOURNAL_BOARD_NAV_PANES) {
      const level = parseBoardNavLevel(record[pane])
      if (level) next[pane] = clampBoardNavLevel(pane, level)
    }
  }
  next.workbench = 'admin'
  return next
}

export function setBoardNavPane(
  current: BoardNavVisibility,
  pane: JournalBoardNavPane,
  level: ModuleVisibilityLevel,
  parent: ModuleVisibilityLevel = 'all',
): BoardNavVisibility {
  if (!boardNavAllowsLevel(current, pane, level, parent)) return current
  return normalizeBoardNavVisibility({ ...current, [pane]: level })
}

export function boardNavAllowsLevel(
  _visibility: BoardNavVisibility,
  pane: JournalBoardNavPane,
  level: ModuleVisibilityLevel,
  parent: ModuleVisibilityLevel,
): boolean {
  if (pane === 'workbench' || pane === 'starred') return level === 'admin'
  return parent === 'all'
}

export function effectiveBoardNavLevel(
  visibility: BoardNavVisibility,
  id: string,
  parent: ModuleVisibilityLevel,
): ModuleVisibilityLevel {
  if (!isJournalBoardNavPane(id)) return parent
  return tighterVisibility(parent, clampBoardNavLevel(id, visibility[id]))
}

export function boardNavShowsToViewer(
  visibility: BoardNavVisibility,
  id: string,
  parent: ModuleVisibilityLevel,
  viewer: { isAuthenticated: boolean; isAdmin: boolean },
): boolean {
  if (!isJournalBoardNavPane(id)) return true
  return canAccessModuleVisibility(
    effectiveBoardNavLevel(visibility, id, parent),
    viewer,
  )
}

export function filterBoardNavItems<T extends { id: string }>(
  items: readonly T[],
  visibility: BoardNavVisibility,
  parent: ModuleVisibilityLevel,
  viewer: { isAuthenticated: boolean; isAdmin: boolean },
): T[] {
  return items.filter((item) =>
    boardNavShowsToViewer(visibility, item.id, parent, viewer),
  )
}

export function readBoardNavVisibility(): BoardNavVisibility {
  try {
    const raw = localStorage.getItem(BOARD_NAV_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_BOARD_NAV_VISIBILITY }
    return normalizeBoardNavVisibility(JSON.parse(raw) as unknown)
  } catch {
    return { ...DEFAULT_BOARD_NAV_VISIBILITY }
  }
}

export function writeBoardNavVisibility(visibility: BoardNavVisibility): void {
  try {
    localStorage.setItem(
      BOARD_NAV_STORAGE_KEY,
      JSON.stringify(normalizeBoardNavVisibility(visibility)),
    )
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BOARD_NAV_VISIBILITY_CHANGED))
  }
}
