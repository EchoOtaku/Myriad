import { isPageVisible, onVisibility } from '../../hooks/animation/core'

/** Wait for actual list geometry instead of a fixed delay or retry budget. */
export function trackActivePlaylistItem(scroller: HTMLElement): () => void {
  let frame: number | null = null
  let activeItem: HTMLElement | null = null
  let disposed = false
  let needsMeasure = true
  const resize = new ResizeObserver(schedule)
  function cancelFrame() {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }
  function measure() {
    frame = null
    if (disposed || !isPageVisible()) return
    needsMeasure = false
    const item = scroller.querySelector<HTMLElement>('.music-playlist-item.active')
    if (item !== activeItem) {
      if (activeItem) resize.unobserve(activeItem)
      activeItem = item
      if (item) resize.observe(item)
    }
    if (!item || scroller.clientHeight < 16) return
    const scrollerRect = scroller.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const top = itemRect.top - scrollerRect.top + scroller.scrollTop
    const target = Math.max(0, Math.min(
      top - scroller.clientHeight / 2 + (itemRect.height || 1) / 2,
      Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    ))
    if (Math.abs(scroller.scrollTop - target) > 0.5) {
      scroller.scrollTo({ top: target, behavior: 'auto' })
    }
  }
  function schedule() {
    if (disposed) return
    needsMeasure = true
    if (!isPageVisible() || frame !== null) return
    frame = requestAnimationFrame(measure)
  }
  resize.observe(scroller)
  const children = new MutationObserver(schedule)
  // Item contents (spectrum, title animation) must not reset manual scrolling.
  children.observe(scroller, { childList: true })
  const unsubscribe = onVisibility(visible => {
    if (!visible) cancelFrame()
    else if (needsMeasure) schedule()
  })
  window.addEventListener('control-panel-content-resize', schedule)
  schedule()
  return () => {
    disposed = true
    cancelFrame()
    resize.disconnect()
    children.disconnect()
    unsubscribe()
    window.removeEventListener('control-panel-content-resize', schedule)
  }
}
