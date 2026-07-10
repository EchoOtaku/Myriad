/**
 * 游戏公开状态小组件（固定 4x2）
 *
 * 仅使用公开标识（UID / Gamertag / Online ID），不收集用户 Cookie。
 * 设置方式与社交网络小组件一致：编辑模式下长按 → 浮窗面板。
 *
 * 平台：
 * - hoyolab：Enka 展柜（genshin / hsr / zzz，一卡一游戏）
 * - xbox：OpenXBL（服务端 OPENXBL_API_KEY）
 * - psn：PSN 只读（服务端 PSN_NPSSO）
 * Switch 暂搁置
 */

import type { WidgetComponentProps } from '../WidgetGrid'
import {
  FaGamepad,
  FaTimes,
  FaXbox,
  SiPlaystation,
} from '@lib/icons'
import { motionShim as motion } from '@lib/motionShim'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { API_URL } from '../../config'
import { useI18n } from '../../contexts/I18nContext'
import { useAnimationLevel } from '../../hooks/useAnimationLevel'
import { useWidgetSize } from '../../hooks/useWidgetSize'
import { useThemeMode } from '../../utils/themeSubscriber'
import { GlowBackground } from './shared/GlowBackground'
import { WidgetShell } from './shared/WidgetShell'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GamePlatformId = 'hoyolab' | 'xbox' | 'psn'
export type HoyoGame = 'genshin' | 'hsr' | 'zzz'

export interface GamePresenceWidgetConfig {
  platformId?: GamePlatformId
  accountId?: string
  game?: HoyoGame
}

interface GameIdentity {
  id: string
  name: string
  avatar?: string | null
  subtitle?: string | null
}

interface GameScore {
  label: string
  value: string
}

interface GamePresenceInfo {
  status: string
  title?: string | null
  detail?: string | null
}

interface GameHighlight {
  label: string
  value: string
}

interface ShowcaseItem {
  name: string
  level?: number | null
  icon?: string | null
  rarity?: number | null
}

interface GamePresenceData {
  platform: string
  identity: GameIdentity
  score?: GameScore | null
  presence?: GamePresenceInfo | null
  highlights: GameHighlight[]
  showcase: ShowcaseItem[]
  profile_url?: string | null
  fetched_at: string
  degraded: boolean
  degrade_reason?: string | null
}

/** 平台/游戏视觉主题 —— 与品牌色对齐，亮暗双套 */
interface PlatformTheme {
  /** 亮色主色 */
  color: string
  /** 暗色主色 */
  darkColor: string
  /** 次强调（芯片点缀、稀有度等） */
  accent: string
  darkAccent: string
}

interface PlatformMeta {
  id: GamePlatformId
  nameKey: 'hoyolab' | 'xbox' | 'psn'
  theme: PlatformTheme
  icon: React.ReactNode
  idPlaceholder: string
}

// ---------------------------------------------------------------------------
// Constants — brand-aligned palettes
// ---------------------------------------------------------------------------

/** 米哈游按子游戏细分（同一平台不同气质） */
const HOYO_GAME_THEMES: Record<HoyoGame, PlatformTheme> = {
  // 原神：琥珀金 / 旅人风
  genshin: {
    color: '#C9A227',
    darkColor: '#E8C547',
    accent: '#4A90A4',
    darkAccent: '#7EC8D8',
  },
  // 星铁：星轨紫 + 金
  hsr: {
    color: '#6B5CE7',
    darkColor: '#9B8CFF',
    accent: '#D4A84B',
    darkAccent: '#F0C96A',
  },
  // 绝区零：霓虹黄黑
  zzz: {
    color: '#E8C547',
    darkColor: '#FFE566',
    accent: '#FF6B35',
    darkAccent: '#FF8F66',
  },
}

const PLATFORMS: readonly PlatformMeta[] = Object.freeze([
  {
    id: 'hoyolab',
    nameKey: 'hoyolab',
    // 默认色（实际渲染会按 game 覆盖）
    theme: HOYO_GAME_THEMES.genshin,
    icon: <FaGamepad />,
    idPlaceholder: '800123456',
  },
  {
    id: 'xbox',
    nameKey: 'xbox',
    // Xbox 官方绿
    theme: {
      color: '#107C10',
      darkColor: '#3A9D3A',
      accent: '#9BF00B',
      darkAccent: '#B5FF2E',
    },
    icon: <FaXbox />,
    idPlaceholder: 'Major Nelson',
  },
  {
    id: 'psn',
    nameKey: 'psn',
    // PlayStation 蓝
    theme: {
      color: '#00439C',
      darkColor: '#3D7FE0',
      accent: '#0070D1',
      darkAccent: '#5BA3F5',
    },
    icon: <SiPlaystation />,
    idPlaceholder: 'OnlineID',
  },
])

const HOYO_GAMES: { id: HoyoGame, labelKey: 'genshin' | 'hsr' | 'zzz' }[] = [
  { id: 'genshin', labelKey: 'genshin' },
  { id: 'hsr', labelKey: 'hsr' },
  { id: 'zzz', labelKey: 'zzz' },
]

function resolveTheme(
  platformId: GamePlatformId,
  game: HoyoGame,
  isDark: boolean,
): {
  primary: string
  accent: string
  softBg: string
  softBgStrong: string
  border: string
  chipBg: string
  panelBg: string
  gradient: string
} {
  const base =
    platformId === 'hoyolab'
      ? HOYO_GAME_THEMES[game] || HOYO_GAME_THEMES.genshin
      : (PLATFORMS.find((p) => p.id === platformId) || PLATFORMS[0]).theme

  const primary = isDark ? base.darkColor : base.color
  const accent = isDark ? base.darkAccent : base.accent

  // 从 hex 主色生成半透明表面（避免每处手写 rgba）
  const softBg = hexToRgba(primary, isDark ? 0.14 : 0.1)
  const softBgStrong = hexToRgba(primary, isDark ? 0.22 : 0.16)
  const border = hexToRgba(primary, isDark ? 0.35 : 0.28)
  const chipBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.045)'
  const panelBg = hexToRgba(primary, isDark ? 0.12 : 0.08)
  const gradient = `linear-gradient(135deg, ${hexToRgba(primary, isDark ? 0.28 : 0.2)} 0%, ${hexToRgba(accent, isDark ? 0.12 : 0.08)} 55%, ${hexToRgba(primary, 0.04)} 100%)`

  return {
    primary,
    accent,
    softBg,
    softBgStrong,
    border,
    chipBg,
    panelBg,
    gradient,
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return `rgba(100,100,100,${alpha})`
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ---------------------------------------------------------------------------
// Settings modal (global singleton, same pattern as SocialNetworkWidget)
// ---------------------------------------------------------------------------

interface SettingsState {
  isOpen: boolean
  platformId: GamePlatformId
  accountId: string
  game: HoyoGame
  anchorRect?: DOMRect
  onSave?: (cfg: Required<Pick<GamePresenceWidgetConfig, 'platformId' | 'accountId' | 'game'>>) => void
}

let globalSettings: SettingsState = {
  isOpen: false,
  platformId: 'hoyolab',
  accountId: '',
  game: 'genshin',
}

const settingsListeners = new Set<() => void>()

function openGamePresenceSettings(
  platformId: GamePlatformId,
  accountId: string,
  game: HoyoGame,
  anchorRect: DOMRect,
  onSave: SettingsState['onSave'],
) {
  globalSettings = {
    isOpen: true,
    platformId,
    accountId,
    game,
    anchorRect,
    onSave,
  }
  settingsListeners.forEach((l) => l())
}

function closeGamePresenceSettings() {
  globalSettings = { ...globalSettings, isOpen: false }
  settingsListeners.forEach((l) => l())
}

function subscribeSettings(listener: () => void) {
  settingsListeners.add(listener)
  return () => {
    settingsListeners.delete(listener)
  }
}

const GamePresenceSettingsModal = memo(() => {
  const { t } = useI18n()
  const [, forceUpdate] = useState({})
  const [draftPlatform, setDraftPlatform] = useState<GamePlatformId>('hoyolab')
  const [draftAccountId, setDraftAccountId] = useState('')
  const [draftGame, setDraftGame] = useState<HoyoGame>('genshin')
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeSettings(() => forceUpdate({})), [])

  const { isOpen, anchorRect, onSave } = globalSettings

  // Sync draft when opening
  useEffect(() => {
    if (isOpen) {
      setDraftPlatform(globalSettings.platformId)
      setDraftAccountId(globalSettings.accountId)
      setDraftGame(globalSettings.game)
    }
  }, [isOpen])

  const position = useMemo(() => {
    if (!anchorRect) return { top: 0, left: 0 }
    const modalWidth = 300
    const modalHeight = 340
    const padding = 16
    let top = anchorRect.bottom + 8
    let left = anchorRect.left + (anchorRect.width - modalWidth) / 2
    if (left + modalWidth > window.innerWidth - padding) {
      left = window.innerWidth - modalWidth - padding
    }
    if (left < padding) left = padding
    if (top + modalHeight > window.innerHeight - padding) {
      top = anchorRect.top - modalHeight - 8
    }
    if (top < padding) top = padding
    return { top, left }
  }, [anchorRect])

  useEffect(() => {
    if (!isOpen) return
    const onOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        closeGamePresenceSettings()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGamePresenceSettings()
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onOutside, { passive: true })
      document.addEventListener('keydown', onKey)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  const handleSave = useCallback(() => {
    const id = draftAccountId.trim()
    if (!id) return
    onSave?.({
      platformId: draftPlatform,
      accountId: id,
      game: draftGame,
    })
    closeGamePresenceSettings()
  }, [draftPlatform, draftAccountId, draftGame, onSave])

  const tw = t.gamePresenceWidget
  const isDark = useThemeMode()
  const platformMeta = PLATFORMS.find((p) => p.id === draftPlatform) || PLATFORMS[0]
  const modalTheme = resolveTheme(draftPlatform, draftGame, isDark)

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
        transition={{ duration: 0.15 }}
        className="absolute glass rounded-2xl shadow-2xl overflow-hidden"
        style={{
          top: position.top,
          left: position.left,
          width: 300,
          pointerEvents: 'auto',
          border: `1px solid ${modalTheme.border}`,
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: modalTheme.border }}
        >
          <span className="font-bold text-sm text-gray-800 dark:text-gray-200">
            {tw.settingsTitle}
          </span>
          <button
            type="button"
            onClick={closeGamePresenceSettings}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            aria-label={tw.close}
          >
            <FaTimes size={12} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
          {/* Platform select */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              {tw.selectPlatform}
            </label>
            <div className="space-y-1">
              {PLATFORMS.map((p) => {
                const selected = draftPlatform === p.id
                const c = isDark ? p.theme.darkColor : p.theme.color
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDraftPlatform(p.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                    style={
                      selected
                        ? {
                            background: c,
                            color: '#fff',
                            boxShadow: `0 2px 8px ${hexToRgba(c, 0.35)}`,
                          }
                        : {
                            background: isDark
                              ? 'rgba(255,255,255,0.06)'
                              : 'rgba(0,0,0,0.04)',
                            color: undefined,
                          }
                    }
                  >
                    <span
                      className="text-base"
                      style={{ color: selected ? '#fff' : c }}
                    >
                      {p.icon}
                    </span>
                    <span
                      className={
                        selected
                          ? ''
                          : 'text-gray-700 dark:text-gray-200'
                      }
                    >
                      {tw[p.nameKey]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Hoyo game */}
          {draftPlatform === 'hoyolab' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                {tw.selectGame}
              </label>
              <div className="flex gap-1.5">
                {HOYO_GAMES.map((g) => {
                  const selected = draftGame === g.id
                  const gt = HOYO_GAME_THEMES[g.id]
                  const c = isDark ? gt.darkColor : gt.color
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setDraftGame(g.id)}
                      className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={
                        selected
                          ? { background: c, color: '#fff' }
                          : {
                              background: hexToRgba(c, isDark ? 0.15 : 0.1),
                              color: c,
                            }
                      }
                    >
                      {tw[g.labelKey]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Account id */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              {draftPlatform === 'hoyolab'
                ? tw.uidLabel
                : draftPlatform === 'xbox'
                  ? tw.gamertagLabel
                  : tw.onlineIdLabel}
            </label>
            <input
              type="text"
              value={draftAccountId}
              onChange={(e) => setDraftAccountId(e.target.value)}
              placeholder={platformMeta.idPlaceholder}
              className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-900 text-gray-900 dark:text-gray-100 text-sm outline-none"
              style={{
                borderColor: modalTheme.border,
                boxShadow: `0 0 0 0 transparent`,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = modalTheme.primary
                e.currentTarget.style.boxShadow = `0 0 0 2px ${hexToRgba(modalTheme.primary, 0.25)}`
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = modalTheme.border
                e.currentTarget.style.boxShadow = 'none'
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 leading-snug">
              {tw.publicOnlyHint}
            </p>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!draftAccountId.trim()}
            className="w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
            style={{ background: modalTheme.primary }}
          >
            {tw.save}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
})

GamePresenceSettingsModal.displayName = 'GamePresenceSettingsModal'

// ---------------------------------------------------------------------------
// Data fetch
// ---------------------------------------------------------------------------

const dataCache = new Map<string, { data: GamePresenceData, at: number }>()
const DATA_TTL = 90_000
const inflight = new Map<string, Promise<GamePresenceData | null>>()

async function fetchGamePresence(
  platformId: GamePlatformId,
  accountId: string,
  game: HoyoGame,
): Promise<GamePresenceData | null> {
  const key = `${platformId}:${accountId}:${game}`
  const cached = dataCache.get(key)
  if (cached && Date.now() - cached.at < DATA_TTL) {
    return cached.data
  }
  if (inflight.has(key)) return inflight.get(key)!

  const p = (async () => {
    try {
      const params = new URLSearchParams({
        platform: platformId,
        id: accountId,
      })
      if (platformId === 'hoyolab') params.set('game', game)
      const res = await fetch(
        `${API_URL}/api/game/presence?${params}`,
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return null
      const body = await res.json()
      if (body?.success && body?.data) {
        dataCache.set(key, { data: body.data, at: Date.now() })
        return body.data as GamePresenceData
      }
      return null
    } catch {
      return null
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, p)
  return p
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function resolveConfig(config: WidgetComponentProps['config']): {
  platformId: GamePlatformId
  accountId: string
  game: HoyoGame
} {
  const c = (config.config || {}) as GamePresenceWidgetConfig
  const platformId = (['hoyolab', 'xbox', 'psn'] as const).includes(
    c.platformId as GamePlatformId,
  )
    ? (c.platformId as GamePlatformId)
    : 'hoyolab'
  const game = (['genshin', 'hsr', 'zzz'] as const).includes(c.game as HoyoGame)
    ? (c.game as HoyoGame)
    : 'genshin'
  return {
    platformId,
    accountId: (c.accountId || '').trim(),
    game,
  }
}

const GamePresenceWidget = memo(
  ({ config, isEditMode, isPreview, onConfigChange }: WidgetComponentProps) => {
    const { t } = useI18n()
    const tw = t.gamePresenceWidget
    const isDark = useThemeMode()
    const anim = useAnimationLevel()
    const { fontScale, scale, containerRef } = useWidgetSize(
      config.size,
      isPreview ? 1 : undefined,
    )
    const localRef = useRef<HTMLDivElement | null>(null)
    // Merge ResizeObserver ref + local ref for settings positioning
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        localRef.current = node
        containerRef(node)
      },
      [containerRef],
    )

    const resolved = resolveConfig(config)
    const [platformId, setPlatformId] = useState(resolved.platformId)
    const [accountId, setAccountId] = useState(resolved.accountId)
    const [game, setGame] = useState(resolved.game)

    const [data, setData] = useState<GamePresenceData | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const isLongPressRef = useRef(false)

    // Sync from config
    useEffect(() => {
      const next = resolveConfig(config)
      setPlatformId(next.platformId)
      setAccountId(next.accountId)
      setGame(next.game)
    }, [config.config?.platformId, config.config?.accountId, config.config?.game])

    // Fetch
    useEffect(() => {
      if (isPreview) return
      if (!accountId) {
        setData(null)
        setError(null)
        return
      }
      let cancelled = false
      setLoading(true)
      setError(null)
      fetchGamePresence(platformId, accountId, game).then((d) => {
        if (cancelled) return
        setLoading(false)
        if (d) {
          setData(d)
        } else {
          setData(null)
          setError(tw.fetchFailed)
        }
      })
      return () => {
        cancelled = true
      }
    }, [platformId, accountId, game, isPreview, tw.fetchFailed])

    const platformMeta =
      PLATFORMS.find((p) => p.id === platformId) || PLATFORMS[0]
    const theme = useMemo(
      () => resolveTheme(platformId, game, isDark),
      [platformId, game, isDark],
    )
    const iconColor = theme.primary

    const persist = useCallback(
      (next: {
        platformId: GamePlatformId
        accountId: string
        game: HoyoGame
      }) => {
        setPlatformId(next.platformId)
        setAccountId(next.accountId)
        setGame(next.game)
        const payload = {
          ...config.config,
          platformId: next.platformId,
          accountId: next.accountId,
          game: next.game,
        }
        if (typeof onConfigChange === 'function') {
          onConfigChange(payload)
        } else {
          window.dispatchEvent(
            new CustomEvent('widget-config-update', {
              detail: { widgetId: config.id, config: payload },
            }),
          )
        }
      },
      [config.config, config.id, onConfigChange],
    )

    const openSettings = useCallback(() => {
      if (!localRef.current) return
      openGamePresenceSettings(
        platformId,
        accountId,
        game,
        localRef.current.getBoundingClientRect(),
        persist,
      )
    }, [platformId, accountId, game, persist])

    const handlePressStart = useCallback(() => {
      if (!isEditMode) return
      isLongPressRef.current = false
      longPressTimerRef.current = setTimeout(() => {
        isLongPressRef.current = true
        openSettings()
      }, 500)
    }, [isEditMode, openSettings])

    const handlePressEnd = useCallback(() => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }, [])

    useEffect(() => {
      return () => {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
      }
    }, [])

    const handleClick = useCallback(() => {
      if (isLongPressRef.current) {
        isLongPressRef.current = false
        return
      }
      if (isEditMode) return
      const url = data?.profile_url
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    }, [isEditMode, data?.profile_url])

    const platformName = tw[platformMeta.nameKey]
    const hasAccount = Boolean(accountId)
    /** 米哈游偏展柜；主机偏在线状态 —— 共用数据模型，分体渲染 */
    const layoutKind: 'showcase' | 'presence' =
      platformId === 'hoyolab' ? 'showcase' : 'presence'

    const presenceMeta = useMemo(() => {
      if (!data?.presence) {
        return { statusLabel: null as string | null, title: null as string | null, online: false }
      }
      const raw = (data.presence.status || '').toLowerCase()
      const online =
        raw.includes('online') ||
        raw === 'available' ||
        Boolean(data.presence.title)
      let statusLabel: string | null = null
      if (data.presence.title) {
        statusLabel = tw.playing
      } else if (raw.includes('offline')) {
        statusLabel = tw.offline
      } else if (online) {
        statusLabel = tw.online
      } else if (data.presence.status && data.presence.status !== 'Unknown') {
        statusLabel = data.presence.status
      }
      return {
        statusLabel,
        title: data.presence.title || null,
        online,
      }
    }, [data, tw.playing, tw.online, tw.offline])

    // ---- 4x2 content: shared shell + platform body ----
    const content = useMemo(() => {
      if (!hasAccount) {
        return (
          <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-center px-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl border"
              style={{
                background: theme.softBgStrong,
                color: theme.primary,
                borderColor: theme.border,
              }}
            >
              {platformMeta.icon}
            </div>
            <div
              className="font-semibold"
              style={{ fontSize: `${14 * fontScale}px`, color: theme.primary }}
            >
              {platformName}
            </div>
            <span
              className="text-gray-500 dark:text-gray-400"
              style={{ fontSize: `${12 * fontScale}px` }}
            >
              {isEditMode ? tw.longPressToSetup : tw.notConfigured}
            </span>
          </div>
        )
      }

      if (loading && !data) {
        return (
          <div className="h-full w-full flex items-center justify-center">
            <div
              className="animate-spin rounded-full h-8 w-8 border-b-2 border-current opacity-50"
              style={{ color: theme.primary }}
            />
          </div>
        )
      }

      if (error && !data) {
        return (
          <div className="h-full w-full flex flex-col items-center justify-center gap-1.5 px-4 text-center">
            <span className="text-2xl" style={{ color: theme.primary }}>
              {platformMeta.icon}
            </span>
            <span
              className="text-gray-500 dark:text-gray-400"
              style={{ fontSize: `${12 * fontScale}px` }}
            >
              {error}
            </span>
          </div>
        )
      }

      const name = data?.identity.name || accountId
      const score = data?.score
      const avatar = data?.identity.avatar
      const subtitle =
        data?.identity.subtitle?.trim() ||
        (platformId === 'hoyolab' ? tw[game] : accountId)

      const avatarNode = avatar ? (
        <img
          src={avatar}
          alt=""
          className="w-14 h-14 rounded-2xl object-cover shrink-0 shadow-sm"
          style={{ boxShadow: `0 0 0 2px ${theme.border}` }}
          loading="lazy"
        />
      ) : (
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 text-2xl shadow-sm border"
          style={{
            background: theme.softBgStrong,
            color: theme.primary,
            borderColor: theme.border,
          }}
        >
          {platformMeta.icon}
        </div>
      )

      const scoreNode = score ? (
        <div
          className="shrink-0 rounded-2xl px-3 py-2 text-right min-w-18 border"
          style={{
            background: theme.softBgStrong,
            borderColor: theme.border,
          }}
        >
          <div
            className="font-bold tabular-nums leading-none"
            style={{ fontSize: `${24 * fontScale}px`, color: theme.primary }}
          >
            {score.value}
          </div>
          <div
            className="mt-1 text-gray-500 dark:text-gray-400"
            style={{ fontSize: `${11 * fontScale}px` }}
          >
            {score.label}
          </div>
        </div>
      ) : null

      // —— 米哈游：展柜型（等级 + 指标芯片 + 展柜角色）——
      if (layoutKind === 'showcase') {
        return (
          <div className="h-full w-full flex gap-4 min-h-0">
            <div className="flex flex-col gap-2.5 min-w-0 flex-[1.1]">
              <div className="flex items-start gap-3 min-w-0">
                {avatarNode}
                <div className="min-w-0 flex-1 pt-0.5">
                  <div
                    className="font-bold text-gray-900 dark:text-gray-50 truncate leading-tight"
                    style={{ fontSize: `${18 * fontScale}px` }}
                  >
                    {name}
                  </div>
                  <div
                    className="mt-0.5 truncate"
                    style={{
                      fontSize: `${12 * fontScale}px`,
                      color: theme.primary,
                    }}
                  >
                    {tw[game]}
                    <span className="text-gray-400 dark:text-gray-500">
                      {' · '}
                      {platformName}
                      {accountId ? ` · UID ${accountId}` : ''}
                    </span>
                  </div>
                  {subtitle && subtitle !== tw[game] && (
                    <div
                      className="mt-1 text-gray-400 dark:text-gray-500 line-clamp-2"
                      style={{ fontSize: `${11 * fontScale}px` }}
                    >
                      {subtitle}
                    </div>
                  )}
                </div>
                {scoreNode}
              </div>

              {data && data.highlights.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-auto">
                  {data.highlights
                    .filter((h) => h.label.toLowerCase() !== 'game')
                    .slice(0, 5)
                    .map((h) => (
                      <span
                        key={`${h.label}-${h.value}`}
                        className="inline-flex items-baseline gap-1 px-2.5 py-1 rounded-xl border text-gray-700 dark:text-gray-200"
                        style={{
                          fontSize: `${12 * fontScale}px`,
                          background: theme.chipBg,
                          borderColor: theme.border,
                        }}
                      >
                        <span className="opacity-55">{h.label}</span>
                        <span
                          className="font-semibold tabular-nums"
                          style={{ color: theme.primary }}
                        >
                          {h.value}
                        </span>
                      </span>
                    ))}
                </div>
              )}

              {data?.degraded && (
                <div
                  className="text-amber-600/90 dark:text-amber-400/90"
                  style={{ fontSize: `${11 * fontScale}px` }}
                  title={data.degrade_reason || undefined}
                >
                  {tw.degraded}
                </div>
              )}
            </div>

            <div
              className="flex flex-col min-w-0 flex-1 rounded-2xl px-3 py-2.5 border"
              style={{
                background: theme.panelBg,
                borderColor: theme.border,
              }}
            >
              <div
                className="font-semibold mb-2"
                style={{
                  fontSize: `${11 * fontScale}px`,
                  color: theme.primary,
                }}
              >
                {tw.showcase}
              </div>
              {data && data.showcase.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5 content-start flex-1 min-h-0 overflow-hidden">
                  {data.showcase.slice(0, 6).map((s, i) => (
                    <div
                      key={`${s.name}-${i}`}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl min-w-0 border"
                      style={{
                        background: isDark
                          ? 'rgba(0,0,0,0.28)'
                          : 'rgba(255,255,255,0.72)',
                        borderColor: theme.border,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{
                          background:
                            s.rarity && s.rarity >= 5
                              ? theme.accent
                              : theme.primary,
                        }}
                      />
                      <span
                        className="truncate text-gray-800 dark:text-gray-100 font-medium"
                        style={{ fontSize: `${12 * fontScale}px` }}
                      >
                        {s.name}
                      </span>
                      {s.level != null && (
                        <span
                          className="ml-auto shrink-0 tabular-nums"
                          style={{
                            fontSize: `${11 * fontScale}px`,
                            color: theme.primary,
                          }}
                        >
                          Lv.{s.level}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 text-center px-2"
                  style={{ fontSize: `${12 * fontScale}px` }}
                >
                  {tw.showcaseEmpty}
                </div>
              )}
            </div>
          </div>
        )
      }

      // —— Xbox / PSN：状态型 ——
      // 在线用平台主色；在玩用 accent；离线中性灰
      const presenceColor = presenceMeta.title
        ? theme.accent
        : presenceMeta.online
          ? theme.primary
          : '#9ca3af'

      return (
        <div className="h-full w-full flex gap-4 min-h-0">
          <div className="flex flex-col gap-2.5 min-w-0 flex-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                {avatarNode}
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-neutral-900"
                  style={{ background: presenceColor }}
                  title={presenceMeta.statusLabel || undefined}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="font-bold text-gray-900 dark:text-gray-50 truncate leading-tight"
                  style={{ fontSize: `${18 * fontScale}px` }}
                >
                  {name}
                </div>
                <div
                  className="mt-0.5 flex items-center gap-1.5 truncate"
                  style={{ fontSize: `${12 * fontScale}px` }}
                >
                  <span style={{ color: theme.primary }}>{platformName}</span>
                  {presenceMeta.statusLabel && (
                    <>
                      <span className="text-gray-400 opacity-50">·</span>
                      <span style={{ color: presenceColor }}>
                        {presenceMeta.statusLabel}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {scoreNode}
            </div>

            <div
              className="flex-1 min-h-0 rounded-2xl px-3.5 py-3 flex flex-col justify-center border"
              style={{
                background: presenceMeta.title
                  ? theme.gradient
                  : theme.softBg,
                borderColor: theme.border,
              }}
            >
              {presenceMeta.title ? (
                <>
                  <div
                    className="uppercase tracking-wide font-semibold"
                    style={{
                      fontSize: `${11 * fontScale}px`,
                      color: theme.primary,
                    }}
                  >
                    {tw.nowPlaying}
                  </div>
                  <div
                    className="mt-1 font-bold text-gray-900 dark:text-gray-50 line-clamp-2 leading-snug"
                    style={{ fontSize: `${18 * fontScale}px` }}
                  >
                    {presenceMeta.title}
                  </div>
                </>
              ) : (
                <>
                  <div
                    className="font-semibold"
                    style={{
                      fontSize: `${14 * fontScale}px`,
                      color: presenceColor,
                    }}
                  >
                    {presenceMeta.statusLabel || tw.statusUnknown}
                  </div>
                  <div
                    className="mt-1 text-gray-400 dark:text-gray-500"
                    style={{ fontSize: `${12 * fontScale}px` }}
                  >
                    {tw.noGameActivity}
                  </div>
                </>
              )}
            </div>

            {data?.degraded && (
              <div
                className="text-amber-600/90 dark:text-amber-400/90"
                style={{ fontSize: `${11 * fontScale}px` }}
                title={data.degrade_reason || undefined}
              >
                {tw.degraded}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 min-w-0 w-[34%] shrink-0">
            {data && data.highlights.length > 0 ? (
              data.highlights.slice(0, 4).map((h) => (
                <div
                  key={`${h.label}-${h.value}`}
                  className="flex-1 min-h-0 rounded-2xl px-3 py-2 flex flex-col justify-center border"
                  style={{
                    background: theme.softBg,
                    borderColor: theme.border,
                  }}
                >
                  <div
                    className="text-gray-500 dark:text-gray-400"
                    style={{ fontSize: `${11 * fontScale}px` }}
                  >
                    {h.label}
                  </div>
                  <div
                    className="font-bold tabular-nums"
                    style={{
                      fontSize: `${16 * fontScale}px`,
                      color: theme.primary,
                    }}
                  >
                    {h.value}
                  </div>
                </div>
              ))
            ) : (
              <div
                className="flex-1 rounded-2xl px-3 py-3 flex flex-col justify-center border"
                style={{
                  fontSize: `${12 * fontScale}px`,
                  background: theme.softBg,
                  borderColor: theme.border,
                }}
              >
                <div className="text-gray-500 dark:text-gray-400">
                  {tw.accountId}
                </div>
                <div className="mt-1 font-medium text-gray-800 dark:text-gray-100 break-all">
                  {accountId}
                </div>
              </div>
            )}
          </div>
        </div>
      )
    }, [
      hasAccount,
      loading,
      data,
      error,
      iconColor,
      platformMeta.icon,
      fontScale,
      isEditMode,
      tw,
      accountId,
      platformName,
      platformId,
      game,
      layoutKind,
      presenceMeta,
      theme,
      isDark,
    ])

    return (
      <WidgetShell
        containerRef={setRefs}
        scale={scale}
        background={
          <GlowBackground
            color={iconColor}
            animLevel={anim.level}
            shouldAnimate={anim.loop}
            variant="single"
            size="md"
          />
        }
        contentClassName={`flex flex-col ${!isEditMode && hasAccount ? 'cursor-pointer' : ''}`}
        className="select-none"
      >
        <div
          className="h-full w-full"
          onClick={handleClick}
          onMouseDown={handlePressStart}
          onMouseUp={handlePressEnd}
          onMouseLeave={handlePressEnd}
          onTouchStart={handlePressStart}
          onTouchEnd={handlePressEnd}
          onTouchCancel={handlePressEnd}
        >
          {content}
        </div>

        {/* Long-press hint in edit mode */}
        {isEditMode && (
          <motion.div
            className="absolute top-1.5 right-1.5 z-30 w-5 h-5 rounded-md flex items-center justify-center bg-black/15 dark:bg-white/15 backdrop-blur-sm pointer-events-none"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            title={tw.longPressHint}
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

GamePresenceWidget.displayName = 'GamePresenceWidget'

export { GamePresenceWidget, GamePresenceSettingsModal }
export default GamePresenceWidget
