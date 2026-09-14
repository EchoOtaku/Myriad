import type { BrewItem } from '../../../types/brew'
import { useCallback } from 'react'

import { useI18n } from '../../../contexts/I18nContext'
import { Spinner } from '../../Spinner'
import { BrewVacant } from '../ui/Empty'
import { StoryGrid } from '../ui/StoryCard'
import { BrewStory } from './BrewStory'
import { useBrewTimes } from './time'
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
  emptyText,
}: BrewListViewProps) {
  const { t, locale } = useI18n()
  const times = useBrewTimes()
  const labels = t.brew

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
    <StoryGrid>
      {items.map((item, index) => {
        const last = index === items.length - 1
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
            picking={!!editMode}
            picked={!!selectedIds?.has(item.id)}
            onOpen={() => {
              if (editMode) onItemSelectToggle?.(item.id)
              else onItemSelect(item)
            }}
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
      {loading ? (
        <div className="brew-stories__more">
          <Spinner size="md" />
        </div>
      ) : null}
    </StoryGrid>
  )
}
