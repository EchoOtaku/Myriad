import { useEffect, useRef } from 'react'
import { nextReaderDialogTab } from './readerPanels'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function readerDialogFocusables(root: ParentNode): HTMLElement[] {
  return Iterator.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible',
    )
    .toArray()
}

/** Move focus to close on open, wrap Tab, restore the opener on close. */
export function useReaderDialogFocus(open: boolean, dialogId: string) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const root = document.getElementById(dialogId)
    if (!root) return
    const visible = (element: HTMLElement) => element.isConnected &&
      element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible'
    let wasVisible = false
    const restore = () => {
      if (previous instanceof HTMLElement && visible(previous) &&
        !previous.closest('[inert], [hidden], [aria-hidden="true"]') &&
        (root.contains(document.activeElement) || document.activeElement === document.body)) {
        previous.focus({ preventScroll: true })
      }
    }
    const syncVisibility = () => {
      const shown = visible(root)
      if (shown === wasVisible) return
      wasVisible = shown
      if (!shown) {
        restore()
        return
      }
      const candidates = readerDialogFocusables(root)
      const close = closeRef.current
      const initial = close && candidates.includes(close)
        ? close
        : candidates.find(element => element.hasAttribute('data-reader-dialog-close')) ?? candidates[0]
      initial?.focus({ preventScroll: true })
    }
    syncVisibility()
    // 桌面隐藏的移动面板仍保持挂载；断点改变后才接管焦点。
    const observer = new ResizeObserver(syncVisibility)
    observer.observe(root)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const root = document.getElementById(dialogId)
      if (!root || root.getClientRects().length === 0 || getComputedStyle(root).visibility !== 'visible') return
      const next = nextReaderDialogTab(
        readerDialogFocusables(root),
        document.activeElement,
        event.shiftKey,
      )
      if (!next) return
      event.preventDefault()
      next.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      observer.disconnect()
      // 切换到其他覆层后，旧面板收尾不能抢走新面板的焦点。
      restore()
    }
  }, [open, dialogId])
  return closeRef
}
