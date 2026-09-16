import type { CSSProperties } from 'react'
import type { PhantasiItem } from '../../../types/phantasi'
import { useCallback, useMemo, useRef } from 'react'

import { useI18n } from '../../../contexts/I18nContext'
import { Spinner } from '../../Spinner'
import { PhantasiVacant } from '../ui/Empty'
import { clearPhantasiStoryPeeks, usePhantasiPeekLane } from '../ui/StoryCard'
import { PhantasiStory } from './PhantasiStory'
import { usePhantasiTimes } from './time'
import { useStoryWindow } from './useStoryWindow'
import type { FeedStory } from '../logic/feedStories'
import '../ui/phantasi.css'

interface PhantasiListViewProps {
  items: PhantasiItem[]
  selectedItem: PhantasiItem | null
  loading: boolean
  hasMore: boolean
  total: number
  onItemSelect: (item: PhantasiItem) => void
  onLoadMore: () => void
  editMode?: boolean
  selectedIds?: Set<number>
  onItemSelectToggle?: (id: number) => void
  onToggleStar?: (item: PhantasiItem) => void
  onPeekItem?: (item: PhantasiItem) => void
  onPeekEnd?: () => void
  emptyText?: string
}

export default function PhantasiListView({
  items,
  selectedItem,
  loading,
  hasMore,
  onItemSelect,
  onLoadMore,
  editMode,
  selectedIds,
  onItemSelectToggle,
  onToggleStar,
  onPeekItem,
  onPeekEnd,
  emptyText,
}: PhantasiListViewProps) {
  const { t, locale } = useI18n()
  const times = usePhantasiTimes()
  const labels = t.phantasi
  const viewRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const storyCols = Math.max(1, Math.ceil(items.length / 2))
  const itemKey = useMemo(
    () => items.map((item) => item.id).join(','),
    [items],
  )
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  )
  const peekLane = usePhantasiPeekLane({
    onPeek: (preview) => {
      const item = itemsById.get(preview.id)
      if (item) onPeekItem?.(item)
    },
    onPeekEnd,
    blocked: () => !!editMode || !onPeekItem,
  })
  const window = useStoryWindow(items.length, itemKey, viewRef, trackRef, () => {
    clearPhantasiStoryPeeks(trackRef.current)
    onPeekEnd?.()
  }, items[0]?.id)
  const open = useCallback((story: FeedStory) => {
    const item = itemsById.get(story.id)
    if (!item) return
    if (editMode) onItemSelectToggle?.(item.id)
    else onItemSelect(item)
  }, [editMode, itemsById, onItemSelect, onItemSelectToggle])
  const star = useCallback((story: FeedStory) => {
    const item = itemsById.get(story.id)
    if (item) onToggleStar?.({ ...item, is_starred: !!story.is_starred })
  }, [itemsById, onToggleStar])

  const lastItemRef = useCallback(
    (node: HTMLButtonElement | null) => {
      if (!node || loading || !hasMore) return
      let active = true
      const observer = new IntersectionObserver(
        (entries) => {
          if (!active || !entries.some(entry => entry.isIntersecting)) return
          active = false
          observer.disconnect()
          onLoadMore()
        },
        { rootMargin: '100px' },
      )
      observer.observe(node)
      return () => {
        active = false
        observer.disconnect()
      }
    },
    [loading, hasMore, onLoadMore],
  )

  if (items.length === 0 && !loading) {
    return <PhantasiVacant title={emptyText || t.phantasi.noArticles} />
  }

  return (
    <div
      className="phantasi-skin phantasi-stories"
      ref={viewRef}
      data-phantasi-peek-lane
      {...peekLane}
      onFocusCapture={window.onFocusCapture}
      onBlurCapture={window.onBlurCapture}
    >
      <div
        className="phantasi-stories-track"
        ref={trackRef}
        data-phantasi-rail-track="items"
        style={{ '--phantasi-story-cols': storyCols } as CSSProperties}
      >
        {window.indices.map((index) => {
          const item = items[index]!
          const last = index === items.length - 1
          const column = Math.floor(index / 2) + 1
          return (
            <PhantasiStory
              key={item.id}
              ref={last ? lastItemRef : undefined}
              item={item}
              times={times}
              locale={locale}
              labels={labels}
              current={selectedItem?.id === item.id}
              arrive={index < 8 ? index : undefined}
              railCol={column}
              place={{
                column,
                row: (index % 2 === 0 ? 1 : 2) as 1 | 2,
              }}
              picking={!!editMode}
              picked={!!selectedIds?.has(item.id)}
              onOpen={open}
              onToggleStar={editMode || !onToggleStar ? undefined : star}
            />
          )
        })}
      </div>
      {loading ? (
        <div className="phantasi-stories__more">
          <Spinner size="md" />
        </div>
      ) : null}
    </div>
  )
}
