import type { WorkbenchPane } from './board'

export const WORKBENCH_RAIL_OPTION_PANES = [
  'notes',
  'comments',
  'media',
  'notesIo',
  'sources',
  'reviews',
  'rsshub',
  'feedsIo',
] as const

export type WorkbenchRailOptionPane = (typeof WORKBENCH_RAIL_OPTION_PANES)[number]

export type WorkbenchRailVisibility = Record<WorkbenchRailOptionPane, boolean>

export const WORKBENCH_RAIL_MIN_VISIBLE = 2
export const WORKBENCH_RAIL_STORAGE_KEY = 'phantasi-workbench-rail'

export const DEFAULT_WORKBENCH_RAIL_VISIBILITY: WorkbenchRailVisibility =
  Object.fromEntries(
    WORKBENCH_RAIL_OPTION_PANES.map((pane) => [pane, true]),
  ) as WorkbenchRailVisibility

export function isWorkbenchRailOptionPane(
  value: string,
): value is WorkbenchRailOptionPane {
  return (WORKBENCH_RAIL_OPTION_PANES as readonly string[]).includes(value)
}

export function workbenchRailVisibleCount(
  visibility: WorkbenchRailVisibility,
): number {
  return WORKBENCH_RAIL_OPTION_PANES.filter((pane) => visibility[pane]).length
}

export function normalizeWorkbenchRailVisibility(
  raw: unknown,
): WorkbenchRailVisibility {
  const next = { ...DEFAULT_WORKBENCH_RAIL_VISIBILITY }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    for (const pane of WORKBENCH_RAIL_OPTION_PANES) {
      if (typeof record[pane] === 'boolean') next[pane] = record[pane]
    }
  }
  if (workbenchRailVisibleCount(next) >= WORKBENCH_RAIL_MIN_VISIBLE) return next
  for (const pane of WORKBENCH_RAIL_OPTION_PANES) {
    if (workbenchRailVisibleCount(next) >= WORKBENCH_RAIL_MIN_VISIBLE) break
    next[pane] = true
  }
  return next
}

export function setWorkbenchRailPane(
  current: WorkbenchRailVisibility,
  pane: WorkbenchRailOptionPane,
  visible: boolean,
): WorkbenchRailVisibility {
  return normalizeWorkbenchRailVisibility({ ...current, [pane]: visible })
}

export function workbenchRailAllowsHide(
  visibility: WorkbenchRailVisibility,
  pane: WorkbenchRailOptionPane,
): boolean {
  if (!visibility[pane]) return true
  return workbenchRailVisibleCount(visibility) > WORKBENCH_RAIL_MIN_VISIBLE
}

export function workbenchRailShowsPane(
  visibility: WorkbenchRailVisibility,
  pane: WorkbenchPane,
): boolean {
  if (pane === 'home') return true
  if (isWorkbenchRailOptionPane(pane)) return visibility[pane]
  if (pane === 'add' || pane === 'topics' || pane === 'sourceCategories') {
    return visibility.sources
  }
  if (pane === 'noteCategories') return visibility.notes
  return true
}

export function readWorkbenchRailVisibility(): WorkbenchRailVisibility {
  try {
    const raw = localStorage.getItem(WORKBENCH_RAIL_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_WORKBENCH_RAIL_VISIBILITY }
    return normalizeWorkbenchRailVisibility(JSON.parse(raw) as unknown)
  } catch {
    return { ...DEFAULT_WORKBENCH_RAIL_VISIBILITY }
  }
}

export function writeWorkbenchRailVisibility(
  visibility: WorkbenchRailVisibility,
): void {
  try {
    localStorage.setItem(
      WORKBENCH_RAIL_STORAGE_KEY,
      JSON.stringify(normalizeWorkbenchRailVisibility(visibility)),
    )
  } catch {
    /* ignore */
  }
}
