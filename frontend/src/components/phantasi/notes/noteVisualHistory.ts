export const VISUAL_UNDO_LIMIT = 200
export const VISUAL_UNDO_BYTE_LIMIT = 8 * 1024 * 1024

/** UTF-16 payload budget shared by both directions of history. */
export function trimVisualHistory(history: { past: string[]; future: string[] }): void {
  let bytes = [...history.past, ...history.future].reduce((sum, text) => sum + text.length * 2, 0)
  while (history.past.length + history.future.length > VISUAL_UNDO_LIMIT || bytes > VISUAL_UNDO_BYTE_LIMIT) {
    const oldest = history.past.length ? history.past.shift() : history.future.shift()
    if (oldest === undefined) break
    bytes -= oldest.length * 2
  }
}
