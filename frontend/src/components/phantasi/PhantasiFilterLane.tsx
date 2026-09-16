/** 订阅轨不走这里。 */

import type { PhantasiItem } from '../../types/phantasi'
import type {
  StarredModeConfig,
  TopicFeedModeConfig,
} from './manager/modes'

import { useId } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { PhantasiFilterTitleTags } from './manager/PhantasiFilterTitleTags'
import PhantasiListView from './skin/PhantasiList'
import { PhantasiPageStage } from './ui/PhantasiPageStage'
import { PhantasiRailTitle } from './ui/PhantasiRailTitle'

interface PhantasiFilterLaneProps {
  topicFeedMode?: TopicFeedModeConfig
  starredMode?: StarredModeConfig
  items: PhantasiItem[]
  selectedItem: PhantasiItem | null
  loading: boolean
  hasMore: boolean
  total: number
  onItemSelect: (item: PhantasiItem) => void
  onLoadMore: () => void
  onToggleStar: (item: PhantasiItem) => void
  onItemSelectToggle?: (id: number) => void
  onPeekItem?: (item: PhantasiItem) => void
  onPeekEnd?: () => void
  searchMiss?: boolean
}

export default function PhantasiFilterLane({
  topicFeedMode,
  starredMode,
  items,
  selectedItem,
  loading,
  hasMore,
  total,
  onItemSelect,
  onLoadMore,
  onToggleStar,
  onItemSelectToggle,
  onPeekItem,
  onPeekEnd,
  searchMiss = false,
}: PhantasiFilterLaneProps) {
  const { t } = useI18n()
  const titleId = useId()
  const title = starredMode
    ? t.phantasi.starred
    : (topicFeedMode?.topicLabel ?? '')

  return (
    <PhantasiPageStage
      title={
        <PhantasiRailTitle
          id={titleId}
          action={
            <PhantasiFilterTitleTags
              starredMode={starredMode}
              topicFeedMode={topicFeedMode}
            />
          }
          pinned={!!starredMode?.isEditMode}
        >
          {title}
        </PhantasiRailTitle>
      }
    >
      <PhantasiListView
        items={items}
        selectedItem={selectedItem}
        loading={loading}
        hasMore={hasMore}
        total={total}
        onItemSelect={onItemSelect}
        onLoadMore={onLoadMore}
        onToggleStar={onToggleStar}
        onPeekItem={starredMode?.isEditMode ? undefined : onPeekItem}
        onPeekEnd={starredMode?.isEditMode ? undefined : onPeekEnd}
        emptyText={
          searchMiss
            ? t.phantasi.noMatchingSources
            : starredMode
              ? t.phantasi.starredEmpty
              : undefined
        }
        editMode={starredMode?.isEditMode}
        selectedIds={starredMode?.selectedIds}
        onItemSelectToggle={onItemSelectToggle}
      />
    </PhantasiPageStage>
  )
}
