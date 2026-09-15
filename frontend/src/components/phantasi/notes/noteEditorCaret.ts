/** 点击坐标 → 文本节点位置。Chrome / Firefox 是 caretPositionFromPoint，WebKit 是 caretRangeFromPoint。 */
export function caretFromPoint(
  doc: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  const modern = (
    doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null
    }
  ).caretPositionFromPoint
  if (modern) {
    const position = modern.call(doc, x, y)
    return position ? { node: position.offsetNode, offset: position.offset } : null
  }
  const legacy = (
    doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
  ).caretRangeFromPoint
  const range = legacy?.call(doc, x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

/**
 * 纸面滚动必须瞬间。html 继承了 scroll-behavior:smooth，直接改 scrollTop
 * 也会滑进卡槽；先钉成 auto 再赋。
 */
export function setScrollTop(container: HTMLElement, top: number): void {
  const prev = container.style.scrollBehavior
  container.style.scrollBehavior = 'auto'
  container.scrollTop = top
  container.style.scrollBehavior = prev
}

/** 目标已经在视口里就不动；出了视口才瞬间挪到刚好露出来的最近一边。 */
export function revealInContainer(
  container: HTMLElement,
  rect: DOMRect,
  margin = 48,
): void {
  const box = container.getBoundingClientRect()
  let delta = 0
  if (rect.top < box.top + margin) delta = rect.top - (box.top + margin)
  else if (rect.bottom > box.bottom - margin)
    delta = rect.bottom - (box.bottom - margin)
  if (Math.abs(delta) < 1) return
  setScrollTop(container, container.scrollTop + delta)
}

export const NOTE_URL_LIKE = /^https?:\/\/\S+$/i
