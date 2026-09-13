/** 发布 HTML 里的正文小组件占位。水合逻辑在 noteWidgetMount。 */

export const NOTE_WIDGET_FACE = 'note-widget__face'

const NOTE_WIDGET_MARK = /<div\b[^>]*(?:\bnote-widget\b|data-widget=)/i
const NOTE_WIDGET_CLASS = /(?:^|\s)note-widget(?:\s|$)/
const NOT_PROSE_CLASS = /(?:^|\s)not-prose(?:\s|$)/

export function hasNoteWidgetMarkup(html: string | null | undefined): boolean {
  return html != null && NOTE_WIDGET_MARK.test(html)
}

/**
 * 已发布的占位往往只有 `note-widget`。阅读器 prose 靠 `not-prose` 才不改里面的图和字号。
 * 新稿后端会带上；旧稿在读路径补，不必再发一遍。
 */
export function stampNoteWidgetNotProse(html: string): string {
  return html.replaceAll(
    /<div\b([^>]*?)\bclass="([^"]*)"/g,
    (full, before: string, classes: string) => {
      if (!NOTE_WIDGET_CLASS.test(classes) || NOT_PROSE_CLASS.test(classes)) {
        return full
      }
      return `<div${before}class="${classes} not-prose"`
    },
  )
}
