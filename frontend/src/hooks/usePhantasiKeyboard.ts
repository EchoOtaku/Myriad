import type { PhantasiItem } from '../types/phantasi'

import { useCallback, useEffect, useRef } from 'react'

interface UsePhantasiKeyboardOptions {
  items: PhantasiItem[]
  selectedItem: PhantasiItem | null
  enabled?: boolean
  onSelectItem: (item: PhantasiItem | null) => void
  onToggleRead?: (item: PhantasiItem) => void
  onToggleStar?: (item: PhantasiItem) => void
  onMarkAllRead?: () => void
  onCloseReader?: () => void
  onShowHelp?: () => void
  searchInputRef?: React.RefObject<HTMLInputElement | null>
}

export type ShortcutDescKey =
  | 'shortcutDescNextArticle'
  | 'shortcutDescPrevArticle'
  | 'shortcutDescOpenReader'
  | 'shortcutDescCloseReader'
  | 'shortcutDescFocusSearch'
  | 'shortcutDescToggleRead'
  | 'shortcutDescToggleStar'
  | 'shortcutDescMarkAllRead'
  | 'shortcutDescShowHelp'

interface KeyboardShortcut {
  key: string
  descriptionKey: ShortcutDescKey
  category: 'navigation' | 'article' | 'other'
}

export const PHANTASI_SHORTCUTS: KeyboardShortcut[] = [
  {
    key: 'j / ↓',
    descriptionKey: 'shortcutDescNextArticle',
    category: 'navigation',
  },
  {
    key: 'k / ↑',
    descriptionKey: 'shortcutDescPrevArticle',
    category: 'navigation',
  },
  {
    key: 'o / Enter',
    descriptionKey: 'shortcutDescOpenReader',
    category: 'navigation',
  },
  {
    key: 'Escape',
    descriptionKey: 'shortcutDescCloseReader',
    category: 'navigation',
  },
  {
    key: '/',
    descriptionKey: 'shortcutDescFocusSearch',
    category: 'navigation',
  },

  { key: 'm', descriptionKey: 'shortcutDescToggleRead', category: 'article' },
  { key: 's', descriptionKey: 'shortcutDescToggleStar', category: 'article' },
  {
    key: 'Shift + A',
    descriptionKey: 'shortcutDescMarkAllRead',
    category: 'article',
  },

  { key: '?', descriptionKey: 'shortcutDescShowHelp', category: 'other' },
]

export function usePhantasiKeyboard({
  items,
  selectedItem,
  enabled = true,
  onSelectItem,
  onToggleRead,
  onToggleStar,
  onMarkAllRead,
  onCloseReader,
  onShowHelp,
  searchInputRef,
}: UsePhantasiKeyboardOptions) {
  const lastKeyTime = useRef<number>(0)

  const getCurrentIndex = useCallback(() => {
    if (!selectedItem) return -1
    return items.findIndex((item) => item.id === selectedItem.id)
  }, [items, selectedItem])

  const selectPrevious = useCallback(() => {
    const currentIndex = getCurrentIndex()
    if (currentIndex > 0) {
      onSelectItem(items[currentIndex - 1])
    } else if (currentIndex === -1 && items.length > 0) {
      onSelectItem(items[0])
    }
  }, [getCurrentIndex, items, onSelectItem])

  const selectNext = useCallback(() => {
    const currentIndex = getCurrentIndex()
    if (currentIndex < items.length - 1) {
      onSelectItem(items[currentIndex + 1])
    } else if (currentIndex === -1 && items.length > 0) {
      onSelectItem(items[0])
    }
  }, [getCurrentIndex, items, onSelectItem])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || e.defaultPrevented) return
      // 修饰键属于浏览器 / 系统快捷键；Shift+A 仍保留给批量已读。
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const modalOpen = Iterator.from(
        document.querySelectorAll<HTMLElement>('[data-phantasi-shortcuts="suspended"]'),
      ).some(element => element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility === 'visible')
      if (modalOpen) return

      const target = e.target
      const isInputFocused = target instanceof HTMLElement && (
        !!target.closest('input, textarea, select') || target.isContentEditable
      )

      if (e.key === 'Escape') {
        // 阅读器自行按覆层顺序关闭，页面快捷键不能越层。
        if (selectedItem) return
        e.preventDefault()
        onCloseReader?.()

        if (document.activeElement === searchInputRef?.current) {
          searchInputRef.current?.blur()
        }
        return
      }

      if (isInputFocused) return
      if (e.key === 'Enter' && target instanceof HTMLElement &&
        target.closest('button, a[href], [role="button"], summary')) { return
}

      const now = Date.now()
      if (now - lastKeyTime.current < 50) return
      lastKeyTime.current = now

      switch (e.key.toLowerCase()) {
        case 'j':
        case 'arrowdown':
          e.preventDefault()
          selectNext()
          break

        case 'k':
        case 'arrowup':
          e.preventDefault()
          selectPrevious()
          break

        case 'o':
        case 'enter':
          e.preventDefault()
          if (!selectedItem && items.length > 0) {
            onSelectItem(items[0])
          }
          break

        case 'm':
          if (selectedItem) {
            e.preventDefault()
            onToggleRead?.(selectedItem)
          }
          break

        case 's':
          if (selectedItem) {
            e.preventDefault()
            onToggleStar?.(selectedItem)
          }
          break

        case 'a':
          if (e.shiftKey) {
            e.preventDefault()
            onMarkAllRead?.()
          }
          break

        case '/':
          e.preventDefault()
          searchInputRef?.current?.focus()
          break

        case '?':
          e.preventDefault()
          onShowHelp?.()
          break
      }
    },
    [
      enabled,
      selectedItem,
      items,
      selectNext,
      selectPrevious,
      onSelectItem,
      onToggleRead,
      onToggleStar,
      onMarkAllRead,
      onCloseReader,
      onShowHelp,
      searchInputRef,
    ],
  )

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled, handleKeyDown])
}
