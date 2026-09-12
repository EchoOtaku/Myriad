import type { SettingDefaultChangeNotice } from './SettingsDefaultsContext'
import { LuSparkles } from '@lib/icons'
import React, { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { useSettingsDefaults } from './SettingsDefaultsContext'
import { SettingTitleTag } from './SettingTitleTag'

export interface SettingDefaultChangeTagProps {
  fieldKey?: string
  /** click applies the new default; omit for display-only */
  onApply?: (newDefault: string) => void
  className?: string
}

export function SettingDefaultChangeTag({
  fieldKey,
  onApply,
  className = '',
}: SettingDefaultChangeTagProps) {
  const { t, format } = useI18n()
  const source = useSettingsDefaults()
  const [notice, setNotice] = useState<SettingDefaultChangeNotice | null>(
    () => source?.getNotice(fieldKey) ?? null,
  )

  useEffect(() => {
    const sync = () => setNotice(source?.getNotice(fieldKey) ?? null)
    sync()
    return source?.subscribe(sync)
  }, [fieldKey, source])

  const handleDismiss = useCallback(() => {
    source?.dismiss(fieldKey)
  }, [fieldKey, source])

  const handleApply = useCallback(() => {
    if (!notice) return
    onApply?.(notice.to)
    source?.dismiss(fieldKey)
  }, [fieldKey, notice, onApply, source])

  if (!notice) return null

  const canApply = typeof onApply === 'function'
  const label = canApply
    ? t.config.defaultChangedApplyTag
    : t.config.defaultChangedTag
  const detail = canApply
    ? format(t.config.defaultChangedApplyDetail, {
        from: notice.from,
        to: notice.to,
      })
    : format(t.config.defaultChangedDetail, {
        from: notice.from,
        to: notice.to,
      })
  const applyTitle = canApply
    ? format(t.config.defaultChangedApplyAria, { to: notice.to })
    : detail

  return (
    <SettingTitleTag
      variant="muted"
      className={className}
      icon={<LuSparkles />}
      title={applyTitle}
      detail={detail}
      onClick={canApply ? handleApply : undefined}
      onDismiss={handleDismiss}
      dismissAriaLabel={t.config.defaultChangedDismissAria}
      role="status"
    >
      {label}
    </SettingTitleTag>
  )
}

SettingDefaultChangeTag.displayName = 'SettingDefaultChangeTag'
