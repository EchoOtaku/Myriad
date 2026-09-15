import type { CommentItem } from '../../../services/phantasiApi'
import type { AnnotationItem } from '../../../services/phantasiaiApi'
import type { ThemeKey } from './types'

interface TextAnchor {
  selected_text: string
  start_offset?: number
  end_offset?: number
  context_before?: string
  context_after?: string
}

const MEDIA_EXEMPT =
  'script, style, button, iframe, [data-embed-exempt], .note-widget, .phantasi-embed-card, .phantasi-embed-exempt, .phantasi-bilibili-embed, .phantasi-netease-music, .phantasi-steam-game, .phantasi-bilibili-video, .math, .katex, .note-math, .notion-equation, .notion-inline-equation'

/** Marks stay elements: overlap, keyboard, and media exemption need DOM. */
export function cssCustomHighlightAvailable(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS
}

export function commentAnchorStale(
  comment: { content_revision?: number | null },
  itemRevision: number | null | undefined,
): boolean {
  return (
    typeof comment.content_revision === 'number' &&
    typeof itemRevision === 'number' &&
    comment.content_revision !== itemRevision
  )
}

/** Ambiguous anchors stay in the comment panel; do not guess marks. */
export function resolveCommentAnchor(
  text: string,
  anchor: TextAnchor,
): number | null {
  const quote = anchor.selected_text
  if (!quote) return null
  const matchesContext = (start: number) =>
    (!anchor.context_before ||
      text.slice(0, start).endsWith(anchor.context_before)) &&
    (!anchor.context_after ||
      text.slice(start + quote.length).startsWith(anchor.context_after))
  const offset = anchor.start_offset
  if (
    offset !== undefined &&
    Number.isInteger(offset) &&
    offset >= 0 &&
    text.slice(offset, offset + quote.length) === quote &&
    matchesContext(offset) &&
    (anchor.end_offset === undefined ||
      anchor.end_offset === offset + quote.length)
  ) {
    return offset
  }
  const candidates: number[] = []
  let position = text.indexOf(quote)
  while (position !== -1) {
    if (matchesContext(position)) candidates.push(position)
    position = text.indexOf(quote, position + 1)
  }
  return candidates.length === 1 ? candidates[0] : null
}

export function unwrapTextDecorations(
  root: HTMLElement,
  selector = 'mark.user-comment-highlight, mark.phantasiai-annotation',
): void {
  for (const mark of [...root.querySelectorAll(selector)]) {
    mark.replaceWith(...mark.childNodes)
  }
}

function commentMarkColors(theme: ThemeKey): { background: string; border: string } {
  const backgrounds = {
    light: '#fef08a',
    sepia: '#f5d78e',
    dark: '#854d0e',
    night: '#1e3a5f',
  }
  const borders = {
    light: '#eab308',
    sepia: '#ca8a04',
    dark: '#fbbf24',
    night: '#3b82f6',
  }
  return { background: backgrounds[theme], border: borders[theme] }
}

function wrapPlainTextRange(
  root: HTMLElement,
  start: number,
  end: number,
  createMark: (doc: Document) => HTMLElement,
): boolean {
  if (end <= start) return false
  const walker = root.ownerDocument.createTreeWalker(root, 4)
  const parts: { node: Text; start: number; end: number }[] = []
  let offset = 0
  let excludedOverlap = false
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const next = offset + node.length
    if (offset < end && next > start) {
      if (node.parentElement?.closest(MEDIA_EXEMPT)) excludedOverlap = true
      parts.push({
        node,
        start: Math.max(0, start - offset),
        end: Math.min(node.length, end - offset),
      })
    }
    offset = next
  }
  if (excludedOverlap || parts.length === 0) return false
  for (const part of parts) {
    const selected = part.node.splitText(part.start)
    selected.splitText(part.end - part.start)
    const mark = createMark(root.ownerDocument)
    selected.replaceWith(mark)
    mark.appendChild(selected)
  }
  return true
}

const COMMENT_HIGHLIGHT = 'phantasi-comment'

function cssHighlightMap(): {
  delete: (name: string) => void
  set: (name: string, highlight: { add: (range: Range) => void }) => void
} | null {
  if (!cssCustomHighlightAvailable()) return null
  return (CSS as unknown as { highlights: { delete: (name: string) => void; set: (name: string, highlight: { add: (range: Range) => void }) => void } }).highlights
}

function HighlightCtor(): (new () => { add: (range: Range) => void }) | undefined {
  return (globalThis as { Highlight?: new () => { add: (range: Range) => void } }).Highlight
}

/** Visual fill when the browser can paint ranges; marks stay for click / keyboard. */
export function syncCssCommentHighlights(root: HTMLElement): void {
  const highlights = cssHighlightMap()
  const Highlight = HighlightCtor()
  if (!highlights || !Highlight) return
  highlights.delete(COMMENT_HIGHLIGHT)
  const highlight = new Highlight()
  for (const mark of root.querySelectorAll('mark.user-comment-highlight')) {
    const range = root.ownerDocument.createRange()
    range.selectNodeContents(mark)
    highlight.add(range)
  }
  highlights.set(COMMENT_HIGHLIGHT, highlight)
}

export function paintAnchoredComments(
  root: HTMLElement,
  comments: CommentItem[],
  theme: ThemeKey,
): void {
  unwrapTextDecorations(root, 'mark.user-comment-highlight')
  if (!comments.length) {
    cssHighlightMap()?.delete(COMMENT_HIGHLIGHT)
    return
  }
  const text = root.textContent ?? ''
  const colors = commentMarkColors(theme)
  for (const comment of comments) {
    if (!Number.isFinite(Number(comment.id)) || comment.parent_id) continue
    const start = resolveCommentAnchor(text, comment)
    if (start === null) continue
    wrapPlainTextRange(root, start, start + comment.selected_text.length, (doc) => {
      const mark = doc.createElement('mark')
      mark.className = 'user-comment-highlight'
      mark.dataset.commentId = String(Number(comment.id))
      mark.tabIndex = 0
      mark.setAttribute('role', 'button')
      mark.setAttribute('aria-label', comment.comment || comment.selected_text)
      const color =
        comment.color &&
        /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(comment.color)
          ? comment.color
          : undefined
      mark.style.backgroundColor = color ?? colors.background
      mark.style.borderBottom = `2px solid ${color ?? colors.border}`
      mark.style.cursor = 'pointer'
      mark.style.borderRadius = '2px'
      return mark
    })
  }
  syncCssCommentHighlights(root)
}

export function paintAnchoredAnnotations(
  root: HTMLElement,
  annotations: AnnotationItem[],
): void {
  unwrapTextDecorations(root, 'mark.phantasiai-annotation')
  if (!annotations.length) return
  const text = root.textContent ?? ''
  const seen = new Set<string>()
  const ordered = annotations.toSorted((a, b) => b.term.length - a.term.length)
  for (const [index, annotation] of ordered.entries()) {
    const quote = annotation.term
    if (!quote || seen.has(`${annotation.type}:${quote}`)) continue
    const start = resolveCommentAnchor(text, {
      selected_text: quote,
      start_offset: annotation.position,
    })
    if (start === null) continue
    seen.add(`${annotation.type}:${quote}`)
    wrapPlainTextRange(root, start, start + quote.length, (doc) => {
      const mark = doc.createElement('mark')
      mark.className = 'phantasiai-annotation'
      const rawId = annotation.id || `${annotation.type}-${index}`
      mark.setAttribute(
        'data-annotation-id',
        String(rawId).replaceAll(/[^\w-]/g, ''),
      )
      mark.setAttribute('data-type', annotation.type)
      mark.setAttribute('data-term', encodeURIComponent(annotation.term))
      mark.setAttribute(
        'data-explanation',
        encodeURIComponent(annotation.explanation),
      )
      return mark
    })
  }
}

export function highlightAnchoredComments(
  html: string,
  comments: CommentItem[],
  theme: ThemeKey,
): string {
  if (!comments.length) return html
  const root = new DOMParser().parseFromString(html, 'text/html').body
  paintAnchoredComments(root, comments, theme)
  return root.innerHTML
}

export function highlightAnchoredAnnotations(
  html: string,
  annotations: AnnotationItem[],
): string {
  if (!annotations.length) return html
  const root = new DOMParser().parseFromString(html, 'text/html').body
  paintAnchoredAnnotations(root, annotations)
  return root.innerHTML
}
