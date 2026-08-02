/**
 * Widget library search — matches against each widget's runtime metadata.
 *
 * Built-in and third-party (Tapp) widgets both go through the same path:
 * id / name / optional display label / any extra strings the registry provides
 * (category, tappId, description…). No preset allowlist.
 */

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
