const FENCE = /```[\s\S]*?```/g
const INLINE_CODE = /`[^`]+`/g
const IMAGE = /!\[[^\]]*\]\([^)]+\)/g
const LINK = /\[[^\]]*\]\([^)]+\)/g
const URL = /\bhttps?:\/\/\S+/gi
const WWW = /\bwww\.\S+/gi
const HEADING = /^#{1,6}\s+/gm
const LIST = /^\s*(?:[-*+]|\d+\.)\s+/gm
const EMPHASIS = /[*_~]{1,3}/g
const HTML = /<\/?[a-z][^>]*>/gi
const TABLE_ROW = /^\s*\|.*\|\s*$/gm

export function speakableText(raw: string): string {
  let text = raw.replaceAll('\r\n', '\n')
  text = text.replaceAll(FENCE, ' ')
  text = text.replaceAll(INLINE_CODE, ' ')
  text = text.replaceAll(IMAGE, ' ')
  text = text.replaceAll(LINK, ' ')
  text = text.replaceAll(URL, ' ')
  text = text.replaceAll(WWW, ' ')
  text = text.replaceAll(HEADING, '')
  text = text.replaceAll(LIST, '')
  text = text.replaceAll(TABLE_ROW, ' ')
  text = text.replaceAll(HTML, ' ')
  text = text.replaceAll(EMPHASIS, '')
  text = text.replaceAll(/[^\S\n]+/g, ' ')
  text = text.replaceAll(/ *\n */g, '\n')
  return text.replaceAll(/\n{2,}/g, '\n').trim()
}
