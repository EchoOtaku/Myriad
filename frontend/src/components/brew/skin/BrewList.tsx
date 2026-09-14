import type { CSSProperties } from 'react'
import type { BrewItem } from '../../../types/brew'
import { useCallback, useMemo, useRef } from 'react'

import { useI18n } from '../../../contexts/I18nContext'
import { Spinner } from '../../Spinner'
import { BrewVacant } from '../ui/Empty'
import { BrewStory } from './BrewStory'
import { useBrewTimes } from './time'
import { useBrewRailPan } from './useBrewRailPan'
import '../ui/brew.css'

interface BrewListViewProps {
  items: BrewItem[]
  selectedItem: BrewItem | null
  loading: boolean
  hasMore: boolean
  total: number
  onItemSelect: (item: BrewItem) => void
  onLoadMore: () => void
  editMode?: boolean
  selectedIds?: Set<number>
  onItemSelectToggle?: (id: number) => void
  onToggleStar?: (item: BrewItem) => void
  onPeekItem?: (item: BrewItem) => void
  onPeekEnd?: () => void
  emptyText?: string
}

export default function BrewListView({
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
}: BrewListViewProps) {
  const { t, locale } = useI18n()
  const times = useBrewTimes()
  const labels = t.brew
  const viewRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const storyCols = Math.max(1, Math.ceil(items.length / 2))
  const itemKey = useMemo(
    () => items.map((item) => item.id).join(','),
    [items],
  )
  useBrewRailPan(
    viewRef,
    trackRef,
    items.length > 0,
    itemKey,
    '.brew-story',
    undefined,
    undefined,
    true,
  )

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
    return <BrewVacant title={emptyText || t.brew.noArticles} />
  }

  return (
    <div className="brew-skin brew-stories" ref={viewRef} data-brew-peek-lane>
      <div
        className="brew-stories-track"
        ref={trackRef}
        data-brew-rail-track="items"
        style={{ '--brew-story-cols': storyCols } as CSSProperties}
      >
        {items.map((item, index) => {
          const last = index === items.length - 1
          const column = Math.floor(index / 2) + 1
          return (
            <BrewStory
              key={item.id}
              ref={last ? lastItemRef : undefined}
              item={{
                id: item.id,
                title: item.title,
                summary: item.summary,
                image: item.image,
                published_at: item.published_at,
                is_read: item.is_read,
                is_starred: item.is_starred,
                topic: item.topic,
                author: item.author,
                source_name: item.source_name,
                source_icon: item.source_icon,
                guid: item.guid,
              }}
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
              onOpen={() => {
                if (editMode) onItemSelectToggle?.(item.id)
                else onItemSelect(item)
              }}
              onPeek={
                editMode || !onPeekItem
                  ? undefined
                  : (story) => onPeekItem({ ...item, ...story })
              }
              onPeekEnd={editMode ? undefined : onPeekEnd}
              onToggleStar={
                editMode || !onToggleStar
                  ? undefined
                  : (story) => {
                      onToggleStar({
                        ...item,
                        is_starred: !!story.is_starred,
                      })
                    }
              }
            />
          )
        })}
      </div>
      {loading ? (
        <div className="brew-stories__more">
          <Spinner size="md" />
        </div>
      ) : null}
    </div>
  )
}
