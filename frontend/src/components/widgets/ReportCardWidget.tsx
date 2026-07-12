/**
 * 报告页平台卡片小组件 - 完整版（非阉割）
 * 完全复用 Reports.tsx 中的所有子组件实现
 */

import type { AnimationConfig } from '../../hooks/useAnimationLevel'
import type { WidgetConfig } from '../WidgetGrid'
import {
  FaBolt,
  FaGithub,
  FaPlay,
  FaSteam,
  FaTimes,
  FaXbox,
  FaXTwitter,
  LuGitFork,
  LuStar,
  SiBangumi,
  SiBilibili,
  SiMyanimelist,
  SiNeteasecloudmusic,
  SiPlaystation,
} from '@lib/icons'

import {
  AnimatePresenceShim as AnimatePresence,
  motionShim as motion,
} from '@lib/motionShim'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { API_URL } from '../../config'
import { useI18n } from '../../contexts/I18nContext'
import { useLoopAnimation } from '../../hooks/animation'
import { useAnimationLevel } from '../../hooks/useAnimationLevel'
import { getLatestReportDeduped } from '../../utils/requestDedup'
import { RatingBadge } from '../RatingBadge'

// 语言构成条分段类型
interface LangSegment {
  name: string
  pct: number
  delay: number
  duration: number
}

type ReportCardClickAction = 'report' | 'social'

interface SteamPresence {
  personastate?: number
  personastate_label?: string
  is_online?: boolean
  is_in_game?: boolean
  gameextrainfo?: string | null
  gameid?: string | null
  avatar?: string | null
  personaname?: string | null
  recent_2weeks_minutes?: number | null
}

// 🔧 性能优化：预生成热力图网格索引，避免在渲染时调用 Array.from
const HEATMAP_WEEKS = Array.from({ length: 12 }, (_, i) => i)
const HEATMAP_DAYS = Array.from({ length: 5 }, (_, i) => i)
const LANES_ARRAY = Array.from({ length: 5 }, (_, i) => i)

// ==================== 静态动画常量（避免每次渲染创建新对象）====================
// 弹幕动画 - 有限次数，配合调度器 duration=11000ms
const DANMAKU_INITIAL = { x: '100%', opacity: 0 }
const DANMAKU_ANIMATE = { x: '-100%', opacity: [0, 1, 1, 0] }
function createDanmakuTransition(duration: number, delay: number) {
  return {
    repeat: 0, // 只运行一轮，由调度器控制重新播放
    duration,
    delay,
    ease: 'linear' as const,
  }
}

// 内容切换动画
const CONTENT_FADE_INITIAL = { opacity: 0 }
const CONTENT_FADE_ANIMATE = { opacity: 1 }
const CONTENT_FADE_EXIT = { opacity: 0 }
const CONTENT_FADE_TRANSITION = { duration: 0.5 }

const CONTENT_SLIDE_INITIAL = { opacity: 0, y: 10 }
const CONTENT_SLIDE_ANIMATE = { opacity: 1, y: 0 }
const CONTENT_SLIDE_EXIT = { opacity: 0, y: -10 }
const CONTENT_SLIDE_TRANSITION = { duration: 0.5 }

export interface ReportCardWidgetProps {
  config: WidgetConfig
  isEditMode: boolean
  isPreview?: boolean
  /** 外部直接提供 card_visuals，提供时不再自行请求（用于报告页复用） */
  data?: any
  /** 去掉自带 glass 外壳与背景光效，供已有外壳的容器内嵌 */
  bare?: boolean
  /**
   * 外部控制概览/详情切换（如舞台模式按篇章驱动）。
   * 传入后禁用内部 10s 自动轮播，与外部状态完全同步。
   */
  showOverview?: boolean
  /** 小组件配置变更回调（用于持久化长按设置） */
  onConfigChange?: (newConfig: any) => void
}

// 各平台社交主页链接（长按设置里“打开社交主页”用）
const PLATFORM_SOCIAL: Record<
  string,
  { publicName: string, fieldKey: string, getUserUrl: (id: string) => string }
> = {
  bilibili: {
    publicName: 'Bilibili',
    fieldKey: 'uid',
    getUserUrl: (u) => `https://space.bilibili.com/${u}`,
  },
  steam: {
    publicName: 'Steam',
    fieldKey: 'steam_id',
    getUserUrl: (u) => `https://steamcommunity.com/profiles/${u}`,
  },
  github: {
    publicName: 'GitHub',
    fieldKey: 'username',
    getUserUrl: (u) => `https://github.com/${u}`,
  },
  netease: {
    publicName: 'Netease Music',
    fieldKey: 'user_id',
    getUserUrl: (u) => `https://music.163.com/#/user/home?id=${u}`,
  },
  bangumi: {
    publicName: 'Bangumi',
    fieldKey: 'username',
    getUserUrl: (u) => `https://bgm.tv/user/${u}`,
  },
  mal: {
    publicName: 'MyAnimeList',
    fieldKey: 'username',
    getUserUrl: (u) => `https://myanimelist.net/profile/${u}`,
  },
  x: {
    publicName: 'X',
    fieldKey: 'username',
    getUserUrl: (u) => `https://x.com/${String(u).replace(/^@/, '')}`,
  },
}

// 从公开配置取各平台用户ID（模块级缓存，避免重复请求）
let cachedUserIds: Record<string, string> | null = null
let userIdsPromise: Promise<Record<string, string>> | null = null
async function fetchPlatformUserIds(): Promise<Record<string, string>> {
  if (cachedUserIds) return cachedUserIds
  if (userIdsPromise) return userIdsPromise
  userIdsPromise = (async () => {
    const map: Record<string, string> = {}
    try {
      const res = await fetch(`${API_URL}/api/config/public`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.platforms)) {
          for (const p of data.platforms) {
            if (!p.enabled) continue
            const entry = Object.entries(PLATFORM_SOCIAL).find(
              ([, s]) => s.publicName === p.name,
            )
            if (!entry) continue
            const [pid, s] = entry
            const field = (p.config_fields || []).find(
              (f: { key: string, value?: string }) =>
                f.key === s.fieldKey && f.value,
            )
            if (field) map[pid] = field.value as string
          }
        }
      }
    } catch {
      // 静默：拿不到就走报告页兜底
    }
    cachedUserIds = map
    return map
  })()
  return userIdsPromise
}

let cachedSteamPresence: SteamPresence | null = null
let cachedSteamPresenceAt = 0
let steamPresencePromise: Promise<SteamPresence | null> | null = null
async function fetchSteamPresence(
  maxAgeMs = 45 * 1000,
): Promise<SteamPresence | null> {
  if (
    cachedSteamPresence &&
    Date.now() - cachedSteamPresenceAt < maxAgeMs
  ) {
    return cachedSteamPresence
  }
  if (steamPresencePromise) return steamPresencePromise

  steamPresencePromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/steam/presence`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return null
      const body = await res.json()
      if (body?.success && body?.data) {
        cachedSteamPresence = body.data as SteamPresence
        cachedSteamPresenceAt = Date.now()
        return cachedSteamPresence
      }
    } catch {
      // Steam 状态属于增强信息，失败时保留报告卡片原内容。
    } finally {
      steamPresencePromise = null
    }
    return null
  })()

  return steamPresencePromise
}

function getSteamPresenceFromData(data: any): SteamPresence | null {
  if (!data) return null
  if (
    data.personastate === undefined &&
    data.persona_state === undefined &&
    data.personastate_label === undefined &&
    data.online_status === undefined &&
    data.gameextrainfo === undefined &&
    data.avatar === undefined
  ) {
    return null
  }

  const personastate = data.personastate ?? data.persona_state
  const state =
    typeof personastate === 'number'
      ? personastate
      : Number.isFinite(Number(personastate))
        ? Number(personastate)
        : undefined
  const gameextrainfo =
    typeof data.gameextrainfo === 'string' ? data.gameextrainfo : null
  const gameid =
    typeof data.gameid === 'string' || typeof data.gameid === 'number'
      ? String(data.gameid)
      : null

  return {
    personastate: state,
    personastate_label:
      typeof data.personastate_label === 'string'
        ? data.personastate_label
        : typeof data.online_status === 'string'
          ? data.online_status
          : undefined,
    is_online:
      typeof data.is_online === 'boolean'
        ? data.is_online
        : state !== undefined
          ? state !== 0
          : undefined,
    is_in_game:
      typeof data.is_in_game === 'boolean'
        ? data.is_in_game
        : Boolean(gameextrainfo || gameid),
    gameextrainfo,
    gameid,
    avatar: typeof data.avatar === 'string' ? data.avatar : null,
    personaname:
      typeof data.personaname === 'string' ? data.personaname : null,
    recent_2weeks_minutes:
      typeof data.recent_2weeks_minutes === 'number'
        ? data.recent_2weeks_minutes
        : null,
  }
}

interface ReportCardSettingsModalState {
  isOpen: boolean
  selectedAction: ReportCardClickAction
  anchorRect?: DOMRect
  onSelect?: (action: ReportCardClickAction) => void
  onClose?: () => void
}

let reportCardSettingsModalState: ReportCardSettingsModalState = {
  isOpen: false,
  selectedAction: 'report',
}

const reportCardSettingsModalListeners: Set<() => void> = new Set()
const REPORT_CARD_SETTINGS_MODAL_WIDTH = 286
const REPORT_CARD_SETTINGS_MODAL_HEIGHT = 106
const REPORT_CARD_SETTINGS_MODAL_PADDING = 12

function openReportCardSettingsModal(
  selectedAction: ReportCardClickAction,
  anchorRect: DOMRect,
  onSelect: (action: ReportCardClickAction) => void,
  onClose?: () => void,
) {
  reportCardSettingsModalState = {
    isOpen: true,
    selectedAction,
    anchorRect,
    onSelect,
    onClose,
  }
  reportCardSettingsModalListeners.forEach((listener) => listener())
}

function closeReportCardSettingsModal() {
  const onClose = reportCardSettingsModalState.onClose
  reportCardSettingsModalState = {
    ...reportCardSettingsModalState,
    isOpen: false,
    onClose: undefined,
  }
  onClose?.()
  reportCardSettingsModalListeners.forEach((listener) => listener())
}

function subscribeToReportCardSettingsModal(listener: () => void) {
  reportCardSettingsModalListeners.add(listener)
  return () => {
    reportCardSettingsModalListeners.delete(listener)
  }
}

const ReportCardSettingsModal = memo(() => {
  const [, forceUpdate] = useState({})
  const { t } = useI18n()
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return subscribeToReportCardSettingsModal(() => {
      forceUpdate({})
    })
  }, [])

  const { isOpen, selectedAction, anchorRect, onSelect } =
    reportCardSettingsModalState

  const position = useMemo(() => {
    if (!anchorRect) return { top: 0, left: 0 }

    let top = anchorRect.bottom + 8
    let left =
      anchorRect.left +
      (anchorRect.width - REPORT_CARD_SETTINGS_MODAL_WIDTH) / 2

    if (
      left + REPORT_CARD_SETTINGS_MODAL_WIDTH >
      window.innerWidth - REPORT_CARD_SETTINGS_MODAL_PADDING
    ) {
      left =
        window.innerWidth -
        REPORT_CARD_SETTINGS_MODAL_WIDTH -
        REPORT_CARD_SETTINGS_MODAL_PADDING
    }
    if (left < REPORT_CARD_SETTINGS_MODAL_PADDING) {
      left = REPORT_CARD_SETTINGS_MODAL_PADDING
    }
    if (
      top + REPORT_CARD_SETTINGS_MODAL_HEIGHT >
      window.innerHeight - REPORT_CARD_SETTINGS_MODAL_PADDING
    ) {
      top = anchorRect.top - REPORT_CARD_SETTINGS_MODAL_HEIGHT - 8
    }
    if (top < REPORT_CARD_SETTINGS_MODAL_PADDING) {
      top = REPORT_CARD_SETTINGS_MODAL_PADDING
    }

    return { top, left }
  }, [anchorRect])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        closeReportCardSettingsModal()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeReportCardSettingsModal()
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, {
        passive: true,
      })
      document.addEventListener('keydown', handleKeyDown)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleSelect = useCallback(
    (action: ReportCardClickAction) => {
      onSelect?.(action)
      closeReportCardSettingsModal()
    },
    [onSelect],
  )

  if (!isOpen) return null

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-10000"
      style={{ pointerEvents: 'none' }}
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95, y: -5 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -5 }}
        transition={{ duration: 0.15 }}
        className="absolute glass rounded-xl shadow-xl overflow-hidden border border-white/15 dark:border-white/10 p-3"
        style={{
          top: position.top,
          left: position.left,
          width: REPORT_CARD_SETTINGS_MODAL_WIDTH,
          pointerEvents: 'auto',
        }}
      >
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
            {t.platformCard.settingsTitle}
          </span>
          <button
            type="button"
            onClick={closeReportCardSettingsModal}
            className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <FaTimes className="w-2.5 h-2.5 text-gray-500" />
          </button>
        </div>

        <div className="flex gap-2.5">
          {(['social', 'report'] as const).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => handleSelect(action)}
              className={`flex-1 px-4 py-3 rounded-lg text-xs font-bold text-center transition-all ${
                selectedAction === action
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'bg-black/5 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-black/10 dark:hover:bg-white/15'
              }`}
            >
              {action === 'social'
                ? t.platformCard.clickToSocial
                : t.platformCard.clickToReport}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
})

ReportCardSettingsModal.displayName = 'ReportCardSettingsModal'

// ==================== 工具函数 ====================
function getBilibiliProxyUrl(cover?: string, title?: string): string {
  if (!cover) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(title || 'B')}&size=400&background=00A1D6&color=fff`
  }
  if (cover.startsWith('/api/proxy/')) return cover
  if (cover.includes('hdslb.com') || cover.includes('bilibili.com')) {
    return `${API_URL || ''}/api/proxy/image?url=${encodeURIComponent(cover)}`
  }
  return cover
}

function useLibraryItemRotation(libraryItems: any[], showOverview: boolean) {
  const [currentItemIndex, setCurrentItemIndex] = useState(0)
  const prevShowOverviewRef = useRef(showOverview)

  useEffect(() => {
    // 当从概览模式切换到库项目模式时，更新索引
    if (
      prevShowOverviewRef.current &&
      !showOverview &&
      libraryItems.length > 0
    ) {
      setCurrentItemIndex((prev) => (prev + 1) % libraryItems.length)
    }
    prevShowOverviewRef.current = showOverview
  }, [showOverview, libraryItems.length])

  return { currentItem: libraryItems[currentItemIndex], currentItemIndex }
}

// ==================== B站组件（完整版）====================
const DanmakuWidget = memo(
  ({
    data,
    allowLoop = true,
    triggerKey,
  }: {
    data?: { danmaku?: string[] }
    allowLoop?: boolean
    triggerKey?: unknown
  }) => {
    const { t } = useI18n()
    const defaultDanmaku = t.reportCard.danmakuDefault as unknown as string[]
    const texts = useMemo(
      () => data?.danmaku || defaultDanmaku,
      [data?.danmaku, defaultDanmaku],
    )

    // 🆕 使用触发式动画 - triggerKey 变化时播放一轮，完成后自动释放
    useLoopAnimation({
      duration: 11000, // 弹幕滚动约8秒 + 额外保持3秒
      trigger: triggerKey, // 状态切换时触发
      enabled: allowLoop, // 低端设备禁用
    })

    // 🆕 低性能模式：限制弹幕数量不超过3条
    // 🔧 用 useMemo 锁定：仅在 loop 状态变化时重算随机，避免每次渲染重新洗牌弹幕
    const maxDanmakuCount = useMemo(
      () =>
        allowLoop
          ? Math.random() < 0.7
            ? Math.random() < 0.5
              ? 3
              : 4
            : 5
          : 3,
      [allowLoop],
    )

    const animations = useMemo(() => {
      // 🔧 使用预生成的 LANES_ARRAY 进行洗牌
      const availableLanes = [...LANES_ARRAY]
      for (let i = availableLanes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[availableLanes[i], availableLanes[j]] = [
          availableLanes[j],
          availableLanes[i],
        ]
      }
      return texts.slice(0, maxDanmakuCount).map((_, i) => ({
        duration: 6 + Math.random() * 4,
        delay: i * 0.7 + Math.random() * 0.5,
        top: `${10 + availableLanes[i] * 18}%`,
        opacity: 0.4 + Math.random() * 0.3,
      }))
    }, [texts, maxDanmakuCount])

    return (
      <div className="relative h-full w-full overflow-hidden">
        {animations.map((anim, i) => (
          <motion.div
            key={`${texts[i]}-${i}`}
            initial={DANMAKU_INITIAL}
            animate={DANMAKU_ANIMATE}
            transition={createDanmakuTransition(anim.duration, anim.delay)}
            className="absolute whitespace-nowrap text-base font-bold danmaku-text-color gpu-accelerated"
            style={{
              top: anim.top,
              opacity: anim.opacity,
            }}
          >
            {texts[i]}
          </motion.div>
        ))}
      </div>
    )
  },
)
DanmakuWidget.displayName = 'DanmakuWidget'

const BilibiliWidget = memo(
  ({ data, showOverview, onContentChange, allowLoop = true }: any) => {
    const libraryItems = useMemo(
      () => data?.library_items || [],
      [data?.library_items],
    )
    const { currentItem, currentItemIndex } = useLibraryItemRotation(
      libraryItems,
      showOverview,
    )

    useEffect(() => {
      if (!showOverview && currentItem) {
        onContentChange?.({ title: currentItem.title, type: currentItem.type })
      } else {
        onContentChange?.(null)
      }
    }, [showOverview, currentItem, onContentChange])

    return (
      <AnimatePresence mode="wait">
        {showOverview || !currentItem ? (
          <motion.div
            key="danmaku"
            initial={CONTENT_FADE_INITIAL}
            animate={CONTENT_FADE_ANIMATE}
            exit={CONTENT_FADE_EXIT}
            transition={CONTENT_FADE_TRANSITION}
            className="h-full w-full"
          >
            <DanmakuWidget
              data={data}
              allowLoop={allowLoop}
              triggerKey={showOverview}
            />
          </motion.div>
        ) : (
          <motion.div
            key={`lib-${currentItemIndex}`}
            initial={CONTENT_SLIDE_INITIAL}
            animate={CONTENT_SLIDE_ANIMATE}
            exit={CONTENT_SLIDE_EXIT}
            transition={CONTENT_SLIDE_TRANSITION}
            className="h-full w-full p-1.5"
          >
            <div className="relative h-full w-full rounded-xl overflow-hidden shadow-lg bg-white dark:bg-black/90">
              <div className="absolute inset-0">
                <img
                  src={getBilibiliProxyUrl(
                    currentItem.cover,
                    currentItem.title,
                  )}
                  alt={currentItem.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-transparent" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    )
  },
)

// ==================== Steam组件（完整版）====================
function getSteamPresenceText(
  presence: SteamPresence | null,
  t: ReturnType<typeof useI18n>['t'],
): string | null {
  if (!presence) return null
  if (presence.is_in_game && presence.gameextrainfo) {
    return `${t.reportCardWidget.steamPlaying}: ${presence.gameextrainfo}`
  }

  switch (presence.personastate_label) {
    case 'online':
      return t.reportCardWidget.steamOnline
    case 'busy':
      return t.reportCardWidget.steamBusy
    case 'away':
      return t.reportCardWidget.steamAway
    case 'snooze':
      return t.reportCardWidget.steamSnooze
    case 'looking_to_trade':
      return t.reportCardWidget.steamLookingToTrade
    case 'looking_to_play':
      return t.reportCardWidget.steamLookingToPlay
    case 'offline':
      return t.reportCardWidget.steamOffline
    default:
      if (presence.is_online === true) return t.reportCardWidget.steamOnline
      if (presence.is_online === false) return t.reportCardWidget.steamOffline
      return t.reportCardWidget.steamStatusUnknown
  }
}

function getSteamPresenceColor(presence: SteamPresence | null): string {
  if (!presence) return '#9ca3af'
  if (presence.is_in_game) return '#3b82f6'

  switch (presence.personastate_label) {
    case 'online':
      return '#22c55e'
    case 'busy':
      return '#ef4444'
    case 'away':
    case 'snooze':
      return '#f59e0b'
    case 'looking_to_trade':
    case 'looking_to_play':
      return '#8b5cf6'
    default:
      return presence.is_online ? '#22c55e' : '#9ca3af'
  }
}

// 分数滚动计数：一次性 rAF 动画，duration<=0 时直接返回终值（降级/低端设备）
// 同一个值驱动数字与进度条宽度，保证两者完全同步；
// delay 让计数等卡片入场动画完成后再开跑，增长过程不会被淡入盖掉
function useCountUp(value: number, duration = 800, delay = 0) {
  const [display, setDisplay] = useState(() => (duration > 0 ? 0 : value))

  useEffect(() => {
    if (duration <= 0) {
      setDisplay(value)
      return
    }
    let raf = 0
    const start = performance.now() + delay
    const tick = (now: number) => {
      // delay 期间 p 被夹在 0，setState(0) 与旧值相同时 React 会跳过重渲染
      const p = Math.min(Math.max((now - start) / duration, 0), 1)
      const eased = 1 - (1 - p) ** 3
      setDisplay(Math.round(value * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, delay])

  return display
}

// 评分能量条分段数
const SCORE_BAR_SEGMENTS = 10

// 评分卡内容：抽成组件，使计数/进度条在每次轮播入场时重新播放
const ScoreCardBody = memo(
  ({
    score,
    type,
    anim,
  }: {
    score: number
    type: string
    anim: AnimationConfig
  }) => {
    const { t } = useI18n()
    // 延迟 300ms 起跑：等卡片与分数行入场完成，增长过程完整可见
    const displayScore = useCountUp(
      score,
      Math.round(900 * anim.durationScale),
      300,
    )
    const pct = Math.min(Math.max(displayScore, 0), 100)

    return (
      <>
        {/* 标题「游戏力评分」+ 分段能量条（缩短，与标题同排） */}
        <motion.div
          className="flex items-center justify-between gap-2"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.12 }}
        >
          <span className="flex shrink-0 items-center gap-1">
            <FaBolt className="h-2.5 w-2.5 shrink-0 text-[#66c0f4]" />
            <span className="bg-linear-to-r from-gray-700 to-[#417a9b] bg-clip-text text-[11px] font-black italic tracking-tight text-transparent dark:from-gray-100 dark:to-[#66c0f4]">
              {t.reportCardWidget.steamGamingScore}
            </span>
          </span>
          <div className="flex h-1.5 w-16 shrink-0 gap-[3px]">
            {Array.from({ length: SCORE_BAR_SEGMENTS }).map((_, i) => {
              const lit = i < Math.round((pct / 100) * SCORE_BAR_SEGMENTS)
              return (
                <div
                  key={i}
                  className={`h-full flex-1 rounded-[2px] transition-colors duration-150 ${
                    lit
                      ? 'bg-linear-to-b from-[#66c0f4] to-[#417a9b] shadow-[0_0_6px_rgba(102,192,244,0.5)]'
                      : 'bg-black/8 dark:bg-white/10'
                  }`}
                />
              )
            })}
          </div>
        </motion.div>

        {/* 分数 + 类型标签（放大，与分数同排） */}
        <motion.div
          className="flex items-center justify-between gap-2.5"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <span className="flex shrink-0 items-baseline gap-0.5">
            {/* tabular-nums：计数过程数字等宽，右侧内容不抖动 */}
            <span className="text-3xl font-black leading-none tracking-tight tabular-nums text-gray-800 dark:text-gray-100">
              {displayScore}
            </span>
            <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
              /100
            </span>
          </span>
          {/* 类型标签：切角徽章，像游戏内稀有度/成就标签 */}
          <motion.span
            className="inline-flex min-w-0 items-center gap-1.5 bg-gray-800/90 py-1 pl-2.5 pr-3 dark:bg-white/90"
            style={{
              clipPath:
                'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)',
            }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              anim.spring
                ? { type: 'spring', stiffness: 300, damping: 20, delay: 0.22 }
                : { duration: 0.25, delay: 0.22 }
            }
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full bg-[#66c0f4] ${anim.loop ? 'animate-pulse' : ''}`}
            />
            <span className="truncate text-[10px] font-bold uppercase tracking-wide text-gray-100 dark:text-black">
              {type}
            </span>
          </motion.span>
        </motion.div>
      </>
    )
  },
)
ScoreCardBody.displayName = 'ScoreCardBody'

const SteamStatsWidget = memo(({ data }: any) => {
  const { t } = useI18n()
  const anim = useAnimationLevel()
  const fallbackPresence = useMemo(() => getSteamPresenceFromData(data), [data])
  const [livePresence, setLivePresence] = useState<SteamPresence | null>(null)
  const score = useMemo(() => data?.hardcore_score || 0, [data])
  const type = useMemo(
    () => data?.player_type || t.reportCard.casualPlayer,
    [data, t.reportCard.casualPlayer],
  )
  const gamesCount = useMemo(() => data?.games_count || 0, [data])
  const totalPlaytime = useMemo(() => {
    const hours = data?.total_playtime || 0
    return hours >= 1000 ? `${(hours / 1000).toFixed(1)}k` : hours.toString()
  }, [data])
  const presence = livePresence ?? fallbackPresence
  const presenceText = useMemo(
    () => getSteamPresenceText(presence, t),
    [presence, t],
  )
  const presenceColor = useMemo(
    () => getSteamPresenceColor(presence),
    [presence],
  )
  const avatarUrl = useMemo(() => {
    const raw = presence?.avatar?.trim()
    if (!raw) return null
    // Steam 同一 hash 有 无后缀(32) / _medium(64) / _full(184) 三种尺寸，
    // 统一升到 _full，避免拿到小图放大发糊
    return raw.replace(/(_full|_medium)?\.(jpg|png)(\?.*)?$/i, '_full.$2$3')
  }, [presence])
  const isLive = Boolean(presence?.is_online || presence?.is_in_game)
  const nowPlaying =
    presence?.is_in_game && presence?.gameextrainfo
      ? presence.gameextrainfo
      : null
  // 正在玩的游戏图标：用 appid 取 Steam 商店头图（方形裁切），无 appid 时回退到 Steam 图标
  const gameIconUrl =
    nowPlaying && presence?.gameid
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${presence.gameid}/header.jpg`
      : null
  // 近两周游玩时长（小时），无数据时不显示该项
  const recent2wHours = useMemo(() => {
    const minutes = presence?.recent_2weeks_minutes
    if (typeof minutes !== 'number' || minutes <= 0) return null
    const hours = minutes / 60
    return hours >= 10 ? Math.round(hours).toString() : hours.toFixed(1)
  }, [presence])
  // 右列三项统计（顶对齐分数、底对齐内边距，justify-between 均布）
  const statItems = useMemo(
    () => [
      { label: t.reportsPage.library, value: String(gamesCount), unit: '' },
      { label: t.reportsPage.playtime, value: totalPlaytime, unit: 'H' },
      {
        label: t.reportCardWidget.steamRecent2w,
        value: recent2wHours ?? '0',
        unit: 'H',
      },
    ],
    [t, gamesCount, totalPlaytime, recent2wHours],
  )
  // 底部卡槽轮播：游戏中在「正在玩卡」与「评分卡」间循环，不玩时停在评分卡。
  // 低端设备/减少动画时不轮播：游戏中固定正在玩卡（信息优先）。
  const [slotIndex, setSlotIndex] = useState(0)
  useEffect(() => {
    if (!nowPlaying || !anim.loop) {
      setSlotIndex(nowPlaying ? 1 : 0)
      return
    }
    setSlotIndex(1)
    let cancelled = false
    let timeoutId: number | null = null
    const tick = () => {
      if (cancelled || document.hidden) return
      setSlotIndex((prev) => (prev === 0 ? 1 : 0))
      timeoutId = window.setTimeout(tick, 6000)
    }
    timeoutId = window.setTimeout(tick, 6000)

    const onVisibility = () => {
      if (document.hidden && timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      } else if (!document.hidden && !cancelled && !timeoutId) {
        timeoutId = window.setTimeout(tick, 6000)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [nowPlaying, anim.loop])
  const showNowPlaying = Boolean(nowPlaying) && slotIndex === 1

  useEffect(() => {
    let cancelled = false

    const refreshPresence = async () => {
      // 后台标签页跳过请求，回到前台后由下一个 interval tick 恢复
      if (document.hidden) return
      const nextPresence = await fetchSteamPresence()
      if (!cancelled && nextPresence) {
        setLivePresence(nextPresence)
      }
    }

    refreshPresence()
    // 仅在线状态需要实时性，120s 一次足够；后端有 120s 共享缓存，多访客不会各自打 Steam
    const intervalId = window.setInterval(refreshPresence, 120 * 1000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* 背景：Steam 亮蓝对角渐变 */}
      <div className="absolute inset-0 bg-linear-to-br from-[#66c0f4]/25 via-[#66c0f4]/8 to-transparent dark:from-[#66c0f4]/15 dark:via-[#66c0f4]/5 clip-diagonal" />

      {/* 主体：身份块在顶、轮播卡槽沉底，justify-between 撑出中部呼吸带 */}
      <div className="relative z-10 flex h-full flex-col justify-between p-4">
        {/* 身份块：头像 + （昵称/徽章同行 + 指标 tag 行） */}
        <motion.div
          className="flex min-w-0 items-center gap-3"
          initial={{ x: -12, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.45 }}
        >
          <motion.div
            className="relative shrink-0"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileHover={{ scale: 1.05 }}
            transition={
              anim.spring
                ? { type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }
                : { duration: 0.35, delay: 0.1 }
            }
            title={presenceText ?? undefined}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={presence?.personaname || 'Steam'}
                className="h-11 w-11 rounded-xl object-cover shadow-md ring-1 ring-black/10 dark:ring-white/15"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-200/70 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
                <FaSteam className="h-5 w-5 text-gray-400 dark:text-gray-500" />
              </div>
            )}
            {/* 状态点：头像右下角，在线时外圈呼吸扩散 */}
            {presence && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3">
                {isLive && anim.loop && (
                  <span
                    className="absolute inset-0 rounded-full opacity-40 animate-ping"
                    style={{ backgroundColor: presenceColor }}
                  />
                )}
                <span
                  className="absolute inset-0 rounded-full border-2 border-white dark:border-gray-900"
                  style={{ backgroundColor: presenceColor }}
                />
              </span>
            )}
          </motion.div>
          <div className="flex min-w-0 flex-col gap-1.5">
            {/* 昵称；文字描边补足 CJK 字重 */}
            {presence?.personaname && (
              <span
                className="truncate text-base font-black tracking-tight text-gray-800 dark:text-gray-100"
                style={{ WebkitTextStroke: '0.4px currentcolor' }}
              >
                {presence.personaname}
              </span>
            )}
            {/* 三项指标：退化为无背景 tag 行 */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              {statItems.map((item, i) => (
                <motion.span
                  key={item.label}
                  className="flex items-baseline gap-1"
                  initial={{ y: 6, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.35, delay: 0.3 + i * 0.08 }}
                >
                  <span className="flex items-baseline gap-0.5">
                    <span className="text-[11px] font-black leading-none text-gray-800 dark:text-gray-100">
                      {item.value}
                    </span>
                    {item.unit && (
                      <span className="text-[8px] font-bold text-gray-500 dark:text-gray-400">
                        {item.unit}
                      </span>
                    )}
                  </span>
                  <span className="text-[8px] font-bold text-gray-400 dark:text-gray-500">
                    {item.label}
                  </span>
                </motion.span>
              ))}
            </div>
          </div>
        </motion.div>

        {/* 底部卡槽：评分卡 ⇄ 正在玩卡 循环轮播。
            pl 约等于 头像(44)+gap(12) 让左缘对齐昵称文本、越过浮动 Logo；
            整体下移 3px 与上方指标行拉开距离 */}
        <div className="translate-y-[3px] pl-13">
          <div className="relative h-16">
            <AnimatePresence mode="wait">
              {showNowPlaying ? (
                // 正在玩卡：满宽封面横幅 + 压暗渐变 + 播放角标/游戏名
                <motion.div
                  key="playing"
                  className="absolute inset-0 overflow-hidden rounded-xl shadow-sm ring-1 ring-black/10 dark:ring-white/15"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.4 }}
                  title={t.reportCardWidget.steamPlaying}
                >
                  {gameIconUrl ? (
                    <img
                      src={gameIconUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#1b2838]">
                      <FaSteam className="h-6 w-6 text-white/40" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/25 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-1.5">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-gray-900 shadow-md">
                      <FaPlay className="h-2 w-2 translate-x-px" />
                    </span>
                    <span className="truncate text-[11px] font-bold text-white drop-shadow-sm">
                      {nowPlaying}
                    </span>
                  </div>
                </motion.div>
              ) : (
                // 评分卡：类型 + 分数进度条（横向卡片专属，取代圆环）
                <motion.div
                  key="score"
                  className="absolute inset-0 flex flex-col justify-center gap-1 rounded-xl bg-white/45 px-3.5 ring-1 ring-black/5 backdrop-blur-md dark:bg-white/8 dark:ring-white/10"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.4 }}
                >
                  <ScoreCardBody score={score} type={type} anim={anim} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
})

const SteamWidget = memo(({ data, showOverview, onContentChange }: any) => {
  const libraryItems = useMemo(() => data?.library_items || [], [data])
  const { currentItem, currentItemIndex } = useLibraryItemRotation(
    libraryItems,
    showOverview,
  )

  useEffect(() => {
    if (!showOverview && currentItem) {
      onContentChange?.({ title: currentItem.title, type: 'game' })
    } else {
      onContentChange?.(null)
    }
  }, [showOverview, currentItem, onContentChange])

  return (
    <AnimatePresence mode="wait">
      {showOverview || !currentItem ? (
        <motion.div
          key="stats"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="h-full w-full"
        >
          <SteamStatsWidget data={data} />
        </motion.div>
      ) : (
        <motion.div
          key={`lib-${currentItemIndex}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.5 }}
          className="h-full w-full p-1.5"
        >
          <div className="relative h-full w-full rounded-xl overflow-hidden shadow-lg bg-white dark:bg-black/90">
            <div className="absolute inset-0">
              <img
                src={
                  currentItem.cover ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(currentItem.title)}&size=400&background=1b2838&color=fff`
                }
                alt={currentItem.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-transparent" />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

// ==================== GitHub组件（完整版）====================
const GithubStatsWidget = memo(({ data }: any) => {
  const { t } = useI18n()
  const langs = useMemo(() => data?.languages || [], [data?.languages])
  // 语言构成条：模仿 Bangumi 类型占比设计，各色段首尾相接连续填充
  const langSegments = useMemo<LangSegment[]>(() => {
    const items = langs
      .filter((l: any) => l.percentage > 0)
      .sort((a: any, b: any) => b.percentage - a.percentage)
      .slice(0, 4)
    const total = items.reduce((sum: number, l: any) => sum + l.percentage, 0)
    if (total === 0) return []
    const fillDuration = 0.9
    const baseDelay = 0.55
    let acc = 0
    return items.map((lang: any) => {
      const segment: LangSegment = {
        name: lang.name as string,
        pct: (lang.percentage / total) * 100,
        delay: baseDelay + (acc / total) * fillDuration,
        duration: (lang.percentage / total) * fillDuration,
      }
      acc += lang.percentage
      return segment
    })
  }, [langs])
  const level = useMemo(
    () => data?.contribution_level || t.reportCard.beginnerDev,
    [data?.contribution_level, t.reportCard.beginnerDev],
  )
  const contributions = useMemo(
    () => data?.total_contributions || 0,
    [data?.total_contributions],
  )
  const reposCount = useMemo(() => data?.repos_count || 0, [data?.repos_count])
  const totalStars = useMemo(() => data?.total_stars || 0, [data?.total_stars])
  const contributionCalendar = useMemo(
    () => data?.contribution_calendar,
    [data?.contribution_calendar],
  )

  const levelColor = useMemo(() => {
    const colorMap: { [key: string]: string } = {
      [t.reportCardWidget.beginnerDev]: '#22c55e',
      [t.reportCardWidget.intermediateDev]: '#3b82f6',
      [t.reportCardWidget.seniorDev]: '#a855f7',
      [t.reportCardWidget.veteranDev]: '#f97316',
      [t.reportCardWidget.legendaryDev]: '#ef4444',
    }
    return colorMap[level] || '#6b7280'
  }, [level, t])

  const generateHeatmapGrid = () => {
    const grid: Array<{
      week: number
      day: number
      opacity: number
      count: number
    }> = []

    if (contributionCalendar && Array.isArray(contributionCalendar)) {
      const recentDays = contributionCalendar.slice(-60)
      const maxCount = Math.max(...recentDays.map((d: any) => d.count || 0), 1)

      for (let week = 0; week < 12; week++) {
        for (let day = 0; day < 5; day++) {
          const index = week * 5 + day
          const dayData = recentDays[index]
          const count = dayData?.count || 0
          const opacity =
            count > 0 ? Math.min((count / maxCount) * 0.85 + 0.15, 1) : 0.12
          grid.push({ week, day, opacity, count })
        }
      }
    } else {
      const avgPerDay = contributions / 365
      for (let week = 0; week < 12; week++) {
        for (let day = 0; day < 5; day++) {
          const lambda = avgPerDay * (0.5 + Math.random())
          const count = Math.floor(-Math.log(1 - Math.random()) * lambda)
          const opacity =
            count > 0
              ? Math.min((count / (avgPerDay * 2)) * 0.7 + 0.15, 1)
              : 0.12
          grid.push({ week, day, opacity, count })
        }
      }
    }
    return grid
  }

  const heatmapData = useMemo(
    () => generateHeatmapGrid(),
    [contributionCalendar, contributions],
  )

  const getLanguageColor = (lang: string) => {
    const colorMap: { [key: string]: string } = {
      TypeScript: '#3178c6',
      JavaScript: '#f1e05a',
      Python: '#3572A5',
      Rust: '#dea584',
      Go: '#00ADD8',
      Java: '#b07219',
      'C++': '#f34b7d',
      'C#': '#178600',
      Ruby: '#701516',
      PHP: '#4F5D95',
    }
    return colorMap[lang] || levelColor
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0 bg-linear-to-br from-gray-50/50 to-transparent dark:from-white/2 dark:to-transparent" />
      <div className="relative h-full flex flex-col p-2 justify-between">
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-2 items-start">
              <motion.div
                className="px-2 py-0.5 rounded-md text-[9px] font-bold flex items-center gap-1 shadow-sm w-fit"
                style={{
                  backgroundColor: `${levelColor}20`,
                  color: levelColor,
                  border: `1px solid ${levelColor}30`,
                }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                <span className="text-[7px]">●</span>
                <span>{level}</span>
              </motion.div>
              <div className="flex flex-col gap-1.5">
                <motion.div
                  className="flex items-baseline gap-1.5"
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.3 }}
                >
                  <span className="text-2xl font-black text-gray-800 dark:text-gray-100 leading-none">
                    {contributions}
                  </span>
                  <span className="text-[9px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-bold">
                    {t.reportsPage.commits}
                  </span>
                </motion.div>
                <motion.div
                  className="flex items-baseline gap-1.5"
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.4 }}
                >
                  <span className="text-2xl font-black text-gray-800 dark:text-gray-100 leading-none">
                    {reposCount}
                  </span>
                  <span className="text-[9px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-bold">
                    {t.reportsPage.repos}
                  </span>
                </motion.div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex gap-[2.5px]">
              {HEATMAP_WEEKS.map((week) => (
                <div key={week} className="flex flex-col gap-[2.5px]">
                  {HEATMAP_DAYS.map((day) => {
                    // heatmapData 按 week*5+day 顺序生成，直接下标取，避免 O(n²) find
                    const cell = heatmapData[week * 5 + day]
                    return (
                      <motion.div
                        key={`${week}-${day}`}
                        className="w-2.5 h-2.5 rounded-0.5"
                        style={{
                          backgroundColor: levelColor,
                          opacity: cell?.opacity || 0.15,
                        }}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: cell?.opacity || 0.15 }}
                        transition={{
                          duration: 0.2,
                          delay: (week * 5 + day) * 0.004,
                        }}
                      />
                    )
                  })}
                </div>
              ))}
              </div>
              {totalStars > 0 && (
                <motion.div
                  className="px-1.5 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1"
                  style={{
                    backgroundColor: `${levelColor}1a`,
                    color: levelColor,
                  }}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.5 }}
                >
                  <LuStar size={9} />
                  <span>
                    {totalStars >= 1000
                      ? `${(totalStars / 1000).toFixed(1)}k`
                      : totalStars}
                  </span>
                </motion.div>
              )}
            </div>
          </div>
        </div>
        {langSegments.length > 0 && (
          <div className="absolute bottom-3 right-3 w-[45%] flex flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-x-2.5 gap-y-0.5">
              {langSegments.map((segment) => (
                <motion.span
                  key={segment.name}
                  className="flex items-center gap-1 text-[8px] font-bold text-gray-600 dark:text-gray-300"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: segment.delay }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: getLanguageColor(segment.name) }}
                  />
                  {segment.name}
                  <span className="font-mono text-gray-500 dark:text-gray-400">
                    {Math.round(segment.pct)}%
                  </span>
                </motion.span>
              ))}
            </div>
            <div className="flex h-1 w-full rounded-full overflow-hidden bg-gray-200/80 dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10">
              {langSegments.map((segment) => (
                <motion.div
                  key={segment.name}
                  className="h-full"
                  style={{ backgroundColor: getLanguageColor(segment.name) }}
                  initial={{ width: 0 }}
                  animate={{ width: `${segment.pct}%` }}
                  transition={{
                    duration: segment.duration,
                    delay: segment.delay,
                    ease: 'linear',
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

const GithubWidget = memo(({ data, showOverview, onContentChange }: any) => {
  const libraryItems = useMemo(
    () => data?.library_items || [],
    [data?.library_items],
  )
  const { currentItem, currentItemIndex } = useLibraryItemRotation(
    libraryItems,
    showOverview,
  )

  useEffect(() => {
    if (!showOverview && currentItem) {
      onContentChange?.({
        title: currentItem.title,
        type: currentItem.language || 'repo',
      })
    } else {
      onContentChange?.(null)
    }
  }, [showOverview, currentItem, onContentChange])

  return (
    <AnimatePresence mode="wait">
      {showOverview || !currentItem || libraryItems.length === 0 ? (
        <motion.div
          key="stats"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="h-full w-full"
        >
          <GithubStatsWidget data={data} />
        </motion.div>
      ) : (
        <motion.div
          key={`lib-${currentItemIndex}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.5 }}
          className="h-full w-full p-1.5"
        >
          <div className="relative h-full w-full rounded-xl overflow-hidden shadow-lg bg-white dark:bg-black/90">
            <div className="absolute inset-0 bg-linear-to-br from-gray-800 to-gray-900 dark:from-black dark:to-black/90">
              <div className="absolute inset-0 flex flex-col p-2.5 pb-[20%]">
                <div className="flex items-center gap-2.5 mb-2">
                  {currentItem.stars !== undefined && (
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-700/50">
                      <LuStar size={10} className="text-amber-400" />
                      <span className="text-[10px] font-bold text-gray-100">
                        {currentItem.stars >= 1000
                          ? `${(currentItem.stars / 1000).toFixed(1)}k`
                          : currentItem.stars}
                      </span>
                    </div>
                  )}
                  {currentItem.forks !== undefined && (
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-700/50">
                      <LuGitFork size={10} className="text-gray-100" />
                      <span className="text-[10px] font-bold text-gray-100">
                        {currentItem.forks >= 1000
                          ? `${(currentItem.forks / 1000).toFixed(1)}k`
                          : currentItem.forks}
                      </span>
                    </div>
                  )}
                </div>
                {currentItem.description && (
                  <div className="text-[10px] leading-snug text-gray-200 line-clamp-4 px-1">
                    {currentItem.description}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

// ==================== Netease组件（完整版）====================
const MusicStatsWidget = memo(
  ({
    data,
    allowLoop = true,
    triggerKey,
  }: {
    data?: any
    allowLoop?: boolean
    triggerKey?: unknown
  }) => {
    const { t } = useI18n()

    // 🆕 使用触发式动画 - triggerKey 变化时播放一轮，完成后自动释放
    const { isAnimating } = useLoopAnimation({
      duration: 5000, // 气泡动画约5秒
      trigger: triggerKey, // 状态切换时触发
      enabled: allowLoop, // 低端设备禁用
    })

    const canAnimate = allowLoop && isAnimating

    const moodKeywords = useMemo(
      () => data?.mood_keywords || [],
      [data?.mood_keywords],
    )
    const followerCount = useMemo(
      () => data?.follower_count || 0,
      [data?.follower_count],
    )
    const playlistCount = useMemo(
      () => data?.playlist_count || 0,
      [data?.playlist_count],
    )
    const level = useMemo(() => data?.level || 0, [data?.level])

    const formatNumber = (num: number) => {
      if (num >= 10000)
        return `${(num / 10000).toFixed(1)}${t.reportsPage.tenThousandSuffix}`
      if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
      return num.toString()
    }

    const bubbles = useMemo(() => {
      const items: Array<{
        tag: string
        color: string
        x: number
        y: number
        size: number
        floatDuration: number
        floatDelay: number
      }> = []
      const hash = (str: string, seed: number) => {
        let h = seed
        for (let j = 0; j < str.length; j++) {
          h = Math.imul(h ^ str.charCodeAt(j), 2654435761)
        }
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296
      }
      const isOverlappingStats = (x: number, y: number) => x > 60 && y > 60

      moodKeywords.forEach((keyword: any, i: number) => {
        const size = 35 + Math.floor(hash(keyword.tag, 1) * 60)
        let bestX = 50
        let bestY = 50
        let maxMinDist = -1

        for (let attempt = 0; attempt < 30; attempt++) {
          const r1 = hash(keyword.tag, 100 + attempt + i * 50)
          const r2 = hash(keyword.tag, 200 + attempt + i * 50)
          const x = 10 + r1 * 80
          const y = 10 + r2 * 80
          if (isOverlappingStats(x, y)) continue

          let minDist = 1000
          if (items.length > 0) {
            for (const item of items) {
              const dx = x - item.x
              const dy = (y - item.y) * 2
              const d = Math.sqrt(dx * dx + dy * dy)
              if (d < minDist) minDist = d
            }
          }
          if (minDist > maxMinDist) {
            maxMinDist = minDist
            bestX = x
            bestY = y
          }
        }

        items.push({
          tag: keyword.tag,
          color: keyword.color,
          x: bestX,
          y: bestY,
          size,
          floatDuration: 3 + hash(keyword.tag, 4) * 4,
          floatDelay: hash(keyword.tag, 5) * 2,
        })
      })
      return items
    }, [moodKeywords])

    return (
      <div className="relative h-full w-full overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-br from-red-50/50 to-transparent dark:from-red-900/20 dark:to-transparent" />
        <div className="relative h-full w-full p-3">
          <div className="absolute inset-0 pointer-events-none">
            {bubbles.map((bubble, i) => (
              <motion.div
                key={bubble.tag}
                className="absolute flex items-center justify-center rounded-full font-bold backdrop-blur-[1px] pointer-events-auto cursor-default"
                style={{
                  left: `${bubble.x}%`,
                  top: `${bubble.y}%`,
                  width: `${bubble.size}px`,
                  height: `${bubble.size}px`,
                  marginLeft: `-${bubble.size / 2}px`,
                  marginTop: `-${bubble.size / 2}px`,
                  background: `radial-gradient(120% 120% at 30% 30%, rgba(255,255,255,0.6) 0%, ${bubble.color}20 20%, ${bubble.color}60 100%)`,
                  border: `1px solid rgba(255,255,255,0.3)`,
                  color: bubble.color,
                  fontSize: `${Math.min(Math.max(10, bubble.size / 4), 16)}px`,
                  textShadow: `0 1px 1px rgba(255,255,255,0.8)`,
                  zIndex: 10,
                  willChange: 'transform', // GPU 加速
                  transform: 'translateZ(0)',
                  backfaceVisibility: 'hidden',
                }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  y: [0, -8, 0, 8, 0],
                  // 移除动态 boxShadow 动画，使用静态样式代替
                }}
                transition={{
                  scale: {
                    type: 'spring',
                    stiffness: 260,
                    damping: 20,
                    delay: i * 0.1,
                  },
                  opacity: { duration: 0.6, delay: i * 0.1 },
                  y: {
                    duration: bubble.floatDuration,
                    repeat: canAnimate ? Infinity : 0,
                    ease: 'easeInOut',
                    delay: bubble.floatDelay,
                  },
                }}
                whileHover={{
                  scale: 1.15,
                  zIndex: 50,
                  transition: { duration: 0.3, ease: 'easeOut' },
                }}
              >
                <div className="absolute top-[15%] left-[15%] w-[20%] h-[10%] bg-white/30 rounded-full blur-[1px] transform -rotate-45" />
                <span className="relative z-10 mix-blend-multiply dark:mix-blend-normal">
                  {bubble.tag}
                </span>
              </motion.div>
            ))}
          </div>
          <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2 z-20">
            <motion.div
              className="px-2.5 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1 backdrop-blur-md shadow-lg bg-linear-to-br from-red-50 to-red-100 dark:from-red-950/80 dark:to-red-900/60 text-red-600 dark:text-red-300"
              style={{ boxShadow: '0 2px 12px rgba(239, 68, 68, 0.25)' }}
              initial={{ scale: 0.8, opacity: 0, x: 20 }}
              animate={{ scale: 1, opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <span className="text-[7px]">●</span>
              <span>
                Lv.
                {level}
              </span>
            </motion.div>
            <motion.div
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl backdrop-blur-md shadow-lg bg-white/90 dark:bg-black/90 border border-white/30 dark:border-white/10"
              style={{ backdropFilter: 'blur(10px)' }}
              initial={{ scale: 0.8, opacity: 0, x: 20 }}
              animate={{ scale: 1, opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <div className="flex flex-col items-end">
                <span className="text-lg font-black leading-none text-gray-900 dark:text-gray-100">
                  {formatNumber(followerCount)}
                </span>
                <span className="text-[9px] tracking-wide mt-0.5 italic font-semibold text-gray-600 dark:text-gray-400 font-georgia">
                  {t.reportsPage.fans}
                </span>
              </div>
              <div className="w-px h-5 bg-gray-300 dark:bg-white/20" />
              <div className="flex flex-col items-end">
                <span className="text-lg font-black leading-none text-gray-900 dark:text-gray-100">
                  {formatNumber(playlistCount)}
                </span>
                <span className="text-[9px] tracking-wide mt-0.5 italic font-semibold text-gray-600 dark:text-gray-400 font-georgia">
                  {t.reportsPage.lists}
                </span>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    )
  },
)

const NeteaseWidget = memo(
  ({ data, showOverview, onContentChange, allowLoop = true }: any) => {
    const processedData = useMemo(() => {
      if (!data) return undefined
      let moodKeywords: Array<{ tag: string; color: string }> = []
      if (data.mood_keywords && Array.isArray(data.mood_keywords)) {
        if (data.mood_keywords.length > 0) {
          if (typeof data.mood_keywords[0] === 'string') {
            const defaultColors = [
              '#7B68EE',
              '#FF6B9D',
              '#4ECDC4',
              '#FFB347',
              '#95E1D3',
            ]
            moodKeywords = data.mood_keywords.map((tag: string, i: number) => ({
              tag,
              color: defaultColors[i % defaultColors.length],
            }))
          } else if (typeof data.mood_keywords[0] === 'object') {
            moodKeywords = data.mood_keywords
          }
        }
      }
      return {
        soul_color: data.soul_color,
        mood_keywords: moodKeywords,
        library_items: data.library_items,
        follower_count: data.follower_count,
        playlist_count: data.playlist_count,
        level: data.level,
      }
    }, [data])

    const libraryItems = useMemo(
      () => processedData?.library_items || [],
      [processedData?.library_items],
    )
    const [currentItemIndex, setCurrentItemIndex] = useState(0)
    const prevShowOverviewRef = useRef(showOverview)

    // 当从概览切换到库项目模式时，立即更新索引
    useEffect(() => {
      if (
        prevShowOverviewRef.current &&
        !showOverview &&
        libraryItems.length > 0
      ) {
        setCurrentItemIndex((prev) => (prev + 2) % libraryItems.length)
      }
      prevShowOverviewRef.current = showOverview
    }, [showOverview, libraryItems.length])

    // 在非概览模式下，定时轮换项目 - timeout 链 + 可见性暂停
    useEffect(() => {
      if (!showOverview && libraryItems.length > 0) {
        let cancelled = false
        let timeoutId: number | null = null
        const tick = () => {
          if (cancelled || document.hidden) return
          setCurrentItemIndex((prev) => (prev + 2) % libraryItems.length)
          timeoutId = window.setTimeout(tick, 5000)
        }
        timeoutId = window.setTimeout(tick, 5000)

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
      }
    }, [showOverview, libraryItems.length])

    const currentItems = useMemo(
      () =>
        [
          libraryItems[currentItemIndex],
          libraryItems[(currentItemIndex + 1) % libraryItems.length],
        ].filter(Boolean),
      [libraryItems, currentItemIndex],
    )

    useEffect(() => {
      if (!showOverview && currentItems.length > 0) {
        onContentChange?.({
          titles: currentItems.map((item: any) => item.title),
          type: 'music',
        })
      } else {
        onContentChange?.(null)
      }
    }, [showOverview, currentItems, onContentChange])

    return (
      <AnimatePresence mode="wait">
        {showOverview ||
        currentItems.length === 0 ||
        libraryItems.length === 0 ? (
          <motion.div
            key="stats"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="h-full w-full"
          >
            <MusicStatsWidget
              data={processedData}
              allowLoop={allowLoop}
              triggerKey={showOverview}
            />
          </motion.div>
        ) : (
          <motion.div
            key={`music-${currentItemIndex}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5 }}
            className="h-full w-full p-1.5"
          >
            <div className="h-full w-full flex gap-1.5">
              {currentItems.map((item: any, idx: number) => (
                <div key={idx} className="flex-1 h-full">
                  <div className="relative h-full w-full rounded-xl overflow-hidden shadow-lg bg-white dark:bg-black/90">
                    <div className="absolute inset-0">
                      <img
                        src={
                          item.cover ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(item.title)}&size=200&background=e60026&color=fff`
                        }
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    )
  },
)

// ==================== 平台配置 ====================
// ==================== Xbox / PSN 共用：成就/奖杯型标题轮播 ====================
// 两个平台都没有时长数据，卡片走"成就完成度"叙事：
// 概览 = 核心分数 + 完成度统计；详情 = 作品完成度轮播。

const TrophyTitleRow = memo(
  ({
    title,
    accent,
  }: {
    title: { name: string, progress?: number, platinum?: boolean, gamerscore?: number }
    accent: string
  }) => (
    <div className="flex items-center gap-2 min-w-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {title.platinum && (
            <span className="shrink-0 text-[10px]" title="Platinum">
              🏆
            </span>
          )}
          <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">
            {title.name}
          </span>
          <span
            className="ml-auto shrink-0 text-[10px] tabular-nums font-semibold"
            style={{ color: accent }}
          >
            {Math.round(title.progress ?? 0)}%
          </span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: accent }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, Math.max(0, title.progress ?? 0))}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      </div>
    </div>
  ),
)

TrophyTitleRow.displayName = 'TrophyTitleRow'

/** 成就/奖杯向报告卡的通用骨架，Xbox / PSN 以配色和统计项区分 */
const AchievementReportBody = memo(
  ({
    icon,
    accent,
    typeLabel,
    scoreValue,
    scoreLabel,
    stats,
    topTitles,
    showOverview,
    onContentChange,
  }: {
    icon: React.ReactNode
    accent: string
    typeLabel: string
    scoreValue: string
    scoreLabel: string
    stats: { label: string, value: string }[]
    topTitles: { name: string, progress?: number, platinum?: boolean }[]
    showOverview: boolean
    onContentChange?: (content: { titles?: string[] } | null) => void
  }) => {
    const [pageIndex, setPageIndex] = useState(0)
    const PAGE_SIZE = 3
    const pageCount = Math.max(1, Math.ceil(topTitles.length / PAGE_SIZE))

    useEffect(() => {
      if (showOverview || topTitles.length <= PAGE_SIZE) return
      const timer = window.setInterval(() => {
        setPageIndex((prev) => (prev + 1) % pageCount)
      }, 5000)
      return () => window.clearInterval(timer)
    }, [showOverview, topTitles.length, pageCount])

    const currentTitles = useMemo(
      () => topTitles.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE),
      [topTitles, pageIndex],
    )

    useEffect(() => {
      if (!showOverview && currentTitles.length > 0) {
        onContentChange?.({ titles: currentTitles.map((t) => t.name) })
      } else {
        onContentChange?.(null)
      }
    }, [showOverview, currentTitles, onContentChange])

    return (
      <AnimatePresence mode="wait">
        {showOverview || currentTitles.length === 0 ? (
          <motion.div
            key="stats"
            initial={CONTENT_FADE_INITIAL}
            animate={CONTENT_FADE_ANIMATE}
            exit={CONTENT_FADE_EXIT}
            transition={CONTENT_FADE_TRANSITION}
            className="h-full w-full p-3 flex flex-col justify-between"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div
                  className="flex items-center gap-1.5 text-sm font-bold"
                  style={{ color: accent }}
                >
                  {icon}
                  <span className="truncate">{typeLabel}</span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="text-3xl font-black tabular-nums text-gray-900 dark:text-gray-50 leading-none">
                    {scoreValue}
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {scoreLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {stats.slice(0, 3).map((s) => (
                <div
                  key={s.label}
                  className="rounded-lg px-2 py-1.5 bg-black/5 dark:bg-white/5"
                >
                  <div
                    className="text-sm font-bold tabular-nums"
                    style={{ color: accent }}
                  >
                    {s.value}
                  </div>
                  <div className="text-[9px] text-gray-500 dark:text-gray-400 truncate">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={`titles-${pageIndex}`}
            initial={CONTENT_SLIDE_INITIAL}
            animate={CONTENT_SLIDE_ANIMATE}
            exit={CONTENT_SLIDE_EXIT}
            transition={CONTENT_SLIDE_TRANSITION}
            className="h-full w-full p-3 flex flex-col justify-center gap-2.5"
          >
            {currentTitles.map((title) => (
              <TrophyTitleRow key={title.name} title={title} accent={accent} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    )
  },
)

AchievementReportBody.displayName = 'AchievementReportBody'

const XboxWidget = memo(({ data, showOverview, onContentChange }: any) => {
  const { t } = useI18n()
  const topTitles = useMemo(
    () => (data?.top_titles || []) as { name: string, progress?: number }[],
    [data?.top_titles],
  )
  return (
    <AchievementReportBody
      icon={<FaXbox />}
      accent="#107C10"
      typeLabel={data?.gamer_type || 'Xbox'}
      scoreValue={String(data?.gamerscore ?? 0)}
      scoreLabel="Gamerscore"
      stats={[
        {
          label: t.reportCardWidget.gamesCount,
          value: String(data?.games_count ?? 0),
        },
        {
          label: t.reportCardWidget.completionRate,
          value: `${Math.round(data?.completion_rate ?? 0)}%`,
        },
        {
          label: t.reportCardWidget.completedGames,
          value: String(data?.completed_games ?? 0),
        },
      ]}
      topTitles={topTitles}
      showOverview={showOverview}
      onContentChange={onContentChange}
    />
  )
})

XboxWidget.displayName = 'XboxWidget'

const PsnWidget = memo(({ data, showOverview, onContentChange }: any) => {
  const { t } = useI18n()
  const topTitles = useMemo(
    () =>
      (data?.top_titles || []) as {
        name: string
        progress?: number
        platinum?: boolean
      }[],
    [data?.top_titles],
  )
  return (
    <AchievementReportBody
      icon={<SiPlaystation />}
      accent="#0070D1"
      typeLabel={data?.hunter_type || 'PlayStation'}
      scoreValue={`Lv.${data?.trophy_level ?? 0}`}
      scoreLabel={t.reportCardWidget.trophyLevel}
      stats={[
        {
          label: t.reportCardWidget.platinumCount,
          value: String(data?.platinum_count ?? 0),
        },
        {
          label: t.reportCardWidget.gamesCount,
          value: String(data?.games_count ?? 0),
        },
        {
          label: t.reportCardWidget.completionRate,
          value: `${Math.round(data?.completion_rate ?? 0)}%`,
        },
      ]}
      topTitles={topTitles}
      showOverview={showOverview}
      onContentChange={onContentChange}
    />
  )
})

PsnWidget.displayName = 'PsnWidget'

const PLATFORM_CONFIG: Record<
  string,
  {
    icon: React.ReactNode
    color: string
    bgColor: string
    borderColor: string
    label: string
    textColor: string
  }
> = {
  bilibili: {
    icon: <SiBilibili />,
    color: '#00A1D6',
    bgColor: 'rgba(0, 161, 214, 0.15)',
    borderColor: 'rgba(0, 161, 214, 0.3)',
    label: 'Bilibili',
    textColor: 'text-[#00A1D6]',
  },
  steam: {
    icon: <FaSteam />,
    color: '#1b2838',
    bgColor: 'rgba(27, 40, 56, 0.15)',
    borderColor: 'rgba(27, 40, 56, 0.3)',
    label: 'Steam',
    textColor: 'text-gray-700 dark:text-gray-300',
  },
  github: {
    icon: <FaGithub />,
    color: '#24292e',
    bgColor: 'rgba(36, 41, 46, 0.15)',
    borderColor: 'rgba(36, 41, 46, 0.3)',
    label: 'GitHub',
    textColor: 'text-gray-900 dark:text-gray-100',
  },
  netease: {
    icon: <SiNeteasecloudmusic />,
    color: '#e60026',
    bgColor: 'rgba(230, 0, 38, 0.15)',
    borderColor: 'rgba(230, 0, 38, 0.3)',
    label: 'NetEase',
    textColor: 'text-red-600',
  },
  bangumi: {
    icon: <SiBangumi />,
    color: '#f09199',
    bgColor: 'rgba(240, 145, 153, 0.15)',
    borderColor: 'rgba(240, 145, 153, 0.3)',
    label: 'Bangumi',
    textColor: 'text-rose-500',
  },
  mal: {
    icon: <SiMyanimelist />,
    color: '#2e51a2',
    bgColor: 'rgba(46, 81, 162, 0.15)',
    borderColor: 'rgba(46, 81, 162, 0.3)',
    label: 'MyAnimeList',
    textColor: 'text-blue-600 dark:text-blue-400',
  },
  x: {
    icon: <FaXTwitter />,
    color: '#000000',
    bgColor: 'rgba(0, 0, 0, 0.12)',
    borderColor: 'rgba(0, 0, 0, 0.25)',
    label: 'X',
    textColor: 'text-gray-900 dark:text-gray-100',
  },
  xbox: {
    icon: <FaXbox />,
    color: '#107C10',
    bgColor: 'rgba(16, 124, 16, 0.15)',
    borderColor: 'rgba(16, 124, 16, 0.3)',
    label: 'Xbox',
    textColor: 'text-[#107C10]',
  },
  psn: {
    icon: <SiPlaystation />,
    color: '#0070D1',
    bgColor: 'rgba(0, 112, 209, 0.15)',
    borderColor: 'rgba(0, 112, 209, 0.3)',
    label: 'PlayStation',
    textColor: 'text-[#0070D1]',
  },
}

const XWidget = memo(({ data, showOverview, onContentChange }: any) => {
  const stats = data?.stats || {}
  const topPosts = useMemo(
    () => data?.top_posts || data?.library_items || [],
    [data?.top_posts, data?.library_items],
  )
  const [postIndex, setPostIndex] = useState(0)

  useEffect(() => {
    if (!showOverview && topPosts.length > 1) {
      const timer = setInterval(() => {
        setPostIndex((i) => (i + 1) % topPosts.length)
      }, 4000)
      return () => clearInterval(timer)
    }
  }, [showOverview, topPosts.length])

  useEffect(() => {
    if (showOverview) {
      onContentChange?.({
        titles: [
          data?.vibe || data?.engagement_level || 'X',
          stats.followers != null
            ? `${formatCompactNumber(stats.followers)} followers`
            : 'Posts',
        ],
      })
    } else if (topPosts[postIndex]) {
      const post = topPosts[postIndex]
      const text = post.text || post.title || ''
      onContentChange?.({
        titles: [text.slice(0, 32) + (text.length > 32 ? '…' : '')],
      })
    }
  }, [
    showOverview,
    postIndex,
    topPosts,
    data?.vibe,
    data?.engagement_level,
    stats.followers,
    onContentChange,
  ])

  if (showOverview) {
    return (
      <div className="h-full w-full p-3 flex flex-col justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1">
            {data?.engagement_level || data?.vibe || 'X'}
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 line-clamp-2">
            {data?.vibe || analysisFallback(data)}
          </div>
          {Array.isArray(data?.signature_topics) &&
            data.signature_topics.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {data.signature_topics.slice(0, 4).map((topic: string) => (
                  <span
                    key={topic}
                    className="text-[9px] px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-gray-700 dark:text-gray-300"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}
        </div>
        <div className="flex gap-3">
          {[
            [stats.followers, 'Followers'],
            [stats.posts, 'Posts'],
            [stats.likes_received, 'Likes'],
          ].map(([value, label]) => (
            <div key={label as string} className="flex flex-col">
              <span className="text-lg font-black tabular-nums text-gray-900 dark:text-gray-100 leading-none">
                {formatCompactNumber(value as number)}
              </span>
              <span className="text-[8px] uppercase tracking-widest font-bold text-gray-500 mt-0.5">
                {label as string}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const post = topPosts[postIndex]
  if (!post) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-400 text-xs">
        No posts
      </div>
    )
  }

  const text = post.text || post.title || ''
  return (
    <div className="h-full w-full p-3 flex flex-col justify-between">
      <p className="text-xs leading-relaxed text-gray-800 dark:text-gray-200 line-clamp-5">
        {text}
      </p>
      <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono">
        <span>♥ {formatCompactNumber(post.like_count || 0)}</span>
        <span>↻ {formatCompactNumber(post.retweet_count || 0)}</span>
      </div>
    </div>
  )
})

function analysisFallback(data: any): string {
  if (data?.summary) return data.summary
  return 'Your voice on X'
}

function formatCompactNumber(n: number | undefined | null): string {
  const num = Number(n) || 0
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return String(num)
}

// Bangumi 类型构成条配色（动画/书/游戏/音乐/剧集）
const BANGUMI_TYPE_COLORS: Record<string, string> = {
  anime: '#fb7185',
  book: '#a78bfa',
  game: '#60a5fa',
  music: '#34d399',
  real: '#fbbf24',
}

// MAL 类型构成条配色（动画 / 漫画）
const MAL_TYPE_COLORS: Record<string, string> = {
  anime: '#2e51a2',
  manga: '#60a5fa',
}

const BangumiWidget = memo(({ data, showOverview, onContentChange }: any) => {
  const { t } = useI18n()
  const libraryItems = useMemo(
    () => data?.library_items || [],
    [data?.library_items],
  )
  const statusCounts =
    data?.status_counts || data?.collection_type_distribution || {}
  const done = statusCounts.done || 0
  const doing = statusCounts.doing || 0
  const wish = statusCounts.wish || 0
  const subjectTypeLabels: Record<string, string> = {
    book: t.library.book,
    anime: t.library.anime,
    game: t.library.game,
    music: t.library.music,
    real: t.library.tvSeries,
  }
  const typeDist = useMemo(
    () =>
      Object.entries(data?.subject_type_distribution || {})
        .filter(([, n]) => (n as number) > 0)
        .sort((a, b) => (b[1] as number) - (a[1] as number)),
    [data?.subject_type_distribution],
  )
  const totalSubjects = useMemo(
    () => typeDist.reduce((sum, [, n]) => sum + (n as number), 0),
    [typeDist],
  )
  // 构成条：按占比换算时长，各色段首尾相接连续填充
  const barSegments = useMemo(() => {
    if (totalSubjects === 0) return []
    const fillDuration = 0.9
    const baseDelay = 0.55
    let acc = 0
    return typeDist.map(([type, count]) => {
      const n = count as number
      const segment = {
        type,
        count: n,
        pct: (n / totalSubjects) * 100,
        delay: baseDelay + (acc / totalSubjects) * fillDuration,
        duration: (n / totalSubjects) * fillDuration,
      }
      acc += n
      return segment
    })
  }, [typeDist, totalSubjects])
  // 概览态海报墙素材：有封面的收藏，最多 5 张
  const wallCovers = useMemo(
    () => libraryItems.filter((item: any) => item.cover).slice(0, 5),
    [libraryItems],
  )
  const [currentIndex, setCurrentIndex] = useState(0)
  const prevShowOverviewRef = useRef(showOverview)

  // 与网易云卡片一致：从概览切到详情时推进两位
  useEffect(() => {
    if (
      prevShowOverviewRef.current &&
      !showOverview &&
      libraryItems.length > 0
    ) {
      setCurrentIndex((prev) => (prev + 2) % libraryItems.length)
    }
    prevShowOverviewRef.current = showOverview
  }, [showOverview, libraryItems.length])

  useEffect(() => {
    if (showOverview || libraryItems.length === 0) return
    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => (prev + 2) % libraryItems.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [showOverview, libraryItems.length])

  // 一次展示两列封面（学网易云卡片）
  const currentItems = useMemo(() => {
    if (libraryItems.length === 0) return []
    if (libraryItems.length === 1) return [libraryItems[0]]
    return [
      libraryItems[currentIndex],
      libraryItems[(currentIndex + 1) % libraryItems.length],
    ]
  }, [libraryItems, currentIndex])

  useEffect(() => {
    if (!showOverview && currentItems.length > 0) {
      onContentChange?.({
        titles: currentItems.map((item: any) => item.title),
      })
    } else {
      onContentChange?.(null)
    }
  }, [showOverview, currentItems, onContentChange])

  return (
    <AnimatePresence mode="wait">
      {showOverview || currentItems.length === 0 ? (
        <motion.div
          key="stats"
          initial={CONTENT_FADE_INITIAL}
          animate={CONTENT_FADE_ANIMATE}
          exit={CONTENT_FADE_EXIT}
          transition={CONTENT_FADE_TRANSITION}
          className="h-full w-full"
        >
          <div className="relative h-full w-full overflow-hidden">
            <div className="absolute inset-0 bg-linear-to-br from-rose-50/50 to-transparent dark:from-rose-900/20 dark:to-transparent" />
            {/* 右侧背景：斜切海报墙，向左渐隐 */}
            {wallCovers.length > 0 && (
              <div
                className="absolute inset-y-0 right-0 w-[58%] opacity-70 dark:opacity-50"
                style={{
                  maskImage:
                    'linear-gradient(to left, rgba(0,0,0,1) 45%, transparent 100%)',
                  WebkitMaskImage:
                    'linear-gradient(to left, rgba(0,0,0,1) 45%, transparent 100%)',
                }}
              >
                <div className="absolute -inset-y-4 left-0 right-0 flex items-center justify-end gap-2 pr-4 rotate-6">
                  {wallCovers.map((item: any, i: number) => (
                    <motion.div
                      key={`${item.title}-${i}`}
                      className="w-14 shrink-0 aspect-[3/4] rounded-md overflow-hidden shadow-md ring-1 ring-black/10 dark:ring-white/10"
                      initial={{
                        x: 60,
                        opacity: 0,
                        y: i % 2 === 0 ? -12 : 12,
                      }}
                      animate={{
                        x: 0,
                        opacity: 1,
                        y: i % 2 === 0 ? -12 : 12,
                      }}
                      transition={{
                        duration: 0.5,
                        delay: 0.15 + i * 0.08,
                        ease: 'easeOut',
                      }}
                    >
                      <img
                        src={item.cover}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
            {/* 前景 */}
            <div className="relative z-10 h-full flex flex-col p-2.5">
              {/* 顶部：品味徽章 */}
              <motion.div
                className="w-fit max-w-[70%] px-2 py-0.5 rounded-md text-[9px] font-bold flex items-center gap-1 shadow-sm bg-rose-400/15 text-rose-500 border border-rose-400/25 backdrop-blur-sm"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                <span className="text-[7px] shrink-0">●</span>
                <span className="truncate">
                  {data?.taste_profile || t.widgets.reportBangumi}
                </span>
              </motion.div>
              {/* 中部：数字区在徽章与左下角 Logo 安全区之间垂直居中（pb 略小于 Logo 区高度，整体略下沉） */}
              <div className="flex-1 min-h-0 flex items-center pb-9.5">
                <div className="flex items-end gap-3 pl-1">
                <motion.div
                  className="flex flex-col"
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.2 }}
                >
                  <motion.span
                    className="text-[40px] font-black text-gray-800 dark:text-gray-100 leading-none tabular-nums"
                    initial={{ scale: 0.5 }}
                    animate={{ scale: 1 }}
                    transition={{
                      duration: 0.5,
                      delay: 0.3,
                      type: 'spring',
                      stiffness: 200,
                    }}
                  >
                    {done}
                  </motion.span>
                  <span className="text-[8px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-bold mt-0.5">
                    {t.reportsPage.bangumiDone}
                  </span>
                </motion.div>
                <div className="flex gap-3">
                  {[
                    [doing, t.reportsPage.bangumiDoing] as const,
                    [wish, t.reportsPage.bangumiWish] as const,
                  ].map(([count, label], i) => (
                    <motion.div
                      key={label}
                      className="flex flex-col"
                      initial={{ y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.4, delay: 0.4 + i * 0.1 }}
                    >
                      <span className="text-[22px] font-black text-gray-800 dark:text-gray-200 leading-none tabular-nums">
                        {count}
                      </span>
                      <span className="text-[8px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-bold mt-0.5">
                        {label}
                      </span>
                    </motion.div>
                  ))}
                  </div>
                </div>
              </div>
              {/* 底部右侧：类型构成堆叠条 + 图例，绝对定位钉在右下 */}
              {barSegments.length > 0 && (
                <div className="absolute bottom-3 right-3 w-[45%] flex flex-col items-end gap-1">
                  <div className="flex flex-wrap justify-end gap-x-2.5 gap-y-0.5">
                    {barSegments.map((segment) => (
                      <motion.span
                        key={segment.type}
                        className="flex items-center gap-1 text-[8px] font-bold text-gray-600 dark:text-gray-300"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, delay: segment.delay }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              BANGUMI_TYPE_COLORS[segment.type] || '#f09199',
                          }}
                        />
                        {subjectTypeLabels[segment.type] || segment.type}
                        <span className="font-mono text-gray-500 dark:text-gray-400">
                          {segment.count}
                        </span>
                      </motion.span>
                    ))}
                  </div>
                  <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-gray-200/80 dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10">
                    {barSegments.map((segment) => (
                      <motion.div
                        key={segment.type}
                        className="h-full"
                        style={{
                          backgroundColor:
                            BANGUMI_TYPE_COLORS[segment.type] || '#f09199',
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: `${segment.pct}%` }}
                        transition={{
                          duration: segment.duration,
                          delay: segment.delay,
                          ease: 'linear',
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key={`lib-${currentIndex}`}
          initial={CONTENT_SLIDE_INITIAL}
          animate={CONTENT_SLIDE_ANIMATE}
          exit={CONTENT_SLIDE_EXIT}
          transition={CONTENT_SLIDE_TRANSITION}
          className="h-full w-full p-1.5"
        >
          {/* 两列封面（学网易云卡片） */}
          <div className="h-full w-full flex gap-1.5">
            {currentItems.map((item: any, idx: number) => (
              <div key={idx} className="flex-1 h-full">
                <div className="relative h-full w-full rounded-xl overflow-hidden shadow-lg bg-white dark:bg-black/90">
                  <div className="absolute inset-0">
                    {item.cover ? (
                      <img
                        src={item.cover}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-rose-400 bg-rose-50 dark:bg-rose-950/30">
                        <SiBangumi />
                      </div>
                    )}
                  </div>
                  {/* 资料库同款评分徽章（卡片内统一尺寸） */}
                  <RatingBadge
                    rate={item.rate}
                    className="absolute top-1.5 left-1.5 z-20"
                    sizeClass="w-7 h-7 text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

// MyAnimeList 报告卡 — 布局对齐 Bangumi（概览数字 + 类型条 + 详情双封面）
const MalWidget = memo(({ data, showOverview, onContentChange }: any) => {
  const { t } = useI18n()
  const libraryItems = useMemo(
    () => data?.library_items || [],
    [data?.library_items],
  )
  const statusCounts =
    data?.status_counts || data?.collection_type_distribution || {}
  const done = statusCounts.done || 0
  const doing = statusCounts.doing || 0
  const wish = statusCounts.wish || 0
  const subjectTypeLabels: Record<string, string> = {
    anime: t.library.anime,
    manga: t.library.book,
  }
  const typeDist = useMemo(
    () =>
      Object.entries(data?.subject_type_distribution || {})
        .filter(([, n]) => (n as number) > 0)
        .sort((a, b) => (b[1] as number) - (a[1] as number)),
    [data?.subject_type_distribution],
  )
  const totalSubjects = useMemo(
    () => typeDist.reduce((sum, [, n]) => sum + (n as number), 0),
    [typeDist],
  )
  const barSegments = useMemo(() => {
    if (totalSubjects === 0) return []
    const fillDuration = 0.9
    const baseDelay = 0.55
    let acc = 0
    return typeDist.map(([type, count]) => {
      const n = count as number
      const segment = {
        type,
        count: n,
        pct: (n / totalSubjects) * 100,
        delay: baseDelay + (acc / totalSubjects) * fillDuration,
        duration: (n / totalSubjects) * fillDuration,
      }
      acc += n
      return segment
    })
  }, [typeDist, totalSubjects])
  const wallCovers = useMemo(
    () => libraryItems.filter((item: any) => item.cover).slice(0, 5),
    [libraryItems],
  )
  const [currentIndex, setCurrentIndex] = useState(0)
  const prevShowOverviewRef = useRef(showOverview)

  useEffect(() => {
    if (
      prevShowOverviewRef.current &&
      !showOverview &&
      libraryItems.length > 0
    ) {
      setCurrentIndex((prev) => (prev + 2) % libraryItems.length)
    }
    prevShowOverviewRef.current = showOverview
  }, [showOverview, libraryItems.length])

  useEffect(() => {
    if (showOverview || libraryItems.length === 0) return
    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => (prev + 2) % libraryItems.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [showOverview, libraryItems.length])

  const currentItems = useMemo(() => {
    if (libraryItems.length === 0) return []
    if (libraryItems.length === 1) return [libraryItems[0]]
    return [
      libraryItems[currentIndex],
      libraryItems[(currentIndex + 1) % libraryItems.length],
    ]
  }, [libraryItems, currentIndex])

  useEffect(() => {
    if (!showOverview && currentItems.length > 0) {
      onContentChange?.({
        titles: currentItems.map((item: any) => item.title),
      })
    } else {
      onContentChange?.(null)
    }
  }, [showOverview, currentItems, onContentChange])

  return (
    <AnimatePresence mode="wait">
      {showOverview || currentItems.length === 0 ? (
        <motion.div
          key="stats"
          initial={CONTENT_FADE_INITIAL}
          animate={CONTENT_FADE_ANIMATE}
          exit={CONTENT_FADE_EXIT}
          transition={CONTENT_FADE_TRANSITION}
          className="h-full w-full"
        >
          <div className="relative h-full w-full overflow-hidden">
            <div className="absolute inset-0 bg-linear-to-br from-blue-50/50 to-transparent dark:from-blue-900/20 dark:to-transparent" />
            {wallCovers.length > 0 && (
              <div
                className="absolute inset-y-0 right-0 w-[58%] opacity-70 dark:opacity-50"
                style={{
                  maskImage:
                    'linear-gradient(to left, rgba(0,0,0,1) 45%, transparent 100%)',
                  WebkitMaskImage:
                    'linear-gradient(to left, rgba(0,0,0,1) 45%, transparent 100%)',
                }}
              >
                <div className="absolute -inset-y-4 left-0 right-0 flex items-center justify-end gap-2 pr-4 rotate-6">
                  {wallCovers.map((item: any, i: number) => (
                    <motion.div
                      key={`${item.title}-${i}`}
                      className="w-14 shrink-0 aspect-[3/4] rounded-md overflow-hidden shadow-md ring-1 ring-black/10 dark:ring-white/10"
                      initial={{
                        x: 60,
                        opacity: 0,
                        y: i % 2 === 0 ? -12 : 12,
                      }}
                      animate={{
                        x: 0,
                        opacity: 1,
                        y: i % 2 === 0 ? -12 : 12,
                      }}
                      transition={{
                        duration: 0.5,
                        delay: 0.15 + i * 0.08,
                        ease: 'easeOut',
                      }}
                    >
                      <img
                        src={item.cover}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
            <div className="relative z-10 h-full flex flex-col p-2.5">
              <motion.div
                className="w-fit max-w-[70%] px-2 py-0.5 rounded-md text-[9px] font-bold flex items-center gap-1 shadow-sm bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25 backdrop-blur-sm"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                <span className="text-[7px] shrink-0">●</span>
                <span className="truncate">
                  {data?.taste_profile || t.widgets.reportMal}
                </span>
              </motion.div>
              <div className="flex-1 min-h-0 flex items-center pb-9.5">
                <div className="flex items-end gap-3 pl-1">
                  <motion.div
                    className="flex flex-col"
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                  >
                    <motion.span
                      className="text-[40px] font-black text-gray-800 dark:text-gray-100 leading-none tabular-nums"
                      initial={{ scale: 0.5 }}
                      animate={{ scale: 1 }}
                      transition={{
                        duration: 0.5,
                        delay: 0.3,
                        type: 'spring',
                        stiffness: 200,
                      }}
                    >
                      {done}
                    </motion.span>
                    <span className="text-[8px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-bold mt-0.5">
                      {t.reportsPage.malDone}
                    </span>
                  </motion.div>
                  <div className="flex gap-3">
                    {[
                      [doing, t.reportsPage.malDoing] as const,
                      [wish, t.reportsPage.malWish] as const,
                    ].map(([count, label], i) => (
                      <motion.div
                        key={label}
                        className="flex flex-col"
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.4, delay: 0.4 + i * 0.1 }}
                      >
                        <span className="text-[22px] font-black text-gray-800 dark:text-gray-200 leading-none tabular-nums">
                          {count}
                        </span>
                        <span className="text-[8px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-bold mt-0.5">
                          {label}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
              {barSegments.length > 0 && (
                <div className="absolute bottom-3 right-3 w-[45%] flex flex-col items-end gap-1">
                  <div className="flex flex-wrap justify-end gap-x-2.5 gap-y-0.5">
                    {barSegments.map((segment) => (
                      <motion.span
                        key={segment.type}
                        className="flex items-center gap-1 text-[8px] font-bold text-gray-600 dark:text-gray-300"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, delay: segment.delay }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              MAL_TYPE_COLORS[segment.type] || '#2e51a2',
                          }}
                        />
                        {subjectTypeLabels[segment.type] || segment.type}
                        <span className="font-mono text-gray-500 dark:text-gray-400">
                          {segment.count}
                        </span>
                      </motion.span>
                    ))}
                  </div>
                  <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-gray-200/80 dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10">
                    {barSegments.map((segment) => (
                      <motion.div
                        key={segment.type}
                        className="h-full"
                        style={{
                          backgroundColor:
                            MAL_TYPE_COLORS[segment.type] || '#2e51a2',
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: `${segment.pct}%` }}
                        transition={{
                          duration: segment.duration,
                          delay: segment.delay,
                          ease: 'linear',
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key={`lib-${currentIndex}`}
          initial={CONTENT_SLIDE_INITIAL}
          animate={CONTENT_SLIDE_ANIMATE}
          exit={CONTENT_SLIDE_EXIT}
          transition={CONTENT_SLIDE_TRANSITION}
          className="h-full w-full p-1.5"
        >
          <div className="h-full w-full flex gap-1.5">
            {currentItems.map((item: any, idx: number) => (
              <div key={idx} className="flex-1 h-full">
                <div className="relative h-full w-full rounded-xl overflow-hidden shadow-lg bg-white dark:bg-black/90">
                  <div className="absolute inset-0">
                    {item.cover ? (
                      <img
                        src={item.cover}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-blue-400 bg-blue-50 dark:bg-blue-950/30">
                        <SiMyanimelist />
                      </div>
                    )}
                  </div>
                  <RatingBadge
                    rate={item.rate}
                    className="absolute top-1.5 left-1.5 z-20"
                    sizeClass="w-7 h-7 text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

// ==================== 主组件 ====================
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
    const platformId = (config.config?.platformId || 'bilibili') as string
    const [reportData, setReportData] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const isOverviewControlled = controlledShowOverview !== undefined
    const [internalShowOverview, setInternalShowOverview] = useState(true)
    const showOverview = isOverviewControlled
      ? controlledShowOverview
      : internalShowOverview
    const [cardContent, setCardContent] = useState<{
      title: string
      type?: string
      titles?: string[]
    } | null>(null)

    useEffect(() => {
      if (isPreview) {
        setReportData({
          hardcore_score: 85,
          player_type: t.reportCardWidget.hardcorePlayer,
          games_count: 120,
          total_playtime: 2500,
          contribution_level: t.reportCardWidget.seniorDev,
          total_contributions: 1200,
          repos_count: 45,
          follower_count: 1200,
          playlist_count: 15,
          level: 8,
          mood_keywords: [
            t.reportCardWidget.happyMood,
            t.reportCardWidget.sadMood,
            t.reportCardWidget.passionateMood,
          ],
          library_items: [
            {
              title: t.reportCardWidget.sampleProject,
              type: 'repo',
              stars: 120,
              forks: 30,
              description: t.reportCardWidget.sampleProjectDesc,
            },
            { title: t.reportCardWidget.sampleGame, type: 'game', cover: '' },
            { title: t.reportCardWidget.sampleAnime, type: 'anime', cover: '' },
            {
              title: t.reportCardWidget.samplePlaylist,
              type: 'music',
              cover: '',
            },
          ],
        })
        setLoading(false)
        return
      }

      // 外部直接提供数据（报告页复用）：不再自行请求，跟随 prop 更新
      if (externalData !== undefined) {
        setReportData(externalData)
        setLoading(false)
        return
      }

      const fetchReport = async () => {
        try {
          // 使用去重机制避免多个 ReportCardWidget 同时请求
          const data = await getLatestReportDeduped()
          const report = data.platform_reports?.find(
            (r: any) => r.platform === platformId,
          )
          if (report) setReportData(report.card_visuals)
        } catch (err) {
          console.error(`${t.reportCardWidget.fetchReportFailed}:`, err)
        } finally {
          setLoading(false)
        }
      }
      fetchReport()

      // 5分钟刷新一次 - timeout 链 + 可见性暂停
      let cancelled = false
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

    useEffect(() => {
      // 预览态 / 外部控制概览态时不启用内部自动轮播
      if (isPreview || isOverviewControlled) return

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
    }, [isPreview, isOverviewControlled])

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
      <div
        ref={localRef}
        className={`relative h-full w-full rounded-xl overflow-hidden ${bare ? '' : 'glass'} ${interactive && !isEditMode ? 'cursor-pointer' : ''}`}
        onClick={interactive ? handleCardClick : undefined}
        onMouseDown={interactive ? handlePressStart : undefined}
        onMouseUp={interactive ? handlePressEnd : undefined}
        onMouseLeave={interactive ? handleMouseLeave : undefined}
        onTouchStart={interactive ? handlePressStart : undefined}
        onTouchEnd={interactive ? handlePressEnd : undefined}
        onTouchCancel={interactive ? handlePressEnd : undefined}
      >
        {/* 动态背景光效（bare 模式下由外层容器负责，避免重复叠加） */}
        {!bare && (
          <div
            className={`absolute -right-10 -top-10 w-40 h-40 rounded-full ${animLevel.level === 'standard' ? 'blur-3xl' : 'blur-xl'} opacity-10 group-hover:opacity-20 transition-opacity`}
            style={{ background: platformConfig.color }}
          />
        )}

        {/* 主内容区 */}
        <div className="absolute inset-0 flex flex-col z-10">
          {platformId === 'bilibili' && (
            <BilibiliWidget
              data={reportData}
              showOverview={showOverview}
              onContentChange={handleContentChange}
              allowLoop={animLevel.loop}
            />
          )}
          {platformId === 'steam' && (
            <SteamWidget
              data={reportData}
              showOverview={showOverview}
              onContentChange={handleContentChange}
            />
          )}
          {platformId === 'github' && (
            <GithubWidget
              data={reportData}
              showOverview={showOverview}
              onContentChange={handleContentChange}
            />
          )}
          {platformId === 'netease' && (
            <NeteaseWidget
              data={reportData}
              showOverview={showOverview}
              onContentChange={handleContentChange}
              allowLoop={animLevel.loop}
            />
          )}
          {platformId === 'bangumi' && (
            <BangumiWidget
              data={reportData}
              showOverview={showOverview}
              onContentChange={handleContentChange}
            />
          )}
          {platformId === 'mal' && (
            <MalWidget
              data={reportData}
              showOverview={showOverview}
              onContentChange={handleContentChange}
            />
          )}
          {platformId === 'xbox' && (
            <XboxWidget
              data={reportData}
              showOverview={showOverview}
              onContentChange={handleContentChange}
            />
          )}
          {platformId === 'psn' && (
            <PsnWidget
              data={reportData}
              showOverview={showOverview}
              onContentChange={handleContentChange}
            />
          )}
          {platformId === 'x' && (
            <XWidget
              data={reportData}
              showOverview={showOverview}
              onContentChange={handleContentChange}
            />
          )}
        </div>

        {/* 左下角浮动Logo */}
        <motion.div
          className="absolute bottom-3 left-3 z-20"
          initial={false}
          animate={{ width: cardContent ? 'auto' : '32px' }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <div
            className={`rounded-lg flex items-center gap-2 ${platformConfig.textColor} backdrop-blur-sm shadow-lg transition-all overflow-hidden ${
              cardContent ? 'bg-white/95 dark:bg-black/95' : ''
            }`}
            style={{
              background: cardContent ? undefined : platformConfig.bgColor,
              border: `1px solid ${platformConfig.borderColor}`,
              padding: cardContent?.titles ? '4px 8px' : '0 8px',
              height: cardContent?.titles ? 'auto' : '32px',
            }}
          >
            <div className={`text-base shrink-0 ${platformConfig.textColor}`}>
              {platformConfig.icon}
            </div>
            <AnimatePresence>
              {cardContent && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-center gap-2 whitespace-nowrap overflow-hidden"
                >
                  {cardContent.titles ? (
                    <div className="flex flex-col gap-0.5">
                      {cardContent.titles.map((title: string, idx: number) => (
                        <div
                          key={idx}
                          className="text-[10px] font-bold text-gray-900 dark:text-gray-100 max-w-30 truncate leading-tight"
                        >
                          {title}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] font-bold text-gray-900 dark:text-gray-100 max-w-30 truncate">
                      {cardContent.title}
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

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
      </div>
    )
  },
)

ReportCardWidget.displayName = 'ReportCardWidget'

export { ReportCardSettingsModal }
