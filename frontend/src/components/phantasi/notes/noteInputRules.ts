/** 可视层的输入规则：行首敲 Markdown 记号加空格 / 回车，就地变成对应的块。 */

type InputRule =
  | { kind: 'heading'; level: number }
  | { kind: 'bullet' }
  | { kind: 'ordered' }
  | { kind: 'task' }
  | { kind: 'quote' }
  | { kind: 'code'; lang: string }
  | { kind: 'divider' }

/** 空格触发。`text` 是块开头到光标的内容，不含刚敲的空格。 */
export function matchSpaceRule(text: string): InputRule | null {
  const heading = /^(#{1,6})$/.exec(text)
  if (heading) return { kind: 'heading', level: heading[1]!.length }
  if (text === '-' || text === '*') return { kind: 'bullet' }
  if (/^1\.$/.test(text)) return { kind: 'ordered' }
  if (/^(?:[-*] )?\[ ?\]$/.test(text)) return { kind: 'task' }
  if (text === '>') return { kind: 'quote' }
  return null
}

/** 回车触发。`text` 是整块的内容。 */
export function matchEnterRule(text: string): InputRule | null {
  const fence = /^```([\w+-]*)$/.exec(text.trim())
  if (fence) return { kind: 'code', lang: fence[1] ?? '' }
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(text.trim())) return { kind: 'divider' }
  return null
}
