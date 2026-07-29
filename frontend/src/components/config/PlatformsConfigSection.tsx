/**
 * 数据平台配置：列表（拖拽排序 + 开关）↔ 二级页（凭证 + 数据管理）
 * 导航 / 拖拽状态自包含；父级只提供 platforms 草稿与写入回调。
 */

import type { ToastType } from '../Toast'
import type { PlatformAutoFetchConfig } from './PlatformAutoRefreshSettings'

import { LuChevronLeft, LuGripVertical } from '@lib/icons'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../../config'
import { useI18n } from '../../contexts/I18nContext'
import PlatformIcon from '../PlatformIcon'
import {
  AutoHeight,
  InputItem,
  SettingSection,
  SettingTitleHelp,
  SetupFlow,
  ToggleSwitch,
  useSettingGuide,
} from '../settings'
import { SETTINGS_DURATION_MS } from '../settings'
import PlatformAutoRefreshSettings from './PlatformAutoRefreshSettings'
import PlatformDataManagement from './PlatformDataManagement'
import { getPlatformSetupGuide } from './platformSetupGuides'

export interface PlatformConfigField {
  key: string
  label: string
  field_type: string
  value: string
  placeholder: string
  required: boolean
}

export interface PlatformConfig {
  name: string
  enabled: boolean
  has_token: boolean
  config_fields: PlatformConfigField[]
  description: string
  icon: string
}

export interface PlatformsConfigSectionProps {
  title: string
  icon?: React.ReactNode
  description?: string
  sectionId?: string
  platforms: PlatformConfig[]
  autoFetch: PlatformAutoFetchConfig
  onUpdateField: (
    platformIndex: number,
    fieldKey: string,
    value: string,
  ) => void
  onToggle: (platformIndex: number) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onAutoFetchChange: (value: PlatformAutoFetchConfig) => void
  showMessage: (
    message: string,
    type?: ToastType,
    duration?: number,
  ) => void
  /** 跳转设置页 OAuth 区块 */
  openOAuthSection: () => void
  /**
   * 外部要求打开某平台二级页（如 Discord OAuth 回调）。
   * 消费后应调用 onFocusPlatformConsumed 清空，避免重复打开。
   */
  focusPlatform?: string | null
  onFocusPlatformConsumed?: () => void
}

function isMaskedValue(value: string) {
  return value.includes('••') || value.includes('**') || value === '********'
}

function hasFieldValue(field?: PlatformConfigField) {
  return Boolean(field && String(field.value).trim().length > 0)
}

export function isBangumiPlatform(platform: PlatformConfig) {
  return platform.name.toLowerCase() === 'bangumi'
}

export function hasBangumiCredential(platform: PlatformConfig) {
  const username = platform.config_fields.find(
    (field) => field.key === 'username',
  )
  const accessToken = platform.config_fields.find(
    (field) => field.key === 'access_token',
  )
  return hasFieldValue(username) || hasFieldValue(accessToken)
}

export function isPlatformConfigured(platform: PlatformConfig) {
  if (!platform.config_fields || platform.config_fields.length === 0) {
    return true
  }

  if (isBangumiPlatform(platform)) {
    return hasBangumiCredential(platform)
  }

  // Discord 一键授权后 has_token=true；掩码字段也算已配置
  if (platform.name.toLowerCase() === 'discord') {
    if (platform.has_token) return true
  }

  return platform.config_fields.every((field) => {
    if (!field.required) return true
    return field.value && String(field.value).trim().length > 0
  })
}

/** 清理掩码输入，供父级 updateField 复用 */
export function sanitizeMaskedFieldValue(value: string): string {
  if (
    isMaskedValue(value) &&
    value !== '••••••••' &&
    value !== '********'
  ) {
    return value.replace(/[•*]+/g, '')
  }
  return value
}

const PlatformsConfigSection: React.FC<PlatformsConfigSectionProps> = ({
  title,
  icon,
  description,
  sectionId = 'platforms',
  platforms,
  autoFetch,
  onUpdateField,
  onToggle,
  onReorder,
  onAutoFetchChange,
  showMessage,
  openOAuthSection,
  focusPlatform = null,
  onFocusPlatformConsumed,
}) => {
  const { t } = useI18n()
  const { catalog: settingGuides, renderGuide } = useSettingGuide()

  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [platformNavDir, setPlatformNavDir] = useState<
    'none' | 'forward' | 'back'
  >('none')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const suppressCardClickRef = useRef(false)

  const clearPlatformDrag = useCallback(() => {
    dragIndexRef.current = null
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  const openPlatformDetail = useCallback((name: string) => {
    setPlatformNavDir('forward')
    setSelectedPlatform(name)
  }, [])

  const closePlatformDetail = useCallback(() => {
    setPlatformNavDir('back')
    setSelectedPlatform(null)
  }, [])

  // 推入动画播完后清掉方向标记（否则平台卡毛玻璃会停在实底）
  useEffect(() => {
    if (platformNavDir === 'none') return undefined
    const id = window.setTimeout(
      setPlatformNavDir,
      SETTINGS_DURATION_MS.slow + 60,
      'none',
    )
    return () => window.clearTimeout(id)
  }, [platformNavDir, selectedPlatform])

  // Discord OAuth 等外部深链：打开指定平台
  useEffect(() => {
    if (!focusPlatform) return
    const exists = platforms.some((p) => p.name === focusPlatform)
    if (exists) {
      setPlatformNavDir('forward')
      setSelectedPlatform(focusPlatform)
    }
    onFocusPlatformConsumed?.()
  }, [focusPlatform, platforms, onFocusPlatformConsumed])

  const getPlatformDescription = useCallback(
    (platform: PlatformConfig) => {
      const descMap: Record<string, string> = {
        github: t.config.platformDescGithub,
        bilibili: t.config.platformDescBilibili,
        bangumi: t.config.platformDescBangumi,
        steam: t.config.platformDescSteam,
        'netease music': t.config.platformDescNetease,
        netease: t.config.platformDescNetease,
        x: t.config.platformDescX,
        discord: t.config.platformDescDiscord,
        myanimelist: t.config.platformDescMal,
        mal: t.config.platformDescMal,
        xbox: t.config.platformDescXbox,
        playstation: t.config.platformDescPsn,
        psn: t.config.platformDescPsn,
      }
      return descMap[platform.name.toLowerCase()] || platform.description
    },
    [t],
  )

  const getPlatformFieldLabel = useCallback(
    (platform: PlatformConfig, field: PlatformConfigField): string => {
      if (!isBangumiPlatform(platform)) return field.label
      const labels: Record<string, string> = {
        username: t.config.bangumiUsernameLabel,
        access_token: t.config.bangumiAccessTokenLabel,
        user_agent: t.config.bangumiUserAgentLabel,
      }
      return labels[field.key] || field.label
    },
    [t],
  )

  const getPlatformFieldPlaceholder = useCallback(
    (platform: PlatformConfig, field: PlatformConfigField): string => {
      if (!isBangumiPlatform(platform)) return field.placeholder
      const placeholders: Record<string, string> = {
        username: t.config.bangumiUsernamePlaceholder,
        access_token: t.config.bangumiAccessTokenPlaceholder,
        user_agent: t.config.bangumiUserAgentPlaceholder,
      }
      return placeholders[field.key] || field.placeholder
    },
    [t],
  )

  const connectDiscordOAuth = useCallback(() => {
    window.location.href = `${API_URL}/api/platforms/discord/oauth/start`
  }, [])

  const detailIndex = selectedPlatform
    ? platforms.findIndex((p) => p.name === selectedPlatform)
    : -1
  const detailPlatform =
    detailIndex >= 0 ? platforms[detailIndex] : null
  const paneKey = selectedPlatform ?? '__list__'

  if (detailPlatform && detailIndex >= 0) {
    const platformCapability = getPlatformDescription(detailPlatform)
    const setupGuide = getPlatformSetupGuide(detailPlatform.name, t.config, {
      connectDiscordOAuth,
      openOAuthSection,
    })

    return (
      <SettingSection
        sectionId={sectionId}
        title={detailPlatform.name}
        icon={
          <PlatformIcon
            platform={detailPlatform.name}
            className="platform-icon"
          />
        }
        description={platformCapability}
        detail={platformCapability}
        guide={renderGuide(settingGuides.platforms.platformFields)}
        headerLeading={
          <button
            type="button"
            className="section-header-back"
            onClick={closePlatformDetail}
            aria-label={t.common.back}
          >
            <LuChevronLeft size={18} aria-hidden />
            <span>{t.common.back}</span>
          </button>
        }
      >
        <AutoHeight contentKey={paneKey} className="platform-pane-height">
          <div
            key={paneKey}
            data-nav={platformNavDir === 'none' ? undefined : platformNavDir}
            className="platforms-pane platforms-pane--detail sm-pane"
          >
            <div className="platform-detail">
              {setupGuide ? (
                <SetupFlow
                  title={setupGuide.title}
                  optionalLabel={setupGuide.optionalLabel}
                  steps={setupGuide.steps}
                  className="platform-setup-flow"
                />
              ) : null}

              <div className="platform-detail-body">
                {detailPlatform.config_fields.map((field) => {
                  const rawType = field.field_type
                  const inputType =
                    rawType === 'password' ||
                    rawType === 'url' ||
                    rawType === 'email'
                      ? rawType
                      : 'text'
                  return (
                    <InputItem
                      key={field.key}
                      itemKey={`platform-${detailIndex}-${field.key}`}
                      label={getPlatformFieldLabel(detailPlatform, field)}
                      value={field.value}
                      onChange={(value) =>
                        onUpdateField(detailIndex, field.key, value)
                      }
                      placeholder={getPlatformFieldPlaceholder(
                        detailPlatform,
                        field,
                      )}
                      inputType={inputType}
                      required={field.required}
                      layout="vertical"
                      size="md"
                      autoSelectOnMask
                    />
                  )
                })}
              </div>

              <PlatformDataManagement
                platformName={detailPlatform.name}
                showMessage={showMessage}
              />
            </div>
          </div>
        </AutoHeight>
      </SettingSection>
    )
  }

  return (
    <SettingSection
      sectionId={sectionId}
      title={title}
      icon={icon}
      description={description}
      guide={renderGuide(settingGuides.platforms.list)}
    >
      <AutoHeight contentKey={paneKey} className="platform-pane-height">
        <div
          key={paneKey}
          data-nav={platformNavDir === 'none' ? undefined : platformNavDir}
          className="platforms-pane platforms-pane--list sm-pane"
        >
          <div className="platforms-grid">
            {platforms.map((platform, index) => {
              const platformConfigured = isPlatformConfigured(platform)
              const toggleTitle = !platformConfigured
                ? t.config.notConfigured
                : undefined
              const platformDesc = getPlatformDescription(platform)
              const isDragging = dragIndex === index
              const isDragOver =
                dragOverIndex === index && dragIndex !== index

              return (
                <div
                  key={platform.name}
                  className={`platform-card${
                    platform.enabled ? ' platform-card--enabled' : ''
                  }${isDragging ? ' dragging' : ''}${
                    isDragOver ? ' drag-over' : ''
                  }`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (suppressCardClickRef.current) {
                      suppressCardClickRef.current = false
                      return
                    }
                    openPlatformDetail(platform.name)
                  }}
                  onDragOver={(e) => {
                    const from = dragIndexRef.current
                    if (from === null || from === index) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDragOverIndex((prev) =>
                      prev === index ? prev : index,
                    )
                  }}
                  onDragLeave={(e) => {
                    const next = e.relatedTarget as Node | null
                    if (next && e.currentTarget.contains(next)) return
                    setDragOverIndex((prev) =>
                      prev === index ? null : prev,
                    )
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const from = dragIndexRef.current
                    if (from !== null && from !== index) {
                      onReorder(from, index)
                    }
                    clearPlatformDrag()
                  }}
                >
                  <div className="platform-header">
                    <div className="platform-info">
                      <div
                        className="platform-drag-handle"
                        role="button"
                        tabIndex={0}
                        aria-label={t.config.dragToReorder}
                        title={t.config.dragToReorder}
                        draggable
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                          }
                        }}
                        onDragStart={(e) => {
                          e.stopPropagation()
                          suppressCardClickRef.current = true
                          dragIndexRef.current = index
                          setDragIndex(index)
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', String(index))
                          const card = e.currentTarget.closest(
                            '.platform-card',
                          ) as HTMLElement | null
                          if (card) {
                            try {
                              e.dataTransfer.setDragImage(card, 24, 24)
                            } catch {
                              /* ignore */
                            }
                          }
                        }}
                        onDragEnd={() => {
                          clearPlatformDrag()
                          window.setTimeout(() => {
                            suppressCardClickRef.current = false
                          }, 0)
                        }}
                      >
                        <span className="platform-order-num" aria-hidden>
                          {index + 1}
                        </span>
                        <LuGripVertical
                          className="platform-drag-grip"
                          aria-hidden
                        />
                      </div>
                      <div className="platform-icon-wrapper">
                        <PlatformIcon
                          platform={platform.name}
                          className="platform-icon"
                        />
                      </div>
                      <div className="platform-details">
                        <div className="platform-title-row">
                          <h3 className="platform-name">
                            {platform.name}
                            {platformDesc ? (
                              <SettingTitleHelp
                                ariaLabel={`${platform.name} 说明`}
                              >
                                {platformDesc}
                              </SettingTitleHelp>
                            ) : null}
                          </h3>
                          <span
                            className={`platform-status-dot ${platformConfigured ? 'is-configured' : 'is-unconfigured'}`}
                            title={
                              platformConfigured
                                ? t.config.configured
                                : t.config.notConfigured
                            }
                            aria-label={
                              platformConfigured
                                ? t.config.configured
                                : t.config.notConfigured
                            }
                            role="status"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="platform-actions">
                      <ToggleSwitch
                        checked={platform.enabled}
                        onChange={() => onToggle(index)}
                        disabled={!platformConfigured}
                        aria-label={`Enable ${platform.name}`}
                        title={toggleTitle}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <PlatformAutoRefreshSettings
            value={autoFetch}
            enabledPlatformCount={
              platforms.filter((platform) => platform.enabled).length
            }
            onChange={onAutoFetchChange}
          />
        </div>
      </AutoHeight>
    </SettingSection>
  )
}

PlatformsConfigSection.displayName = 'PlatformsConfigSection'

export default PlatformsConfigSection
