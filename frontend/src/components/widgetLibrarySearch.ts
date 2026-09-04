/**
 * Widget library search — matches against each widget's runtime metadata.
 *
 * Built-in and third-party (Tapp) widgets both go through the same path:
 * id / name / optional display label / any extra strings the registry provides
 * (category, tappId, description…). No preset allowlist.
 */

import {
  TAPP_CATEGORIES,
  normalizeTappCategory,
} from '../tapp/utils/tappCategories'

export interface WidgetLibrarySearchable {
  id: string
  name: string
  /** UI-resolved label when available (i18n or host-provided). */
  label?: string | null
  /** Free-form extras: category, tappId, description, aliases… */
  extras?: Array<string | null | undefined>
}

export function normalizeWidgetLibraryQuery(query: string): string {
  return query.trim().toLowerCase()
}

/** Expand id separators so "music player" can hit `music-player`. */
function idSearchVariants(id: string): string[] {
  const trimmed = id.trim()
  if (!trimmed) return []
  const spaced = trimmed.replace(/[-_./]+/g, ' ').replace(/\s+/g, ' ').trim()
  return spaced && spaced !== trimmed ? [trimmed, spaced] : [trimmed]
}

/** Collect searchable strings for one widget entry. */
export function collectWidgetLibrarySearchText(
  widget: WidgetLibrarySearchable,
): Array<string | null | undefined> {
  return [
    widget.label,
    widget.name,
    ...idSearchVariants(widget.id),
    ...(widget.extras ?? []),
  ]
}

export function widgetMatchesLibrarySearch(
  query: string,
  candidates: Array<string | null | undefined>,
): boolean {
  const q = normalizeWidgetLibraryQuery(query)
  if (!q) return true
  return candidates.some((candidate) => {
    const value = candidate?.trim().toLowerCase()
    return Boolean(value && value.includes(q))
  })
}

/** Convenience: match one library entry by its runtime fields. */
export function widgetTypeMatchesLibrarySearch(
  query: string,
  widget: WidgetLibrarySearchable,
): boolean {
  return widgetMatchesLibrarySearch(
    query,
    collectWidgetLibrarySearchText(widget),
  )
}

export const WIDGET_LIBRARY_SIZE_ORDER = [
  '1x1',
  '2x1',
  '1x2',
  '2x2',
  '2x3',
  '3x2',
  '3x3',
  '2x4',
  '4x1',
  '4x2',
  '4x4',
] as const

export type WidgetLibrarySize = (typeof WIDGET_LIBRARY_SIZE_ORDER)[number]
export type WidgetLibraryKindFilter =
  | 'all'
  | 'builtin'
  | 'report'
  | `tapp:${string}`
export type WidgetLibraryFilter = WidgetLibraryKindFilter | `size:${string}`

export interface WidgetLibraryKindSource {
  id: string
  isTappWidget?: boolean
  category?: string
}

export interface WidgetLibrarySizeSource {
  defaultSize: string
  supportedSizes?: string[]
}

export function widgetLibrarySizes(
  widget: WidgetLibrarySizeSource,
): string[] {
  const sizes = widget.supportedSizes?.filter(Boolean)
  if (sizes && sizes.length > 0) return [...new Set(sizes)]
  return widget.defaultSize ? [widget.defaultSize] : []
}

export function formatWidgetLibrarySize(size: string): string {
  return size.replace(/x/gi, '×')
}

export function widgetMatchesLibrarySize(
  filter: 'all' | string,
  widget: WidgetLibrarySizeSource,
): boolean {
  if (filter === 'all') return true
  return widgetLibrarySizes(widget).includes(filter)
}

/** Size options for the compact control; empty when only one size exists. */
export function presentWidgetLibrarySizes(
  widgets: WidgetLibrarySizeSource[],
): string[] {
  const seen = new Set<string>()
  for (const widget of widgets) {
    for (const size of widgetLibrarySizes(widget)) seen.add(size)
  }
  if (seen.size <= 1) return []
  const known = WIDGET_LIBRARY_SIZE_ORDER.filter((size) => seen.has(size))
  const extra = [...seen]
    .filter(
      (size) =>
        !(WIDGET_LIBRARY_SIZE_ORDER as readonly string[]).includes(size),
    )
    .sort()
  return [...known, ...extra]
}

/** Host widgets join the same topic rows as Tapp categories. */
const BUILTIN_TOPIC_BY_ID: Record<
  string,
  Exclude<WidgetLibraryKindFilter, 'all'>
> = {
  'agent-persona': 'tapp:ai',
  'music-player': 'tapp:media',
  'social-network': 'tapp:social',
  'friend-links': 'tapp:social',
  'game-presence': 'tapp:game',
  'quick-stats': 'tapp:data',
  'recent-activity': 'tapp:data',
  'visitor-stats': 'tapp:data',
}

export function classifyWidgetLibraryKind(
  widget: WidgetLibraryKindSource,
): Exclude<WidgetLibraryKindFilter, 'all'> {
  if (widget.isTappWidget) {
    return `tapp:${normalizeTappCategory(widget.category)}`
  }
  if (widget.id.startsWith('report-')) return 'report'
  if (widget.id.startsWith('platform-')) return 'tapp:social'
  return BUILTIN_TOPIC_BY_ID[widget.id] ?? 'tapp:utility'
}

export function widgetMatchesLibraryKind(
  filter: WidgetLibraryKindFilter,
  widget: WidgetLibraryKindSource,
): boolean {
  if (filter === 'all') return true
  return classifyWidgetLibraryKind(widget) === filter
}

/**
 * 全部, then only kinds that currently have a widget.
 * Host builtins share Tapp topic rows (媒体 / 社交 / …) instead of a dump bucket.
 */
export function presentWidgetLibraryKindFilters(
  widgets: WidgetLibraryKindSource[],
): WidgetLibraryKindFilter[] {
  const seen = new Set<Exclude<WidgetLibraryKindFilter, 'all'>>()
  for (const widget of widgets) {
    seen.add(classifyWidgetLibraryKind(widget))
  }
  const chips: WidgetLibraryKindFilter[] = ['all']
  if (seen.has('report')) chips.push('report')
  if (seen.has('builtin')) chips.push('builtin')
  for (const category of TAPP_CATEGORIES) {
    const kind = `tapp:${category}` as const
    if (seen.has(kind)) chips.push(kind)
  }
  for (const kind of [...seen].sort()) {
    if (kind.startsWith('tapp:') && !chips.includes(kind)) chips.push(kind)
  }
  return chips
}

export function tappCategoryFromKindFilter(
  filter: WidgetLibraryKindFilter | WidgetLibraryFilter,
): string | null {
  if (!filter.startsWith('tapp:')) return null
  return filter.slice('tapp:'.length) || null
}

export function sizeFromLibraryFilter(
  filter: WidgetLibraryFilter,
): string | null {
  if (!filter.startsWith('size:')) return null
  return filter.slice('size:'.length) || null
}

export function widgetMatchesLibraryFilter(
  filter: WidgetLibraryFilter,
  widget: WidgetLibraryKindSource & WidgetLibrarySizeSource,
): boolean {
  if (filter === 'all') return true
  const size = sizeFromLibraryFilter(filter)
  if (size) return widgetLibrarySizes(widget).includes(size)
  return classifyWidgetLibraryKind(widget) === filter
}

/** 全部 + 当前有小组件的主题分类 + 尺寸（尺寸多于一种才列入）. */
export function presentWidgetLibraryFilters(
  widgets: Array<WidgetLibraryKindSource & WidgetLibrarySizeSource>,
): WidgetLibraryFilter[] {
  const kinds = presentWidgetLibraryKindFilters(widgets)
  const sizes = presentWidgetLibrarySizes(widgets)
  return [...kinds, ...sizes.map((size) => `size:${size}` as const)]
}
