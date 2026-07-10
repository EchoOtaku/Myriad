import { LuGlobe } from '@lib/icons'
import React from 'react'
import { useI18n } from '../../contexts/I18nContext'
import PlatformIcon from '../PlatformIcon'

interface ConfigField {
  key: string
  label: string
  field_type: string
  value: string
  placeholder: string
  required: boolean
}

interface PlatformConfig {
  name: string
  enabled: boolean
  has_token: boolean
  config_fields: ConfigField[]
  description: string
  icon: string
}

interface PlatformConfigSectionProps {
  platforms: PlatformConfig[]
  testing: string | null
  onTogglePlatform: (index: number) => void
  onUpdateField: (
    platformIndex: number,
    fieldKey: string,
    value: string,
  ) => void
  onTest: (platformName: string) => void
  onOpenModal: (platformName: string) => void
  /** Discord 一键授权：跳转 OAuth start */
  onConnectDiscord?: () => void
}

function isDiscordPlatform(platform: PlatformConfig): boolean {
  return platform.name.toLowerCase() === 'discord'
}

const PlatformConfigSection = React.memo<PlatformConfigSectionProps>(
  ({
    platforms,
    testing,
    onTogglePlatform,
    onUpdateField,
    onTest,
    onOpenModal,
    onConnectDiscord,
  }) => {
    const { t } = useI18n()

    return (
      <div className="config-section">
        <div className="section-header">
          <div className="section-header-left">
            <LuGlobe className="section-icon icon-platforms" size={18} />
            <div>
              <h2 className="section-title">{t.config.platformsConfigTitle}</h2>
              <p className="section-description">
                {t.config.platformsConfigDesc}
              </p>
            </div>
          </div>
        </div>

        <div className="platforms-grid">
          {platforms.map((platform, index) => (
            <div key={platform.name} className="platform-card">
              <div className="platform-header">
                <div className="platform-info">
                  <div className="platform-icon-wrapper">
                    <PlatformIcon
                      platform={platform.name}
                      className="platform-icon"
                    />
                  </div>
                  <div className="platform-details">
                    <div className="platform-title-row">
                      <h3 className="platform-name">{platform.name}</h3>
                      <span
                        className={`status-badge ${platform.enabled && platform.has_token ? 'configured' : 'unconfigured'}`}
                      >
                        {platform.enabled && platform.has_token
                          ? t.config.configuredStatus
                          : t.config.unconfiguredStatus}
                      </span>
                    </div>
                    <p className="platform-desc">{platform.description}</p>
                  </div>
                </div>
                <div className="platform-actions">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={platform.enabled}
                      onChange={() => onTogglePlatform(index)}
                      aria-label={t.config.enablePlatform.replace(
                        '{platform}',
                        platform.name,
                      )}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>

              {platform.enabled && (
                <div className="platform-config">
                  {isDiscordPlatform(platform) && onConnectDiscord && (
                    <div className="form-group-inline" style={{ marginBottom: 8 }}>
                      <button
                        type="button"
                        className="test-button-inline"
                        onClick={onConnectDiscord}
                        style={{ width: '100%' }}
                      >
                        {platform.has_token
                          ? t.config.discordReconnect
                          : t.config.discordConnect}
                      </button>
                      <p
                        className="platform-desc"
                        style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}
                      >
                        {t.config.discordConnectHint}
                      </p>
                    </div>
                  )}
                  {platform.config_fields.map((field) => (
                    <div key={field.key} className="form-group-inline">
                      <label className="form-label-inline">
                        {field.label}
                        {field.required && (
                          <span className="required-mark">*</span>
                        )}
                      </label>
                      <div className="input-with-test">
                        <input
                          type={
                            field.field_type === 'password'
                              ? 'password'
                              : 'text'
                          }
                          value={field.value}
                          onChange={(e) =>
                            onUpdateField(index, field.key, e.target.value)
                          }
                          placeholder={field.placeholder}
                          className="form-input-inline"
                          autoComplete="off"
                        />
                        {(field.key === 'token' ||
                          field.key === 'access_token') && (
                          <button
                            onClick={() => onTest(platform.name)}
                            disabled={
                              (!field.value && !platform.has_token) ||
                              testing === platform.name
                            }
                            className="test-button-inline"
                            type="button"
                          >
                            {testing === platform.name
                              ? t.config.testingConnection
                              : t.config.testConnection}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => onOpenModal(platform.name)}
                    className="help-button"
                    type="button"
                  >
                    {t.config.howToGetToken}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  },
)

PlatformConfigSection.displayName = 'PlatformConfigSection'

export default PlatformConfigSection
