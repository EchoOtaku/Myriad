/**
 * Safe CSS `url()` construction for style properties / inline styles.
 *
 * Unquoted `url(...)` breaks when the value contains `)`, whitespace, or quotes.
 * Always emit double-quoted form with CSS-string escapes.
 */

/**
 * Build a CSS `url("...")` token with proper escaping.
 * Empty / nullish input becomes `none` (valid background-image value).
 */
export function cssUrl(url: string | null | undefined): string {
  if (url == null) return 'none'
  const s = String(url)
  if (!s) return 'none'

  // CSS string escapes: backslash first, then quotes and line breaks.
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '')
    .replace(/\f/g, '')

  return `url("${escaped}")`
}

/**
 * Convenience for React `style.backgroundImage`.
 */
export function cssBackgroundImage(url: string | null | undefined): string {
  return cssUrl(url)
}
