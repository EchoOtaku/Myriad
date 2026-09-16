import type { NoteAiSelection } from './noteAiEdit'
import { visualHtmlToMarkdown } from './noteVisual'

/** Source selections are exact. Visual selections must round-trip to a unique source fragment. */
export function captureNoteAiSelection(source: string, pane: string, textarea: HTMLTextAreaElement | null, visual: HTMLElement | null): { selection: NoteAiSelection | null; unavailable: boolean } {
  if (pane === 'write' && textarea && textarea.selectionEnd > textarea.selectionStart) {
    return { selection: { start: textarea.selectionStart, end: textarea.selectionEnd }, unavailable: false }
  }
  if (pane === 'visual' && visual) {
    const selection = visual.ownerDocument.getSelection()
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0)
      if (visual.contains(range.commonAncestorContainer)) {
        const container = visual.ownerDocument.createElement('div')
        container.append(range.cloneContents())
        const markdown = visualHtmlToMarkdown(container.innerHTML).trim()
        const start = markdown ? source.indexOf(markdown) : -1
        if (start >= 0 && !source.includes(markdown, start + 1)) {
          return { selection: { start, end: start + markdown.length }, unavailable: false }
        }
        return { selection: null, unavailable: true }
      }
    }
  }
  return { selection: null, unavailable: false }
}
