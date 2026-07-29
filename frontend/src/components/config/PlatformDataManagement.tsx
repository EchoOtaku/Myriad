import type { ToastType } from '../Toast'

import { FaSyncAlt, FaTrash } from '@lib/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_URL } from '../../config'
import { useI18n } from '../../contexts/I18nContext'
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks'
import { getCSRFToken } from '../../utils/csrf'
import { resolvePlatformId } from '../../utils/platformId'
import { notifyRecentActivityUpdated } from '../../utils/recentActivity'
import { TaskStatus } from '../TaskStatus'
import { ButtonItem, SettingGroup } from '../settings'

interface CacheInfo {
  platform: string
  exists: boolean
  size_bytes?: number
  modified_at?: string
  path: string
}

interface PlatformStatus {
  hasRawData: boolean
  rawDataSize: number
  rawFetchedAt: string | null
}

export interface PlatformDataManagementProps {
  platformName: string
  showMessage: (
    message: string,
    type?: ToastType,
    duration?: number,
  ) => void
}

export default function PlatformDataManagement({
  platformName,
  showMessage,
}: PlatformDataManagementProps) {
  const { t } = useI18n()
  const platformId = useMemo(
    () => resolvePlatformId(platformName),
    [platformName],
  )
  const [status, setStatus] = useState<PlatformStatus | null>(null)
  const [cache, setCache] = useState<CacheInfo | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [activeTask, setActiveTask] = useState<string | null>(null)
  const { clearPlatformCache, getPlatformCacheStatus, submitTask } =
    useBackgroundTasks()

  const loadStatus = useCallback(async () => {
    if (!platformId) return

    setStatusLoading(true)
    try {
      const [metadataResponse, cacheInfo] = await Promise.all([
        fetch(`${API_URL}/api/profile/metadata`, {
          credentials: 'include',
        }),
        getPlatformCacheStatus(platformId),
      ])
      const metadataData = await metadataResponse.json()

      if (!metadataResponse.ok || !metadataData.success || !cacheInfo) {
        throw new Error('Unable to load platform data status')
      }

      const platformData = metadataData.data?.[platformId] ?? null
      setStatus({
        hasRawData: Boolean(platformData),
        rawDataSize: platformData
          ? new Blob([JSON.stringify(platformData)]).size
          : 0,
        rawFetchedAt: metadataData.fetched_at ?? null,
      })
      setCache(cacheInfo)
    } catch (error) {
      console.error(`Failed to load ${platformName} data status:`, error)
      showMessage(t.dataManagement.loadStatusFailed, 'error')
    } finally {
      setStatusLoading(false)
    }
  }, [
    getPlatformCacheStatus,
    platformId,
    platformName,
    showMessage,
    t.dataManagement.loadStatusFailed,
  ])

  useEffect(() => {
    setStatus(null)
    setCache(null)
    setActiveTask(null)
    setProcessing(false)
    void loadStatus()
  }, [loadStatus])

  const refreshPlatform = async () => {
    if (!platformId) return
    if (
      !window.confirm(
        t.dataManagement.confirmRefreshData.replace(
          '{platform}',
          platformName,
        ),
      )
    ) {
      return
    }

    setRefreshing(true)
    try {
      const csrfToken = await getCSRFToken(true)
      if (!csrfToken) {
        showMessage(t.dataManagement.csrfTokenError, 'error', 5000)
        return
      }

      const response = await fetch(`${API_URL}/api/profile/fetch-platform`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ platform: platformId }),
      })
      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || `HTTP ${response.status}`)
      }

      notifyRecentActivityUpdated()
      showMessage(
        t.dataManagement.dataRefreshed.replace('{platform}', platformName),
        'success',
        5000,
      )
      await loadStatus()
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : ''
      showMessage(`${t.dataManagement.refreshFailed}${detail}`, 'error', 5000)
    } finally {
      setRefreshing(false)
    }
  }

  const processPlatform = async () => {
    if (!platformId) return

    const taskId = await submitTask(platformId)
    if (!taskId) {
      showMessage(
        t.dataManagement.submitTaskFailed.replace(
          '{platform}',
          platformName,
        ),
        'error',
      )
      return
    }

    setActiveTask(taskId)
    setProcessing(true)
  }

  const clearCache = async () => {
    if (!platformId) return
    if (
      !window.confirm(
        t.dataManagement.confirmClearCache.replace(
          '{platform}',
          platformName,
        ),
      )
    ) {
      return
    }

    setClearing(true)
    try {
      const success = await clearPlatformCache(platformId)
      if (!success) {
        showMessage(
          t.dataManagement.clearCacheFailed.replace(
            '{platform}',
            platformName,
          ),
          'error',
        )
        return
      }

      showMessage(
        t.dataManagement.cacheCleared.replace('{platform}', platformName),
        'success',
      )
      await loadStatus()
    } finally {
      setClearing(false)
    }
  }

  const handleTaskComplete = () => {
    setActiveTask(null)
    setProcessing(false)
    void loadStatus()
  }

  const handleTaskClose = () => {
    setActiveTask(null)
    setProcessing(false)
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const formatDateTime = (date: string | null | undefined): string => {
    if (!date) return t.dataManagement.unknown
    return new Date(date).toLocaleString()
  }

  if (!platformId) return null

  const hasCache = Boolean(cache?.exists)
  const rawStatusText = status?.hasRawData
    ? `${formatBytes(status.rawDataSize)} · ${formatDateTime(
        status.rawFetchedAt,
      )}`
    : t.dataManagement.noData
  const cacheStatusText = hasCache
    ? `${formatBytes(cache?.size_bytes ?? 0)} · ${formatDateTime(
        cache?.modified_at,
      )}`
    : t.dataManagement.noCache

  return (
    <SettingGroup
      title={t.dataManagement.dataManagementTitle}
      detail={t.dataManagement.dataManagementDesc}
      className="platform-data-management"
    >
      {activeTask ? (
        <div className="platform-data-management-task">
          <TaskStatus
            taskId={activeTask}
            onComplete={handleTaskComplete}
            onClose={handleTaskClose}
          />
        </div>
      ) : null}

      <ButtonItem
        itemKey="platform-raw-refresh"
        label={t.dataManagement.rawData}
        description={rawStatusText}
        buttonText={
          refreshing ? t.dataManagement.refreshing : t.dataManagement.refresh
        }
        buttonIcon={<FaSyncAlt />}
        variant="secondary"
        layout="horizontal"
        size="sm"
        loading={refreshing}
        disabled={refreshing || statusLoading}
        onClick={() => void refreshPlatform()}
      />

      <ButtonItem
        itemKey="platform-filter-process"
        label={t.dataManagement.smartFilter}
        description={cacheStatusText}
        buttonText={
          processing ? t.dataManagement.processing : t.dataManagement.process
        }
        variant="primary"
        layout="horizontal"
        size="sm"
        loading={processing}
        disabled={processing || !status?.hasRawData || statusLoading}
        onClick={() => void processPlatform()}
      />

      {hasCache ? (
        <ButtonItem
          itemKey="platform-filter-clear"
          label={t.dataManagement.clearCache}
          description={cacheStatusText}
          buttonText={
            clearing ? t.dataManagement.clearing : t.dataManagement.clear
          }
          buttonIcon={<FaTrash />}
          variant="danger"
          layout="horizontal"
          size="sm"
          loading={clearing}
          disabled={clearing || statusLoading}
          onClick={() => void clearCache()}
        />
      ) : null}
    </SettingGroup>
  )
}
