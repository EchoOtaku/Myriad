import { FaTimes, LuDownload, LuUpload } from '@lib/icons'
import React, { useCallback, useRef, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import {
  fetchSettingsBackup,
  restoreSettingsBackup,
  updateConfig,
} from '../../lib/api'

import { getCSRFToken } from '../../utils/csrf'
import { ButtonItem, SettingGroup, SettingSection } from '../settings'

interface AdvancedConfigSectionProps {
  onReset: () => void
  title: string
  icon: React.ReactNode
  description: string
  sectionId?: string
  onMessage?: (
    msg: string,
    type?: 'success' | 'error' | 'warning' | 'info',
  ) => void
}

const SETTINGS_BACKUP_FORMAT = 'myriad-settings-backup'
const SETTINGS_BACKUP_VERSION = 1
const CLIENT_PREFERENCE_KEYS = [
  'theme',
  'locale',
  'animation-preference',
  'config_favorites',
  'brewlia_tts_settings',
  'brew-reader-settings',
] as const

function collectClientPreferences(): Record<string, string> {
  return Object.fromEntries(
    CLIENT_PREFERENCE_KEYS.flatMap((key) => {
      const value = localStorage.getItem(key)
      return value === null ? [] : [[key, value]]
    }),
  )
}

function restoreClientPreferences(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return
  const preferences = data as Record<string, unknown>
  for (const key of CLIENT_PREFERENCE_KEYS) {
    const value = preferences[key]
    if (typeof value === 'string') {
      localStorage.setItem(key, value)
    } else {
      localStorage.removeItem(key)
    }
  }
}

function isVersionedSettingsBackup(
  data: unknown,
): data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const backup = data as Record<string, unknown>
  return (
    backup.format === SETTINGS_BACKUP_FORMAT &&
    backup.version === SETTINGS_BACKUP_VERSION &&
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
  onMessage,
}) => {
  const { t } = useI18n()
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  const [pendingImportData, setPendingImportData] = useState<unknown>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string)
          if (!isVersionedSettingsBackup(data) && !isLegacyConfig(data)) {
            onMessage?.(t.config.importConfigInvalid, 'error')
            return
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
        restoreClientPreferences(pendingImportData.client_preferences)
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
    }
  }, [pendingImportData, t, onMessage])

  return (
    <SettingSection
      title={title}
      icon={icon}
      description={description}
      sectionId={sectionId}
    >
      <SettingGroup>
        <ButtonItem
          itemKey="export_config"
          label={t.config.exportConfig}
          description={t.config.exportConfigDesc}
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
              <p className="text-base text-gray-600 dark:text-gray-300">
                {t.config.resetConfirmMessage ||
                  'Are you sure you want to reset all configurations? This action cannot be undone and will restore all settings to their default values.'}
              </p>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setResetConfirmOpen(false)}
                className="btn-base btn-secondary"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={() => {
                  onReset()
                  setResetConfirmOpen(false)
                }}
                className="btn-base btn-danger"
              >
                {t.common.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Confirmation Modal */}
      {importConfirmOpen && (
        <div
          className="modal-overlay"
          onClick={() => {
            setImportConfirmOpen(false)
            setPendingImportData(null)
          }}
        >
          <div
            className="modal-content modal-small"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">{t.config.importConfig}</h3>
              <button
                onClick={() => {
                  setImportConfirmOpen(false)
                  setPendingImportData(null)
                }}
                className="modal-close-button"
                title="Close"
              >
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-base text-gray-600 dark:text-gray-300">
                {t.config.importConfirmMessage}
              </p>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => {
                  setImportConfirmOpen(false)
                  setPendingImportData(null)
                }}
                className="btn-base btn-secondary"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleImportConfirm}
                className="btn-base btn-primary"
              >
                {t.common.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingSection>
  )
}
