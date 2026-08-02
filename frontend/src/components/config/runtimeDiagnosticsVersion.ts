/**
 * Soft cap for version/tag strings in diagnostics badges & detail copy.
 * Full values stay in tooltips and the JSON report.
 */
export const VERSION_TAG_DISPLAY_MAX = 12

/** Truncate a version/tag for UI display; keeps short release tags intact. */
export function truncateVersionTag(
  tag: string,
  maxLen: number = VERSION_TAG_DISPLAY_MAX,
): string {
  const value = tag.trim()
  if (maxLen < 1) return ''
  if (value.length <= maxLen) return value
  if (maxLen === 1) return '…'
  return `${value.slice(0, maxLen - 1)}…`
}
