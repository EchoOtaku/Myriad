import { FaTimes, LuDownload, LuUpload } from '@lib/icons'
import React, { useCallback, useRef, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { fetchConfig, updateConfig } from '../../lib/api'

import { getCSRFToken } from '../../utils/csrf'
import { ButtonItem, SettingGroup, SettingSection } from '../settings'

interface AdvancedConfigSectionProps {
  onReset: () => void
  title: string
  icon: React.ReactNode
  description: string
  sectionId?: string
  onMessage?: (msg: string) => void
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
  const [pendingImportData, setPendingImportData] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = useCallback(async () => {
    try {
      const config = await fetchConfig()
      const json = JSON.stringify(config, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `myriad-config-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      onMessage?.(t.config.exportConfigSuccess)
    }
    catch (error) {
      console.error('Export failed:', error)
    }
  }, [t, onMessage])

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file)
      return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string)
        // 基本结构校验
        if (!data || typeof data !== 'object' || !data.platforms || !data.ai_config || !data.ui_config) {
          onMessage?.(t.config.importConfigInvalid)
          return
        }
        setPendingImportData(data)
        setImportConfirmOpen(true)
      }
      catch {
        onMessage?.(t.config.importConfigInvalid)
      }
    }
    reader.readAsText(file)
    // 重置 input 以便再次选择同一文件
    e.target.value = ''
  }, [t, onMessage])

  const handleImportConfirm = useCallback(async () => {
    if (!pendingImportData)
      return
    setImportConfirmOpen(false)

    try {
      await getCSRFToken(true)
      await updateConfig(pendingImportData)
      onMessage?.(t.config.importConfigSuccess)
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    }
    catch (error) {
      console.error('Import failed:', error)
      onMessage?.(`${t.config.importConfigFailed}: ${error instanceof Error ? error.message : ''}`)
    }
    finally {
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
          description={t.config.resetConfigDesc || 'Reset all configurations to default values. This action cannot be undone.'}
          buttonText={t.config.resetConfig}
          onClick={() => setResetConfirmOpen(true)}
          variant="danger"
          layout="horizontal"
        />
      </SettingGroup>

      {/* Reset Confirmation Modal */}
      {resetConfirmOpen && (
        <div className="modal-overlay" onClick={() => setResetConfirmOpen(false)}>
          <div className="modal-content modal-small" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title text-danger">{t.config.resetConfig}</h3>
              <button onClick={() => setResetConfirmOpen(false)} className="modal-close-button" title="Close">
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-base text-gray-600 dark:text-gray-300">
                {t.config.resetConfirmMessage || 'Are you sure you want to reset all configurations? This action cannot be undone and will restore all settings to their default values.'}
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
        <div className="modal-overlay" onClick={() => { setImportConfirmOpen(false); setPendingImportData(null) }}>
          <div className="modal-content modal-small" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{t.config.importConfig}</h3>
              <button onClick={() => { setImportConfirmOpen(false); setPendingImportData(null) }} className="modal-close-button" title="Close">
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
                onClick={() => { setImportConfirmOpen(false); setPendingImportData(null) }}
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
