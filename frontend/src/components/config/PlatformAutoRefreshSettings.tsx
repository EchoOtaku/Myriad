import { LuRefreshCw } from '@lib/icons'
import React, { useMemo } from 'react'

import { useI18n } from '../../contexts/I18nContext'
import { SegmentedControl, SettingGroup, useSettingGuide } from '../settings'
import type { ChoiceOption } from '../settings'

export interface PlatformAutoFetchConfig {
  enabled: boolean
  interval_hours: number
}

interface PlatformAutoRefreshSettingsProps {
  value: PlatformAutoFetchConfig
  enabledPlatformCount: number
  onChange: (value: PlatformAutoFetchConfig) => void
  /** 可选扩展内容 */
  children?: React.ReactNode
}

const INTERVAL_OPTIONS = [6, 12, 24]

const PlatformAutoRefreshSettings: React.FC<
  PlatformAutoRefreshSettingsProps
> = ({ value, enabledPlatformCount, onChange, children }) => {
  const { t } = useI18n()
  const { catalog: g, renderGuide } = useSettingGuide()
  const interval = INTERVAL_OPTIONS.includes(value.interval_hours)
    ? value.interval_hours
    : 24
  const selectedValue = value.enabled ? String(interval) : 'off'

  // 当前状态短文案（标题旁标签）；用途说明走 description → ⓘ tooltip
  const status = value.enabled
    ? enabledPlatformCount > 0
      ? t.config.autoRefreshSummary
          .replace('{count}', String(enabledPlatformCount))
          .replace('{hours}', String(interval))
      : t.config.autoRefreshNoPlatforms
    : t.config.autoRefreshDisabledHint

  const options = useMemo((): ChoiceOption[] => {
    return [
      { value: 'off', label: t.config.autoRefreshOff },
      ...INTERVAL_OPTIONS.map((hours) => ({
        value: String(hours),
        label: t.config.autoRefreshEveryHours.replace(
          '{hours}',
          String(hours),
        ),
      })),
    ]
  }, [t.config.autoRefreshOff, t.config.autoRefreshEveryHours])

  return (
    <SettingGroup
      title={t.config.autoRefreshTitle}
      description={t.config.autoRefreshDescription}
      detail={
        <>
          {t.config.autoRefreshDescription}
          <br />
          {t.config.autoRefreshFrequencyDesc}
        </>
      }
      guide={renderGuide(g.platforms.autoRefresh)}
      titleExtra={
        <span className="platform-auto-refresh-status">{status}</span>
      }
      icon={<LuRefreshCw />}
    >
      <div className="settings-stack">
        <SegmentedControl
          size="md"
          columns={4}
          ariaLabel={t.config.autoRefreshTitle}
          value={selectedValue}
          options={options}
          onChange={(next) =>
            next === 'off'
              ? onChange({ ...value, enabled: false })
              : onChange({
                  enabled: true,
                  interval_hours: Number(next),
                })
          }
        />
        {children}
      </div>
    </SettingGroup>
  )
}

export default React.memo(PlatformAutoRefreshSettings)
