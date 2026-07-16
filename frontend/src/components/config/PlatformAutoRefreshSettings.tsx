import { LuRefreshCw } from '@lib/icons'
import React from 'react'

import { useI18n } from '../../contexts/I18nContext'
import { SettingGroup } from '../settings'

export interface PlatformAutoFetchConfig {
  enabled: boolean
  interval_hours: number
}

interface PlatformAutoRefreshSettingsProps {
  value: PlatformAutoFetchConfig
  enabledPlatformCount: number
  onChange: (value: PlatformAutoFetchConfig) => void
}

const INTERVAL_OPTIONS = [6, 12, 24]

const PlatformAutoRefreshSettings: React.FC<
  PlatformAutoRefreshSettingsProps
> = ({ value, enabledPlatformCount, onChange }) => {
  const { t } = useI18n()
  const interval = INTERVAL_OPTIONS.includes(value.interval_hours)
    ? value.interval_hours
    : 24
  const selectedValue = value.enabled ? String(interval) : 'off'
  const optionLabel = (hours: number) =>
    t.config.autoRefreshEveryHours.replace('{hours}', String(hours))

  const summary = value.enabled
    ? enabledPlatformCount > 0
      ? t.config.autoRefreshSummary
          .replace('{count}', String(enabledPlatformCount))
          .replace('{hours}', String(interval))
      : t.config.autoRefreshNoPlatforms
    : t.config.autoRefreshDisabledHint
  const hint =
    value.enabled && enabledPlatformCount > 0
      ? `${summary} ${t.config.autoRefreshFrequencyDesc}`
      : summary

  return (
    <SettingGroup
      title={t.config.autoRefreshTitle}
      description={t.config.autoRefreshDescription}
      icon={<LuRefreshCw />}
      className="bordered platform-auto-refresh-settings"
    >
      <div className="space-y-2.5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
          <div className="shrink-0 text-sm font-semibold text-gray-800 md:w-20 dark:text-gray-100">
            {t.config.autoRefreshFrequency}
          </div>

          <div
            className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4"
            role="radiogroup"
            aria-label={t.config.autoRefreshFrequency}
          >
            {[
              { value: 'off', label: t.config.autoRefreshOff },
              ...INTERVAL_OPTIONS.map((hours) => ({
                value: String(hours),
                label: optionLabel(hours),
              })),
            ].map((option) => {
              const selected = selectedValue === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`min-h-11 rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors ${
                    selected
                      ? 'text-[var(--color-primary)]'
                      : 'border-gray-200/80 bg-white/45 text-gray-600 hover:border-gray-300 hover:bg-white/70 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-white/20 dark:hover:bg-white/[0.06]'
                  }`}
                  style={
                    selected
                      ? {
                          borderColor:
                            'color-mix(in srgb, var(--color-primary, #3b82f6) 48%, transparent)',
                          backgroundColor:
                            'color-mix(in srgb, var(--color-primary, #3b82f6) 11%, transparent)',
                          boxShadow:
                            '0 0 0 1px color-mix(in srgb, var(--color-primary, #3b82f6) 8%, transparent)',
                        }
                      : undefined
                  }
                  onClick={() =>
                    option.value === 'off'
                      ? onChange({ ...value, enabled: false })
                      : onChange({
                          enabled: true,
                          interval_hours: Number(option.value),
                        })
                  }
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      </div>
    </SettingGroup>
  )
}

export default React.memo(PlatformAutoRefreshSettings)
