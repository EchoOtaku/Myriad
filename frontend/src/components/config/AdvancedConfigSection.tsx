import type { Locale } from '../../i18n'
import type { SettingsRestorePreview } from '../../lib/api'

import { FaGlobe, FaSave, FaTimes, LuDownload, LuUpload } from '@lib/icons'
import React, { useCallback, useRef, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import {
  fetchSettingsBackup,
  previewSettingsBackup,
  restoreSettingsBackup,
  updateConfig,
} from '../../lib/api'

import { getCSRFToken } from '../../utils/csrf'
import {
  ButtonItem,
  InputItem,
  SettingGroup,
  SettingSection,
  SettingsButton,
  SwitchItem,
  useSettingGuide,
} from '../settings'

interface UiConfigField {
  key: string
  value: string
}

interface AdvancedConfigSectionProps {
  onReset: () => void
  title: string
  icon: React.ReactNode
  description: string
  sectionId?: string
  /** UI config fields (network proxy / API mirrors). */
  uiConfigFields: UiConfigField[]
  updateUiFieldValue: (key: string, value: string) => void
  onMessage?: (
    msg: string,
    type?: 'success' | 'error' | 'warning' | 'info',
  ) => void
}

const SETTINGS_BACKUP_FORMAT = 'myriad-settings-backup'
const MIN_SETTINGS_BACKUP_VERSION = 1
const SETTINGS_BACKUP_VERSION = 2

interface ClientPreferenceDescriptor {
  key: string
  schemaVersion: number
}

interface ClientPreferenceBackupEntry {
  schema_version: number
  value: string
}

interface ClientPreferenceRestorePlan {
  values: Record<string, string>
  restoreCount: number
  preserveCount: number
  ignoredKeys: string[]
  invalidKeys: string[]
}

// 浏览器设置的唯一备份注册表；新增或删除本地设置只需要维护这里。
const CLIENT_PREFERENCE_REGISTRY: ClientPreferenceDescriptor[] = [
  { key: 'theme', schemaVersion: 1 },
  { key: 'locale', schemaVersion: 1 },
  { key: 'animation-preference', schemaVersion: 1 },
  { key: 'config_favorites', schemaVersion: 1 },
  { key: 'brewlia_tts_settings', schemaVersion: 1 },
  { key: 'brew-reader-settings', schemaVersion: 1 },
]

const IMPORT_PREVIEW_TEXT: Record<
  Locale,
  Record<'restore' | 'preserve' | 'ignored' | 'migrated' | 'invalid', string>
> = {
  'zh-CN': {
    restore: '将恢复',
    preserve: '保留当前/默认值',
    ignored: '忽略已废弃项',
    migrated: '自动迁移',
    invalid: '无法恢复',
  },
  'en-US': {
    restore: 'Restore',
    preserve: 'Keep current/default',
    ignored: 'Ignore removed',
    migrated: 'Auto-migrate',
    invalid: 'Cannot restore',
  },
  'ja-JP': {
    restore: '復元',
    preserve: '現在値/既定値を維持',
    ignored: '廃止項目を無視',
    migrated: '自動移行',
    invalid: '復元不可',
  },
}

function collectClientPreferences(): Record<
  string,
  ClientPreferenceBackupEntry
> {
  return Object.fromEntries(
    CLIENT_PREFERENCE_REGISTRY.flatMap((descriptor) => {
      const value = localStorage.getItem(descriptor.key)
      return value === null
        ? []
        : [
            [
              descriptor.key,
              { schema_version: descriptor.schemaVersion, value },
            ],
          ]
    }),
  )
}

function planClientPreferenceRestore(
  data: unknown,
): ClientPreferenceRestorePlan {
  const preferences =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  const registry = new Map(
    CLIENT_PREFERENCE_REGISTRY.map((descriptor) => [
      descriptor.key,
      descriptor,
    ]),
  )
  const values: Record<string, string> = {}
  const ignoredKeys = Object.keys(preferences).filter(
    (key) => !registry.has(key),
  )
  const invalidKeys: string[] = []

  for (const descriptor of CLIENT_PREFERENCE_REGISTRY) {
    const raw = preferences[descriptor.key]
    if (typeof raw === 'string') {
      // v1 客户端偏好是扁平字符串。
      values[descriptor.key] = raw
      continue
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Partial<ClientPreferenceBackupEntry>
    if (
      typeof entry.value !== 'string' ||
      entry.schema_version !== descriptor.schemaVersion
    ) {
      invalidKeys.push(descriptor.key)
      continue
    }
    values[descriptor.key] = entry.value
  }

  return {
    values,
    restoreCount: Object.keys(values).length,
    preserveCount:
      CLIENT_PREFERENCE_REGISTRY.length - Object.keys(values).length,
    ignoredKeys,
    invalidKeys,
  }
}

function restoreClientPreferences(plan: ClientPreferenceRestorePlan | null) {
  if (!plan) return
  for (const [key, value] of Object.entries(plan.values)) {
    localStorage.setItem(key, value)
  }
}

function combineRestorePreviews(
  backend: SettingsRestorePreview,
  client: ClientPreferenceRestorePlan,
): SettingsRestorePreview {
  return {
    ...backend,
    restore_count: backend.restore_count + client.restoreCount,
    preserve_count: backend.preserve_count + client.preserveCount,
    ignored_count: backend.ignored_count + client.ignoredKeys.length,
    invalid_count: backend.invalid_count + client.invalidKeys.length,
    ignored_keys: [
      ...backend.ignored_keys,
      ...client.ignoredKeys.map((key) => `client:${key}`),
    ],
    invalid_keys: [
      ...backend.invalid_keys,
      ...client.invalidKeys.map((key) => `client:${key}`),
    ],
  }
}

function isVersionedSettingsBackup(
  data: unknown,
): data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const backup = data as Record<string, unknown>
  return (
    backup.format === SETTINGS_BACKUP_FORMAT &&
    typeof backup.version === 'number' &&
    backup.version >= MIN_SETTINGS_BACKUP_VERSION &&
    backup.version <= SETTINGS_BACKUP_VERSION &&
    Array.isArray(backup.configurations) &&
    Boolean(backup.effective_config) &&
    Boolean(backup.user_preferences)
  )
}

function isLegacyConfig(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const config = data as Record<string, unknown>
  return Boolean(
    config.platforms &&
    config.ai_config &&
    config.report_config &&
    config.ui_config,
  )
}

export const AdvancedConfigSection: React.FC<AdvancedConfigSectionProps> = ({
  onReset,
  title,
  icon,
  description,
  sectionId,
  uiConfigFields,
  updateUiFieldValue,
  onMessage,
}) => {
  const { locale, t } = useI18n()
  const { catalog: g, renderGuide } = useSettingGuide()
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  const [pendingImportData, setPendingImportData] = useState<unknown>(null)
  const [pendingClientRestore, setPendingClientRestore] =
    useState<ClientPreferenceRestorePlan | null>(null)
  const [restorePreview, setRestorePreview] =
    useState<SettingsRestorePreview | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewText = IMPORT_PREVIEW_TEXT[locale]

  const getUiFieldValue = useCallback(
    (key: string) => uiConfigFields.find((f) => f.key === key)?.value || '',
    [uiConfigFields],
  )
  const isProxyEnabled = getUiFieldValue('proxy_enabled') === 'true'

  const closeImportConfirm = useCallback(() => {
    setImportConfirmOpen(false)
    setPendingImportData(null)
    setPendingClientRestore(null)
    setRestorePreview(null)
  }, [])

  const handleExport = useCallback(async () => {
    try {
      const backup = await fetchSettingsBackup()
      const json = JSON.stringify(
        {
          ...backup,
          client_preferences: collectClientPreferences(),
        },
        null,
        2,
      )
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `myriad-settings-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      onMessage?.(t.config.exportConfigSuccess, 'success')
    } catch (error) {
      console.error('Export failed:', error)
      onMessage?.(
        `${t.config.exportConfigFailed}: ${error instanceof Error ? error.message : ''}`,
        'error',
      )
    }
  }, [t, onMessage])

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target?.result as string)
          if (!isVersionedSettingsBackup(data) && !isLegacyConfig(data)) {
            onMessage?.(t.config.importConfigInvalid, 'error')
            return
          }
          if (isVersionedSettingsBackup(data)) {
            const clientPlan = planClientPreferenceRestore(
              data.client_preferences,
            )
            const backendPreview = await previewSettingsBackup(data)
            setPendingClientRestore(clientPlan)
            setRestorePreview(
              combineRestorePreviews(backendPreview, clientPlan),
            )
          } else {
            setPendingClientRestore(null)
            setRestorePreview(null)
          }
          setPendingImportData(data)
          setImportConfirmOpen(true)
        } catch {
          onMessage?.(t.config.importConfigInvalid, 'error')
        }
      }
      reader.readAsText(file)
      // 重置 input 以便再次选择同一文件
      e.target.value = ''
    },
    [t, onMessage],
  )

  const handleImportConfirm = useCallback(async () => {
    if (!pendingImportData) return
    setImportConfirmOpen(false)

    try {
      await getCSRFToken(true)
      if (isVersionedSettingsBackup(pendingImportData)) {
        await restoreSettingsBackup(pendingImportData)
        restoreClientPreferences(pendingClientRestore)
      } else {
        await updateConfig(pendingImportData)
      }
      onMessage?.(t.config.importConfigSuccess, 'success')
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (error) {
      console.error('Import failed:', error)
      onMessage?.(
        `${t.config.importConfigFailed}: ${error instanceof Error ? error.message : ''}`,
        'error',
      )
    } finally {
      setPendingImportData(null)
      setPendingClientRestore(null)
      setRestorePreview(null)
    }
  }, [pendingClientRestore, pendingImportData, t, onMessage])

  return (
    <SettingSection
      title={title}
      icon={icon}
      description={description}
      sectionId={sectionId}
    >
      {/* 代理 + API 镜像 */}
      <SettingGroup
        title={t.config.network}
        description={t.config.networkDesc}
        guide={renderGuide(g.advanced.network)}
        icon={<FaGlobe />}
      >
        <SwitchItem
          itemKey="proxy_enabled"
          label={t.config.enableProxy || '启用网络代理'}
          description={
            t.config.enableProxyHint || '开启后将使用代理访问外部API'
          }
          guide={renderGuide(g.advanced.proxyEnable)}
          value={isProxyEnabled}
          onChange={(v) => updateUiFieldValue('proxy_enabled', v.toString())}
          layout="horizontal"
        />
        <InputItem
          itemKey="proxy_url"
          label={t.config.proxyUrl || '代理地址'}
          value={getUiFieldValue('proxy_url')}
          onChange={(v) => updateUiFieldValue('proxy_url', v)}
          placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
          hint={
            isProxyEnabled
              ? t.config.proxyUrlHint || '支持 HTTP、HTTPS、SOCKS5 代理协议'
              : t.config.proxyUrlDisabledHint ||
                '代理已关闭（关闭时不会使用此地址）。可清空以移除保存的代理配置。'
          }
          guide={renderGuide(g.advanced.proxyUrl)}
          layout="vertical"
        />
        <InputItem
          itemKey="proxy_bypass"
          label={t.config.proxyBypass || '代理绕过列表'}
          value={getUiFieldValue('proxy_bypass')}
          onChange={(v) => updateUiFieldValue('proxy_bypass', v)}
          placeholder="localhost,127.0.0.1,bilibili.com"
          hint={
            t.config.proxyBypassHint ||
            '不使用代理的域名，用逗号分隔。国内服务（如 Bilibili）建议添加到绕过列表'
          }
          guide={renderGuide(g.advanced.proxyBypass)}
          layout="vertical"
        />
        <InputItem
          itemKey="gemini_base_url"
          label={t.config.geminiBaseUrl || 'Gemini API 基础地址'}
          value={getUiFieldValue('gemini_base_url')}
          onChange={(v) => updateUiFieldValue('gemini_base_url', v)}
          placeholder="https://generativelanguage.googleapis.com"
          hint={
            t.config.geminiBaseUrlHint ||
            '留空使用官方地址，可填写第三方代理服务地址'
          }
          guide={renderGuide(g.advanced.geminiBaseUrl)}
          layout="vertical"
        />
        <InputItem
          itemKey="github_api_base_url"
          label={t.config.githubApiBaseUrl || 'GitHub API 基础地址'}
          value={getUiFieldValue('github_api_base_url')}
          onChange={(v) => updateUiFieldValue('github_api_base_url', v)}
          placeholder="https://api.github.com"
          hint={
            t.config.githubApiBaseUrlHint ||
            '留空使用官方地址，可填写 GitHub API 镜像地址（注意：OAuth 认证仍需使用官方地址）'
          }
          guide={renderGuide(g.advanced.githubApiBaseUrl)}
          layout="vertical"
        />
      </SettingGroup>

      <SettingGroup
        title={t.config.configBackupTitle}
        description={t.config.configBackupDesc}
        guide={renderGuide(g.advanced.backup)}
        icon={<FaSave />}
      >
        <ButtonItem
          itemKey="export_config"
          label={t.config.exportConfig}
          description={t.config.exportConfigDesc}
          guide={renderGuide(g.advanced.exportConfig)}
          buttonText={t.config.exportConfig}
          buttonIcon={<LuDownload size={14} />}
          onClick={handleExport}
          variant="secondary"
          layout="horizontal"
        />
        <ButtonItem
          itemKey="import_config"
          label={t.config.importConfig}
          description={t.config.importConfigDesc}
          guide={renderGuide(g.advanced.importConfig)}
          buttonText={t.config.importConfig}
          buttonIcon={<LuUpload size={14} />}
          onClick={handleImportClick}
          variant="secondary"
          layout="horizontal"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          title="Import configuration file"
          onChange={handleFileChange}
        />
        <ButtonItem
          itemKey="reset_config"
          label={t.config.resetConfig}
          description={
            t.config.resetConfigDesc ||
            'Reset all configurations to default values. This action cannot be undone.'
          }
          guide={renderGuide(g.advanced.resetConfig)}
          buttonText={t.config.resetConfig}
          onClick={() => setResetConfirmOpen(true)}
          variant="danger"
          layout="horizontal"
        />
      </SettingGroup>

      {/* Reset Confirmation Modal */}
      {resetConfirmOpen && (
        <div
          className="modal-overlay"
          onClick={() => setResetConfirmOpen(false)}
        >
          <div
            className="modal-content modal-small"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title text-danger">
                {t.config.resetConfig}
              </h3>
              <button
                onClick={() => setResetConfirmOpen(false)}
                className="modal-close-button"
                title="Close"
              >
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              <p className="settings-modal-message">
                {t.config.resetConfirmMessage ||
                  'Are you sure you want to reset all configurations? This action cannot be undone and will restore all settings to their default values.'}
              </p>
            </div>
            <div className="modal-footer">
              <SettingsButton
                variant="secondary"
                onClick={() => setResetConfirmOpen(false)}
              >
                {t.common.cancel}
              </SettingsButton>
              <SettingsButton
                variant="danger"
                onClick={() => {
                  onReset()
                  setResetConfirmOpen(false)
                }}
              >
                {t.common.confirm}
              </SettingsButton>
            </div>
          </div>
        </div>
      )}

      {/* Import Confirmation Modal */}
      {importConfirmOpen && (
        <div className="modal-overlay" onClick={closeImportConfirm}>
          <div
            className="modal-content modal-small"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">{t.config.importConfig}</h3>
              <button
                onClick={closeImportConfirm}
                className="modal-close-button"
                title="Close"
              >
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              <p className="settings-modal-message">
                {t.config.importConfirmMessage}
              </p>
              {restorePreview && (
                <div className="settings-stat-grid">
                  <div className="settings-stat-chip is-ok">
                    {previewText.restore}: {restorePreview.restore_count}
                  </div>
                  <div className="settings-stat-chip is-info">
                    {previewText.preserve}: {restorePreview.preserve_count}
                  </div>
                  <div className="settings-stat-chip is-muted">
                    {previewText.ignored}: {restorePreview.ignored_count}
                  </div>
                  <div className="settings-stat-chip is-accent">
                    {previewText.migrated}: {restorePreview.migrated_count}
                  </div>
                  {restorePreview.invalid_count > 0 && (
                    <div className="settings-stat-chip is-danger is-wide">
                      {previewText.invalid}: {restorePreview.invalid_count}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <SettingsButton variant="secondary" onClick={closeImportConfirm}>
                {t.common.cancel}
              </SettingsButton>
              <SettingsButton variant="primary" onClick={handleImportConfirm}>
                {t.common.confirm}
              </SettingsButton>
            </div>
          </div>
        </div>
      )}
    </SettingSection>
  )
}
