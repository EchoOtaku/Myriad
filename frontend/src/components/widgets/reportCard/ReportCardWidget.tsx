import type { CardContent } from './CardLogoPill'
import type { ReportCardClickAction, ReportCardWidgetProps } from './types'
/**
 * Report card shell: fetch/coerce platform report, overview flip, host platform faces.
 */
import { motionShim as motion } from '@lib/motionShim'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../../../contexts/I18nContext'
import { useAnimationLevel } from '../../../hooks/useAnimationLevel'
import {
  coerceReportVisuals,
  hasRenderableCardVisuals,
  hasReportDetailContent,
  pickPlatformCardVisuals,
  resolveReportPlatformId,
} from '../../../utils/reportCardVisuals'
import { getLatestReportDeduped } from '../../../utils/requestDedup'
import { GlowBackground } from '../shared/GlowBackground'
import { WidgetShell } from '../shared/WidgetShell'
import { CardLogoPill } from './CardLogoPill'
import { PLATFORM_CONFIG } from './platformConfig'
import { PlatformFace } from './PlatformFace'
import { fetchPlatformUserIds, PLATFORM_SOCIAL } from './platformSocial'
import { buildReportCardPreviewData } from './previewData'
import {
  openReportCardSettingsModal,
  ReportCardSettingsModal,
} from './settingsModal'

export const ReportCardWidget = memo(
  ({
    config,
    isEditMode,
    isPreview,
    data: externalData,
    bare = false,
    showOverview: controlledShowOverview,
    onConfigChange,
  }: ReportCardWidgetProps) => {
    const animLevel = useAnimationLevel()
    const { t } = useI18n()
    const navigate = useNavigate()
    const localRef = useRef<HTMLDivElement | null>(null)
    // Prefer config.platformId; fall back to widget type `report-{platform}` so
    // saved home layouts without nested config still load the right report.
    const platformId = resolveReportPlatformId(config)
    const [reportData, setReportData] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const isOverviewControlled = controlledShowOverview !== undefined
    const [internalShowOverview, setInternalShowOverview] = useState(true)
    const showOverview = isOverviewControlled
      ? controlledShowOverview
      : internalShowOverview
    const [cardContent, setCardContent] = useState<CardContent>(null)

    useEffect(() => {
      if (isPreview) {
        setReportData(buildReportCardPreviewData(platformId, t))
        setLoading(false)
        return
      }

      // 外部直接提供数据（报告页复用）：不再自行请求，跟随 prop 更新
      if (externalData !== undefined) {
        // Coerce full PlatformReport JSON → flat card_visuals the widgets read.
        // Without this, nested card_visuals leaves reportData truthy but empty UI.
        const visuals = coerceReportVisuals(externalData)
        setReportData(hasRenderableCardVisuals(visuals) ? visuals : null)
        setLoading(false)
        return
      }

      // Home path: fetch site-owner latest reports and map to this platform's
      // card_visuals. Guard against unmount races so a cancelled fetch cannot
      // leave loading forever or wipe a newer successful result.
      let cancelled = false
      const fetchReport = async (forceRefresh = false) => {
        try {
          // 使用去重机制避免多个 ReportCardWidget 同时请求
          let data = await getLatestReportDeduped({ forceRefresh })
          if (cancelled) return
          // Fail closed on empty / mismatched mapping so home never mounts a
          // blank shell when card_visuals is missing or {}.
          let visuals = pickPlatformCardVisuals(data, platformId)
          // One forced re-fetch if mapping missed (stale empty cache / race with generate).
          if (!visuals && !forceRefresh) {
            data = await getLatestReportDeduped({ forceRefresh: true })
            if (cancelled) return
            visuals = pickPlatformCardVisuals(data, platformId)
          }
          setReportData(visuals)
        } catch (err) {
          if (cancelled) return
          console.error(`${t.reportCardWidget.fetchReportFailed}:`, err)
          setReportData(null)
        } finally {
          if (!cancelled) setLoading(false)
        }
      }
      fetchReport()

      // 5分钟刷新一次 - timeout 链 + 可见性暂停
      let timeoutId: number | null = null
      const schedule = () => {
        if (cancelled || document.hidden) return
        fetchReport()
        timeoutId = window.setTimeout(schedule, 5 * 60 * 1000)
      }
      timeoutId = window.setTimeout(schedule, 5 * 60 * 1000)

      const onVisibility = () => {
        if (document.hidden && timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        } else if (!document.hidden && !cancelled && !timeoutId) {
          schedule()
        }
      }
      document.addEventListener('visibilitychange', onVisibility)

      return () => {
        cancelled = true
        if (timeoutId) clearTimeout(timeoutId)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }, [platformId, isPreview, externalData])

    // Detail faces need real material. library_items covers most platforms
    // (covers/guilds); X uses following_highlights/sample after tweet carousel
    // removal. Gating only on library_items stuck low-post X cards on overview.
    const hasDetailContent = useMemo(
      () => hasReportDetailContent(reportData),
      [reportData],
    )

    useEffect(() => {
      // 预览态 / 外部控制概览态时不启用内部自动轮播
      if (isPreview || isOverviewControlled) return
      // No detail material → stay on overview so stats stay visible
      if (!hasDetailContent) {
        setInternalShowOverview(true)
        return
      }

      // 10秒切换概览/详情 - timeout 链 + 可见性暂停
      let cancelled = false
      let timeoutId: number | null = null
      const tick = () => {
        if (cancelled || document.hidden) return
        setInternalShowOverview((prev) => !prev)
        timeoutId = window.setTimeout(tick, 10000)
      }
      timeoutId = window.setTimeout(tick, 10000)

      const onVisibility = () => {
        if (document.hidden && timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        } else if (!document.hidden && !cancelled && !timeoutId) {
          tick()
        }
      }
      document.addEventListener('visibilitychange', onVisibility)

      return () => {
        cancelled = true
        if (timeoutId) clearTimeout(timeoutId)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }, [isPreview, isOverviewControlled, hasDetailContent])

    const handleContentChange = useCallback((content: any) => {
      setCardContent(content)
    }, [])

    // ===== 长按点击行为设置（参考社交组件：编辑模式下按住 500ms 打开设置）=====
    // 仅作为仪表盘小组件时启用（报告页 bare / 预览态不干预）
    const interactive = !bare && !isPreview
    const clickAction: ReportCardClickAction =
      config.config?.clickAction === 'social' ? 'social' : 'report'

    const [socialUserId, setSocialUserId] = useState<string | undefined>(
      undefined,
    )
    useEffect(() => {
      if (!interactive || clickAction !== 'social') return
      let alive = true
      fetchPlatformUserIds().then((m) => {
        if (alive) setSocialUserId(m[platformId])
      })
      return () => {
        alive = false
      }
    }, [interactive, clickAction, platformId])

    const isLongPressRef = useRef(false)
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const applyClickAction = useCallback(
      (action: ReportCardClickAction) => {
        const nextConfig = { ...config.config, platformId, clickAction: action }
        if (typeof onConfigChange === 'function') {
          onConfigChange(nextConfig)
        } else {
          window.dispatchEvent(
            new CustomEvent('widget-config-update', {
              detail: {
                widgetId: config.id,
                config: nextConfig,
              },
            }),
          )
        }
        isLongPressRef.current = false
      },
      [config.id, config.config, onConfigChange, platformId],
    )

    const openSettings = useCallback(() => {
      if (!localRef.current) return
      openReportCardSettingsModal(
        clickAction,
        localRef.current.getBoundingClientRect(),
        applyClickAction,
        () => {
          isLongPressRef.current = false
        },
      )
    }, [applyClickAction, clickAction])

    const handlePressStart = useCallback(() => {
      if (!interactive || !isEditMode) return
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
      }
      isLongPressRef.current = false
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null
        isLongPressRef.current = true
        openSettings()
      }, 500)
    }, [interactive, isEditMode, openSettings])

    const handlePressEnd = useCallback(() => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }, [])

    useEffect(() => {
      return () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current)
        }
        isLongPressRef.current = false
      }
    }, [])

    const handleCardClick = useCallback(() => {
      // 长按触发的设置不当作点击
      if (isLongPressRef.current) {
        isLongPressRef.current = false
        return
      }
      if (!interactive || isEditMode) return
      if (clickAction === 'social' && socialUserId) {
        window.open(
          PLATFORM_SOCIAL[platformId]?.getUserUrl(socialUserId) || '#',
          '_blank',
          'noopener,noreferrer',
        )
        return
      }
      // report 模式，或社交模式下未配置用户ID的兜底
      navigate('/reports')
    }, [
      interactive,
      isEditMode,
      clickAction,
      socialUserId,
      platformId,
      navigate,
    ])

    const handleMouseLeave = useCallback(() => {
      handlePressEnd()
    }, [handlePressEnd])

    if (loading) {
      return (
        <div className="h-full w-full flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      )
    }
    if (!reportData) {
      return (
        <div className="h-full w-full flex items-center justify-center text-gray-400 text-sm">
          <span>{t.reportCard.noReportData}</span>
        </div>
      )
    }

    const platformConfig =
      PLATFORM_CONFIG[platformId] || PLATFORM_CONFIG.bilibili

    return (
      <WidgetShell
        containerRef={localRef}
        padding={0}
        // `contents` drops the inner padding wrapper box so absolute/full-height
        // platform widgets size against the shell root (home empty-face fix).
        contentClassName="contents"
        glass={!bare}
        className={interactive && !isEditMode ? 'cursor-pointer' : ''}
        rootProps={{
          onClick: interactive ? handleCardClick : undefined,
          onMouseDown: interactive ? handlePressStart : undefined,
          onMouseUp: interactive ? handlePressEnd : undefined,
          onMouseLeave: interactive ? handleMouseLeave : undefined,
          onTouchStart: interactive ? handlePressStart : undefined,
          onTouchEnd: interactive ? handlePressEnd : undefined,
          onTouchCancel: interactive ? handlePressEnd : undefined,
        }}
        background={
          /* 动态背景光效（bare 模式下由外层容器负责，避免重复叠加） */
          !bare && (
            <GlowBackground
              color={platformConfig.color}
              animLevel={animLevel.level}
              shouldAnimate={animLevel.loop}
              variant="single"
              size="lg"
            />
          )
        }
      >
        {/* 主内容区：fill the shell root so h-full platform widgets paint */}
        <div className="absolute inset-0 z-10 flex min-h-0 flex-col">
          <PlatformFace
            platformId={platformId}
            data={reportData}
            showOverview={showOverview}
            onContentChange={handleContentChange}
            allowLoop={animLevel.loop}
          />
        </div>

        <CardLogoPill platformId={platformId} cardContent={cardContent} />

        {/* 长按设置提示（编辑模式）- 与社交网络小组件保持一致 */}
        {interactive && isEditMode && (
          <motion.div
            className="absolute top-1.5 right-1.5 z-30 w-5 h-5 rounded-md flex items-center justify-center bg-black/15 dark:bg-white/15 backdrop-blur-sm pointer-events-none"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            title={t.platformCard.longPressHint}
          >
            <svg
              className="w-3 h-3 text-gray-700 dark:text-gray-200"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </motion.div>
        )}
      </WidgetShell>
    )
  },
)

ReportCardWidget.displayName = 'ReportCardWidget'

export { ReportCardSettingsModal }
