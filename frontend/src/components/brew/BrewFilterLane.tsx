/** 订阅轨不走这里。 */

import type { BrewItem } from '../../types/brew'
import type {
  StarredModeConfig,
  TopicFeedModeConfig,
} from './manager/modes'

import { useId } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { BrewFilterTitleTags } from './manager/BrewFilterTitleTags'
import BrewListView from './skin/BrewList'
import { BrewPageStage } from './ui/BrewPageStage'
import { BrewRailTitle } from './ui/BrewRailTitle'

interface BrewFilterLaneProps {
  topicFeedMode?: TopicFeedModeConfig
  starredMode?: StarredModeConfig
  items: BrewItem[]
  selectedItem: BrewItem | null
  loading: boolean
  hasMore: boolean
  total: number
  onItemSelect: (item: BrewItem) => void
  onLoadMore: () => void
  onToggleStar: (item: BrewItem) => void
  onItemSelectToggle?: (id: number) => void
}

export default function BrewFilterLane({
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
}: BrewFilterLaneProps) {
  const { t } = useI18n()
  const titleId = useId()
  const title = starredMode
    ? t.brew.starred
    : (topicFeedMode?.topicLabel ?? '')

  return (
    <BrewPageStage
      title={
        <BrewRailTitle
          id={titleId}
          action={
            <BrewFilterTitleTags
              starredMode={starredMode}
              topicFeedMode={topicFeedMode}
            />
          }
        >
          {title}
        </BrewRailTitle>
      }
    >
      <BrewListView
        items={items}
        selectedItem={selectedItem}
        loading={loading}
        hasMore={hasMore}
        total={total}
        onItemSelect={onItemSelect}
        onLoadMore={onLoadMore}
        onToggleStar={onToggleStar}
        emptyText={starredMode ? t.brew.starredEmpty : undefined}
        editMode={starredMode?.isEditMode}
        selectedIds={starredMode?.selectedIds}
        onItemSelectToggle={onItemSelectToggle}
      />
    </BrewPageStage>
  )
}
