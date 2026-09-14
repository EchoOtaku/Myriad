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

const TAG = 'phantasi-feeds__title-tag'

export function PhantasiFilterTitleTags({
  starredMode,
  topicFeedMode,
}: {
  starredMode?: StarredModeConfig
  topicFeedMode?: TopicFeedModeConfig
}) {
  const { t, format } = useI18n()
  const phantasi = t.phantasi

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
          title={allOn ? phantasi.deselectAll : phantasi.selectAll}
          onClick={starredMode.onSelectAll}
        >
          {allOn ? phantasi.deselectAll : phantasi.selectAll}
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
          title={phantasi.unstar}
          onClick={starredMode.onBatchUnstar}
        >
          {phantasi.unstar}
        </SettingTitleTag>
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={<X />}
          title={phantasi.exitEdit}
          onClick={starredMode.onExitEditMode}
        >
          {phantasi.exitEdit}
        </SettingTitleTag>
      </>
    )
  }

  if (starredMode) {
    return (
      <>
        <SettingTitleTag className={TAG} variant="muted">
          {format(phantasi.starredCount, { count: starredMode.total })}
        </SettingTitleTag>
        {starredMode.total > 0 ? (
          <SettingTitleTag
            className={TAG}
            variant="muted"
            icon={<Edit3 />}
            title={phantasi.editMode}
            onClick={starredMode.onEnterEditMode}
          >
            {phantasi.edit}
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
          title={phantasi.backToAllSources}
          onClick={topicFeedMode.onBack}
        >
          {phantasi.back}
        </SettingTitleTag>
        <SettingTitleTag className={TAG} variant="muted">
          {format(phantasi.totalArticles, { count: topicFeedMode.total })}
        </SettingTitleTag>
      </>
    )
  }

  return null
}
