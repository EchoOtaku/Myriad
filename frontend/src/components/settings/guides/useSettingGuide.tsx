/**
 * 组装结构化指南 ReactNode，供 SettingGroup / Item 的 guide= 使用
 */

import type { ReactNode } from 'react'
import type { SettingGuideEntry } from './types'
import React, { useCallback, useMemo } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { getSettingGuidesCatalog } from './catalog'
import { SettingGuideBody } from './SettingGuideBody'

export function useSettingGuide() {
  const { t, locale } = useI18n()

  const catalog = useMemo(() => getSettingGuidesCatalog(locale), [locale])

  const labels = useMemo(
    () => ({
      what: t.config.guideSectionWhat ?? '是什么',
      chain: t.config.guideSectionChain ?? '会牵连什么',
      frontend: t.config.guideSectionFrontend ?? '哪里能看见',
      notes: t.config.guideSectionNotes ?? '要注意',
    }),
    [t],
  )

  const renderGuide = useCallback(
    (entry: SettingGuideEntry | undefined | null): ReactNode => {
      if (
        !entry?.what &&
        !entry?.chain &&
        !entry?.frontend &&
        !entry?.notes
      ) {
        return null
      }
      return <SettingGuideBody entry={entry!} labels={labels} />
    },
    [labels],
  )

  return { catalog, labels, renderGuide }
}
