import type { ReactNode } from 'react'
import type { SettingGuideEntry } from './types'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { SettingGuideBody } from '../../settings/guides/SettingGuideBody'
import { getBrewGuidesCatalog, loadBrewGuidesCatalog } from './catalog'

export interface BrewGuideBinding {
  guide: ReactNode
  guidePath: string
}

export function useBrewGuides() {
  const { t, locale } = useI18n()
  const [catalog, setCatalog] = useState(() => getBrewGuidesCatalog(locale))

  useEffect(() => {
    let cancelled = false
    setCatalog(getBrewGuidesCatalog(locale))
    void loadBrewGuidesCatalog(locale).then((next) => {
      if (!cancelled) setCatalog(next)
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  const labels = useMemo(
    () => ({
      what: t.config.guideSectionWhat,
      chain: t.config.guideSectionChain,
      frontend: t.config.guideSectionFrontend,
      notes: t.config.guideSectionNotes,
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

  const bindGuide = useCallback(
    (
      path: string,
      entry: SettingGuideEntry | undefined | null,
    ): BrewGuideBinding => ({
      guidePath: path,
      guide: renderGuide(entry),
    }),
    [renderGuide],
  )

  return { catalog, labels, renderGuide, bindGuide }
}
