import type { NoteAiSelection } from './noteAiEdit'
import { blocksWithOffsets, markdownToVisualHtml, visualHtmlToMarkdown } from './noteVisual'

/** Never search globally for rendered text: soft breaks and Markdown can make different source look identical. */
export function captureNoteAiSelection(source: string, pane: string, textarea: HTMLTextAreaElement | null, visual: HTMLElement | null): { selection: NoteAiSelection | null; unavailable: boolean } {
  if (pane === 'write' && textarea && textarea.selectionEnd > textarea.selectionStart) {
    return { selection: { start: textarea.selectionStart, end: textarea.selectionEnd }, unavailable: false }
  }
  if (pane === 'visual' && visual) {
    const selection = visual.ownerDocument.getSelection()
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0)
      if (visual.contains(range.commonAncestorContainer)) {
        const unavailable = { selection: null, unavailable: true }
        // Source offsets in the visual splitter normalize CRLF. Refuse instead of guessing.
        if (source.includes('\r')) return unavailable
        const blocks = blocksWithOffsets(source)
        const rendered = markdownToVisualHtml(source)
        if (blocks.length !== visual.children.length || visualHtmlToMarkdown(visual.innerHTML) !== visualHtmlToMarkdown(rendered)) return unavailable
        let block = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement
        while (block && block.parentElement !== visual) block = block.parentElement
        if (!block || !block.contains(range.endContainer)) return unavailable
        const index = Array.from(visual.children).indexOf(block)
        const original = blocks[index]
        // Plain paragraphs have a provable character-for-character mapping. Formatted,
        // nested, or multi-block selections use source mode until they have an exact map.
        if (!original || block.tagName !== 'P' || block.children.length || original.text !== block.textContent) return unavailable
        const before = range.cloneRange()
        before.selectNodeContents(block)
        before.setEnd(range.startContainer, range.startOffset)
        const start = original.start + before.toString().length
        return { selection: { start, end: start + range.toString().length }, unavailable: false }
      }
    }
  }
  return { selection: null, unavailable: false }
}
