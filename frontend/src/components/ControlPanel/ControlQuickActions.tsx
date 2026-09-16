import type { AnimationPreference } from '../../contexts/AnimationPreferenceContext'
import type { AnimationLevel } from '../../hooks/useAnimationLevel'
import type { Locale, TranslationKeys } from '../../i18n'
import { memo } from 'react'
import { WEATHER_ICON_ASSETS } from '../../utils/weather'
import { WeatherAssetIcon } from '../weather/WeatherAssetIcon'
import { LanguageSwitch } from './LanguageSwitch'

const CONTROL_PANEL_ICON_ASSETS = {
  appearanceLight: WEATHER_ICON_ASSETS.sunny,
  appearanceDark: '/icons/greeting/night.webp',
  animationStandard: '/icons/control-panel/animation-standard.webp',
  animationLight: '/icons/control-panel/animation-light.webp',
  wallpaper: '/icons/control-panel/wallpaper.webp',
  config: '/icons/control-panel/config.webp',
} as const

interface ControlQuickActionsProps {
  locale: Locale
  labels: TranslationKeys['controlPanel']
  onLocaleChange: (locale: Locale) => void
  isDark: boolean
  themePreference: 'light' | 'dark' | 'auto'
  onCycleTheme: () => void
  animPreference: AnimationPreference
  animLevel: AnimationLevel
  isStandardAnimation: boolean
  onToggleAnimation: () => void
  canRefreshWallpaper: boolean
  onRefreshWallpaper: () => void
  isAdmin: boolean
  onOpenConfig: () => void
}

const REFRESH_ICON = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
)

export const ControlQuickActions = memo(({
  locale,
  labels,
  onLocaleChange,
  isDark,
  themePreference,
  onCycleTheme,
  animPreference,
  animLevel,
  isStandardAnimation,
  onToggleAnimation,
  canRefreshWallpaper,
  onRefreshWallpaper,
  isAdmin,
  onOpenConfig,
}: ControlQuickActionsProps) => {
  const animationModeClass = isStandardAnimation
    ? 'performance-standard'
    : 'performance-light'

  return (
    <div className="control-items-grid">
      <div className="control-item control-item-compact">
        <div className="control-item-info">
          <div className="control-item-icon icon-theme">
            <WeatherAssetIcon
              icon={
                isDark
                  ? CONTROL_PANEL_ICON_ASSETS.appearanceDark
                  : CONTROL_PANEL_ICON_ASSETS.appearanceLight
              }
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <h4 className="control-item-title">{labels.appearance}</h4>
            <p className="control-item-desc">
              {themePreference === 'auto'
                ? labels.auto
                : themePreference === 'dark'
                  ? labels.dark
                  : labels.light}
            </p>
          </div>
        </div>
        <button
          onClick={onCycleTheme}
          className="control-action-btn"
          aria-label={labels.themeSwitch}
        >
          {REFRESH_ICON}
        </button>
      </div>

      <div className="control-item control-item-compact">
        <div className="control-item-info">
          <div className={`control-item-icon icon-performance ${animationModeClass}`}>
            <WeatherAssetIcon
              icon={
                isStandardAnimation
                  ? CONTROL_PANEL_ICON_ASSETS.animationStandard
                  : CONTROL_PANEL_ICON_ASSETS.animationLight
              }
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <h4 className="control-item-title">{labels.animation}</h4>
            <p className="control-item-desc">
              {animPreference === 'auto'
                ? animLevel === 'standard'
                  ? labels.highPerformance
                  : labels.lowPerformance
                : animPreference === 'light'
                  ? labels.lowPerformance
                  : labels.highPerformance}
            </p>
          </div>
        </div>
        <button
          onClick={onToggleAnimation}
          className={`control-toggle animation-toggle ${animationModeClass} ${
            isStandardAnimation ? 'active' : ''
          }`}
          aria-label={labels.animation}
        >
          <span className="control-toggle-slider"></span>
        </button>
      </div>

      <LanguageSwitch
        locale={locale}
        labels={labels}
        title={labels.language}
        ariaLabel={labels.languageSwitch}
        onChange={onLocaleChange}
      />

      {canRefreshWallpaper && (
        <div className="control-item control-item-compact">
          <div className="control-item-info">
            <div className="control-item-icon icon-wallpaper">
              <WeatherAssetIcon
                icon={CONTROL_PANEL_ICON_ASSETS.wallpaper}
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <h4 className="control-item-title">{labels.wallpaper}</h4>
              <p className="control-item-desc">{labels.random}</p>
            </div>
          </div>
          <button
            onClick={onRefreshWallpaper}
            className="control-action-btn"
            aria-label={labels.wallpaperSwitch}
          >
            {REFRESH_ICON}
          </button>
        </div>
      )}

      {isAdmin && (
        <div className="control-item control-item-compact">
          <div className="control-item-info">
            <div className="control-item-icon icon-config">
              <WeatherAssetIcon
                icon={CONTROL_PANEL_ICON_ASSETS.config}
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <h4 className="control-item-title">{labels.configuration}</h4>
              <p className="control-item-desc">{labels.system}</p>
            </div>
          </div>
          <button
            onClick={onOpenConfig}
            className="control-action-btn"
            aria-label={labels.configuration}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
})
