import { useCallback, useState } from 'react'
import { fetchConfig } from '../../../lib/api'
import type { PlatformAutoFetchConfig } from '../PlatformAutoRefreshSettings'
import { sanitizeMaskedFieldValue } from '../PlatformsConfigSection'
import { DEFAULT_AUTO_FETCH_CONFIG } from './defaults'
import type { Config, ShowMessage } from './types'

export function useConfigBagState(
  showMessage: ShowMessage,
  loadFailedMessage: string,
) {
  const [config, setConfig] = useState<Config | null>(null)
  const [initialConfig, setInitialConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const notifyDirtyState = useCallback((dirty: boolean) => {
    window.dispatchEvent(
      new CustomEvent('config-dirty-state', {
        detail: { dirty },
      }),
    )
  }, [])

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchConfig()
      const normalizedData = {
        ...data,
        auto_fetch: data.auto_fetch || DEFAULT_AUTO_FETCH_CONFIG,
      }
      setConfig(normalizedData)
      setInitialConfig(JSON.parse(JSON.stringify(normalizedData)))
      notifyDirtyState(false)
      window.dispatchEvent(new CustomEvent('config-loaded', { detail: data }))
    } catch {
      showMessage(loadFailedMessage, 'error')
    } finally {
      setLoading(false)
    }
  }, [loadFailedMessage, notifyDirtyState, showMessage])

  const updateConfigField = useCallback(
    (
      section: 'ai' | 'ui',
      fieldKey: string,
      value: string,
      providerFieldKey?: string,
      options?: { silent?: boolean },
    ) => {
      if (!config) return

      const sectionKey = `${section}_config` as 'ai_config' | 'ui_config'
      const sectionConfig = config[sectionKey]
      const sanitized = sanitizeMaskedFieldValue(value)
      const newFields = sectionConfig.config_fields.map((f) =>
        f.key === fieldKey ? { ...f, value: sanitized } : f,
      )
      const fieldExists = sectionConfig.config_fields.some(
        (f) => f.key === fieldKey,
      )
      if (!fieldExists) return

      const nextSection =
        providerFieldKey && fieldKey === providerFieldKey
          ? { ...sectionConfig, provider: sanitized, config_fields: newFields }
          : { ...sectionConfig, config_fields: newFields }

      setConfig({ ...config, [sectionKey]: nextSection })

      if (options?.silent) {
        setInitialConfig((prev) => {
          if (!prev) return prev
          const prevSection = prev[sectionKey]
          if (!prevSection) return prev
          const prevFields = prevSection.config_fields.map((f) =>
            f.key === fieldKey ? { ...f, value: sanitized } : f,
          )
          const nextPrevSection =
            providerFieldKey && fieldKey === providerFieldKey
              ? {
                  ...prevSection,
                  provider: sanitized,
                  config_fields: prevFields,
                }
              : { ...prevSection, config_fields: prevFields }
          return { ...prev, [sectionKey]: nextPrevSection }
        })
      } else {
        notifyDirtyState(true)
      }
    },
    [config, notifyDirtyState],
  )

  const updateFieldValue = useCallback(
    (platformIndex: number, fieldKey: string, value: string) => {
      if (!config) return
      const newPlatforms = [...config.platforms]
      const field = newPlatforms[platformIndex].config_fields.find(
        (f) => f.key === fieldKey,
      )
      if (field) {
        field.value = sanitizeMaskedFieldValue(value)
        setConfig({ ...config, platforms: newPlatforms })
        notifyDirtyState(true)
      }
    },
    [config, notifyDirtyState],
  )

  const updateAiFieldValue = useCallback(
    (fieldKey: string, value: string) => {
      updateConfigField('ai', fieldKey, value, 'provider')
    },
    [updateConfigField],
  )

  const updateUiFieldValue = useCallback(
    (fieldKey: string, value: string, options?: { silent?: boolean }) => {
      updateConfigField('ui', fieldKey, value, undefined, options)
    },
    [updateConfigField],
  )

  const togglePlatform = useCallback(
    (platformIndex: number) => {
      if (!config) return
      const newPlatforms = [...config.platforms]
      newPlatforms[platformIndex].enabled = !newPlatforms[platformIndex].enabled
      setConfig({ ...config, platforms: newPlatforms })
      notifyDirtyState(true)
    },
    [config, notifyDirtyState],
  )

  const updateAutoFetchConfig = useCallback(
    (auto_fetch: PlatformAutoFetchConfig) => {
      if (!config) return
      setConfig({ ...config, auto_fetch })
      notifyDirtyState(true)
    },
    [config, notifyDirtyState],
  )

  const reorderPlatform = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!config) return
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= config.platforms.length ||
        toIndex >= config.platforms.length
      ) {
        return
      }
      const newPlatforms = [...config.platforms]
      const [moved] = newPlatforms.splice(fromIndex, 1)
      newPlatforms.splice(toIndex, 0, moved)
      setConfig({ ...config, platforms: newPlatforms })
      notifyDirtyState(true)
    },
    [config, notifyDirtyState],
  )

  return {
    config,
    setConfig,
    initialConfig,
    setInitialConfig,
    loading,
    saving,
    setSaving,
    notifyDirtyState,
    loadConfig,
    updateFieldValue,
    updateAiFieldValue,
    updateUiFieldValue,
    togglePlatform,
    updateAutoFetchConfig,
    reorderPlatform,
  }
}
