/** 选区几何：浮动工具条跟着选中的字走，行槛「+」跟着空行的光标走。 */

export interface SelectionAnchor {
  /** 相对滚动容器内容区的坐标。 */
  top: number
  left: number
  width: number
  height: number
}

interface BubblePlacement {
  top: number
  left: number
}

/**
 * 浮动条居中压在选区上方；左右夹在容器里，顶上没空间就翻到下面。
 * 触屏（`preferBelow`）直接放下面：系统自带的选区菜单占着上面。
 */
export function placeBubble(
  anchor: Pick<SelectionAnchor, 'top' | 'left' | 'width' | 'height'>,
  bubble: { width: number; height: number },
  container: { width: number; scrollTop: number },
  gap = 8,
  margin = 8,
  preferBelow = false,
): BubblePlacement {
  const half = bubble.width / 2
  const center = anchor.left + anchor.width / 2
  const minLeft = margin + half
  const maxLeft = Math.max(minLeft, container.width - margin - half)
  const left = Math.min(maxLeft, Math.max(minLeft, center))
  const above = anchor.top - gap - bubble.height
  const below = anchor.top + anchor.height + gap
  const top = !preferBelow && above >= container.scrollTop + margin ? above : below
  return { top, left }
}

/** 行槛「+」放在光标那一行的左边；左边不够宽就贴着光标放。 */
export function placeGutter(
  caret: Pick<SelectionAnchor, 'top' | 'left' | 'height'>,
  size: number,
  gap = 10,
): BubblePlacement {
  const top = caret.top + (caret.height - size) / 2
  const left =
    caret.left >= size + gap + 4 ? caret.left - size - gap : caret.left + 4
  return { top, left }
}

/** 光标所在行是不是空行（只有空白也算）。 */
export function lineIsBlank(text: string, position: number): boolean {
  const pos = Math.max(0, Math.min(position, text.length))
  const start = text.lastIndexOf('\n', pos - 1) + 1
  const endIndex = text.indexOf('\n', pos)
  const end = endIndex < 0 ? text.length : endIndex
  return text.slice(start, end).trim() === ''
}

export function anchorInContainer(
  rect: DOMRect,
  container: HTMLElement,
): SelectionAnchor {
  const box = container.getBoundingClientRect()
  return {
    top: rect.top - box.top + container.scrollTop,
    left: rect.left - box.left + container.scrollLeft,
    width: rect.width,
    height: rect.height,
  }
}

const MIRROR_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'textIndent',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
  'tabSize',
] as const

/** textarea 没有 Range API，用镜像层量 [start, end) 的第一行位置。 */
function measureTextarea(
  el: HTMLTextAreaElement,
  start: number,
  end: number,
): DOMRect | null {
  const doc = el.ownerDocument
  const view = doc.defaultView
  if (!view) return null
  const computed = view.getComputedStyle(el)
  const mirror = doc.createElement('div')
  for (const prop of MIRROR_PROPS) {
    mirror.style[prop] = computed[prop]
  }
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '-99999px'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.width = `${el.offsetWidth}px`
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.overflow = 'hidden'

  const marker = doc.createElement('span')
  marker.textContent = el.value.slice(start, end) || '\u200B'
  mirror.append(
    doc.createTextNode(el.value.slice(0, start)),
    marker,
    doc.createTextNode(el.value.slice(end) || '\u200B'),
  )
  doc.body.appendChild(mirror)
  try {
    const mirrorBox = mirror.getBoundingClientRect()
    const first = marker.getClientRects()[0] ?? marker.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    return new DOMRect(
      box.left + (first.left - mirrorBox.left) - el.scrollLeft,
      box.top + (first.top - mirrorBox.top) - el.scrollTop,
      start === end ? 0 : first.width,
      first.height,
    )
  } finally {
    mirror.remove()
  }
}

export function textareaSelectionRect(el: HTMLTextAreaElement): DOMRect | null {
  if (el.selectionStart === el.selectionEnd) return null
  return measureTextarea(el, el.selectionStart, el.selectionEnd)
}

/** 光标收拢且停在空行时，那一行的位置。 */
export function textareaEmptyLineRect(el: HTMLTextAreaElement): DOMRect | null {
  if (el.selectionStart !== el.selectionEnd) return null
  if (!lineIsBlank(el.value, el.selectionStart)) return null
  return measureTextarea(el, el.selectionStart, el.selectionStart)
}

export function visualSelectionRect(root: HTMLElement): DOMRect | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  if (!rect.width && !rect.height) return null
  return rect
}

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'TD',
  'TH',
])

function blockOf(node: Node, root: HTMLElement): HTMLElement {
  let el: HTMLElement | null =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
  while (el && el !== root && !BLOCK_TAGS.has(el.tagName)) {
    el = el.parentElement
  }
  return el ?? root
}

function blockIsBlank(block: HTMLElement): boolean {
  if (block.textContent?.trim()) return false
  return !block.querySelector('img, table, hr, pre, code')
}

export type VisualBlockKind = 'table' | 'pre'

/** 可视层：光标落在表格或代码块里，返回那个块的位置，给块工具条定位。 */
export function visualBlockRect(
  root: HTMLElement,
): { kind: VisualBlockKind; rect: DOMRect } | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const start = selection.getRangeAt(0).startContainer
  if (!root.contains(start)) return null
  const el =
    start.nodeType === Node.TEXT_NODE ? start.parentElement : (start as HTMLElement)
  const found = el?.closest('table, pre')
  if (!found || found === root || !root.contains(found)) return null
  return {
    kind: found.tagName === 'TABLE' ? 'table' : 'pre',
    rect: found.getBoundingClientRect(),
  }
}

/** 可视层：光标收拢且所在块是空的，返回那一行的位置。 */
export function visualEmptyLineRect(root: HTMLElement): DOMRect | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const block = blockOf(range.startContainer, root)
  if (!blockIsBlank(block)) return null
  const view = root.ownerDocument.defaultView
  const lineHeight = view
    ? Number.parseFloat(view.getComputedStyle(block).lineHeight) || 24
    : 24
  const rect = block.getBoundingClientRect()
  if (block === root) {
    const pad = view
      ? Number.parseFloat(view.getComputedStyle(root).paddingTop) || 0
      : 0
    return new DOMRect(rect.left, rect.top + pad, 0, lineHeight)
  }
  return new DOMRect(rect.left, rect.top, 0, rect.height || lineHeight)
}
