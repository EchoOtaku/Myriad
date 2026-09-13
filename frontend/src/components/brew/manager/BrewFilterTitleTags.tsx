import type { StarredModeConfig, TopicFeedModeConfig } from './modes'

import {
  LuCheckSquare as CheckSquare,
  LuChevronLeft as ChevronLeft,
  LuEdit3 as Edit3,
  LuMinusSquare as MinusSquare,
  LuSquare as Square,
  LuStar as Star,
  LuX as X,
} from '@lib/icons'
import { useI18n } from '../../../contexts/I18nContext'
import { SettingTitleTag } from '../../settings/SettingTitleTag'
import { Spinner } from '../../Spinner'

const TAG = 'brew-feeds__title-tag'

export function BrewFilterTitleTags({
  starredMode,
  topicFeedMode,
}: {
  starredMode?: StarredModeConfig
  topicFeedMode?: TopicFeedModeConfig
}) {
  const { t, format } = useI18n()
  const brew = t.brew

  if (starredMode?.isEditMode) {
    const picked = starredMode.selectedIds.size
    const total = starredMode.total
    const allOn = picked === total && total > 0
    return (
      <>
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={
            allOn ? (
              <CheckSquare />
            ) : picked > 0 ? (
              <MinusSquare />
            ) : (
              <Square />
            )
          }
          title={allOn ? brew.deselectAll : brew.selectAll}
          onClick={starredMode.onSelectAll}
        >
          {allOn ? brew.deselectAll : brew.selectAll}
        </SettingTitleTag>
        <SettingTitleTag className={TAG} variant="muted">
          {picked}/{total}
        </SettingTitleTag>
        <SettingTitleTag
          className={TAG}
          variant="danger"
          icon={
            starredMode.isProcessing ? (
              <Spinner size="sm" color="current" />
            ) : (
              <Star />
            )
          }
          disabled={picked === 0 || starredMode.isProcessing}
          title={brew.unstar}
          onClick={starredMode.onBatchUnstar}
        >
          {brew.unstar}
        </SettingTitleTag>
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={<X />}
          title={brew.exitEdit}
          onClick={starredMode.onExitEditMode}
        >
          {brew.exitEdit}
        </SettingTitleTag>
      </>
    )
  }

  if (starredMode) {
    return (
      <>
        <SettingTitleTag className={TAG} variant="muted">
          {format(brew.starredCount, { count: starredMode.total })}
        </SettingTitleTag>
        {starredMode.total > 0 ? (
          <SettingTitleTag
            className={TAG}
            variant="muted"
            icon={<Edit3 />}
            title={brew.editMode}
            onClick={starredMode.onEnterEditMode}
          >
            {brew.edit}
          </SettingTitleTag>
        ) : null}
      </>
    )
  }

  if (topicFeedMode) {
    return (
      <>
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={<ChevronLeft />}
          title={brew.backToAllSources}
          onClick={topicFeedMode.onBack}
        >
          {brew.back}
        </SettingTitleTag>
        <SettingTitleTag className={TAG} variant="muted">
          {format(brew.totalArticles, { count: topicFeedMode.total })}
        </SettingTitleTag>
      </>
    )
  }

  return null
}
