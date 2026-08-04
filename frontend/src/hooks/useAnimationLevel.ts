import type { PerformanceProfile } from './usePerformanceProfile'
import {
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import { AnimationPreferenceContext } from '../contexts/AnimationPreferenceContext'
import {
  getStoredAutoWantHigh,
  startAutoFrameAdapt,
} from '../utils/animationAutoAdapt'
import { configureAnimationCoordinator } from './animation'
import {
  getPerformanceProfileSync,

  usePerformanceProfile,
} from './usePerformanceProfile'

/**
 * Effective animation / visual-effects tier after hardware mapping.
 *
 * User still toggles two preferences only (`light` | `standard` in storage):
 * - Meets hardware bar:  low → `light`,  high → `standard`
 * - Below hardware bar:  low → `exlight`, high → `light`
 *
 * `prefers-reduced-motion` also resolves to `exlight`.
 */
export type AnimationLevel = 'exlight' | 'light' | 'standard'

/** User-facing two-way preference stored in localStorage (plus `auto`). */
export type AnimationUserPreference = 'auto' | 'standard' | 'light'

export interface AnimationConfig {
  level: AnimationLevel
  /** Allow infinite loops (CSS/JS). */
  loop: boolean
  /** Allow spring physics. */
  spring: boolean
  /** Multiply base duration. */
  durationScale: number
  /** Widget GlowBackground (static or animated). */
  widgetGlow: boolean
  /** Widget UI carousels / overview↔detail auto flip. */
  widgetUiRotation: boolean
}

/**
 * Minimal tier — weak-hardware "low" slot AND prefers-reduced-motion.
 * Global backdrop kill is CSS-driven via `html[data-perf-mode=exlight]`.
 */
const CONFIG_EXLIGHT: AnimationConfig = {
  level: 'exlight',
  loop: false,
  spring: false,
  durationScale: 0.4,
  widgetGlow: false,
  widgetUiRotation: false,
}

/**
 * Mid / capable-hardware "low" / weak-hardware "high".
 * Same visual budget as the former `light` tier.
 */
const CONFIG_LIGHT: AnimationConfig = {
  level: 'light',
  loop: false,
  spring: false,
  durationScale: 0.6,
  widgetGlow: true,
  widgetUiRotation: true,
}

const CONFIG_STANDARD: AnimationConfig = {
  level: 'standard',
  loop: true,
  spring: true,
  durationScale: 1.0,
  widgetGlow: true,
  widgetUiRotation: true,
}

/** Anything with a `.level` field (AnimationConfig, sandbox ref, etc.). */
type LevelLike = AnimationLevel | { level: AnimationLevel } | null | undefined

function asLevel(input?: LevelLike): AnimationLevel | undefined {
  if (input == null) return undefined
  if (typeof input === 'string') return input
  return input.level
}

/** Full-effects tier (standard only). */
export function isStandardAnimation(input?: LevelLike): boolean {
  return asLevel(input ?? currentAnimationConfig) === 'standard'
}

/** Minimal tier (exlight). */
export function isExlight(input?: LevelLike): boolean {
  return asLevel(input ?? currentAnimationConfig) === 'exlight'
}

/** Any non-standard tier (light | exlight) — prefer this over duplicating level checks. */
export function isReducedAnimation(input?: LevelLike): boolean {
  const level = asLevel(input ?? currentAnimationConfig)
  return level === 'exlight' || level === 'light'
}

/**
 * Whether the device may run the full `standard` tier as its "high" slot.
 * Rules: `utils/deviceHardwareTier.ts` → `perf.highHardware`.
 */
export function meetsAnimationHardwareRequirement(
  perf: PerformanceProfile,
): boolean {
  return perf.highHardware === true
}

/**
 * Map two-way user preference → effective config under current hardware.
 *
 * - prefers-reduced-motion → always `exlight` (not overridable)
 * - `wantHigh === true`  →  capable: standard · weak: light
 * - `wantHigh === false` →  capable: light    · weak: exlight
 * - `auto`：默认高档；采样仅在帧质**明显很差**时降为低档，记 localStorage（可降不可升）
 * - 手动 standard / light：不走采样
 */
export function resolveAnimationConfig(
  userPref: AnimationUserPreference | null | undefined,
  perf: PerformanceProfile,
  /** auto 是否选高档（localStorage）；仅 userPref 为 auto 时生效 */
  autoWantHigh: boolean = true,
): AnimationConfig {
  if (perf.reduceMotion) {
    return CONFIG_EXLIGHT
  }

  const capable = meetsAnimationHardwareRequirement(perf)
  let wantHigh: boolean
  if (userPref === 'light') {
    wantHigh = false
  } else if (userPref === 'standard') {
    wantHigh = true
  } else {
    // auto / unset
    wantHigh = autoWantHigh
  }

  if (capable) {
    return wantHigh ? CONFIG_STANDARD : CONFIG_LIGHT
  }
  return wantHigh ? CONFIG_LIGHT : CONFIG_EXLIGHT
}

function readStoredUserPreference(): AnimationUserPreference | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = localStorage.getItem('animation-preference')
    if (stored === 'auto' || stored === 'standard' || stored === 'light') {
      return stored
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * 同步获取动画配置（用于模块初始化时）
 * 注意：首次渲染前可能尚未读到用户手动偏好；偏好生效后请用 getCurrentAnimationConfig
 */
export function getAnimationConfigSync(): AnimationConfig {
  const perf = getPerformanceProfileSync()
  const pref = readStoredUserPreference() ?? 'auto'
  const autoWantHigh =
    pref === 'auto' || pref == null ? getStoredAutoWantHigh() : true
  return resolveAnimationConfig(pref, perf, autoWantHigh)
}

/** 模块级缓存：供非 React 回调（如音乐呼吸动画）读取用户偏好后的真实级别 */
let currentAnimationConfig: AnimationConfig = getAnimationConfigSync()

/**
 * 获取当前生效的动画配置（含用户手动「低/高」偏好 + 硬件映射）
 * 由 useAnimationLevel 挂载后持续更新
 */
export function getCurrentAnimationConfig(): AnimationConfig {
  return currentAnimationConfig
}

function syncPerfModeToDocument(level: AnimationLevel): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.perfMode = level
}

/*
 * 模块加载时立刻写 data-perf-mode（仅客户端）。
 * 避免首屏在 useEffect 前仍按 standard 画毛玻璃；
 * 解析结果与 resolveAnimationConfig 一致：正常硬件默认仍是 standard/light，
 * 不会把正常设备误标成 exlight。
 */
if (typeof document !== 'undefined') {
  try {
    syncPerfModeToDocument(currentAnimationConfig.level)
  } catch {
    /* ignore */
  }
}

/* ============================================================
   全局副作用去重
   ------------------------------------------------------------
   resolveAnimationConfig 返回的是三个模块常量之一，所有实例本来就
   拿到同一个对象；但下面三件事都是**全局**副作用，此前每个消费者
   （首页十几个小组件都经此 hook）挂载时各跑一遍：
     · 写 <html data-perf-mode>        → N 次全文档样式失效
     · 写 currentAnimationConfig      → N 次同值赋值
     · configureAnimationCoordinator  → N 次同参重配全局协调器
     · startAutoFrameAdapt 的 demote 监听 → N 份监听器
   这里用模块级「上次已应用」闸门收敛成一次。
   ============================================================ */

/** demote 后 +1；订阅者据此重读 localStorage 的 auto 高低档 */
let _autoEpoch = 0
const _autoEpochListeners = new Set<() => void>()
let _autoAdaptStarted = false

function getAutoEpochSnapshot(): number {
  return _autoEpoch
}

function subscribeAutoEpoch(onStoreChange: () => void): () => void {
  _autoEpochListeners.add(onStoreChange)

  // 全局只注册一份 demote 监听（探测本身另有 probeStarted 闸）
  if (!_autoAdaptStarted) {
    _autoAdaptStarted = true
    startAutoFrameAdapt({
      enabled: true,
      onDemote: () => {
        _autoEpoch += 1
        for (const listener of _autoEpochListeners) listener()
      },
    })
  }

  return () => {
    _autoEpochListeners.delete(onStoreChange)
  }
}

/** 已应用到全局的档位/形态，避免同值重复写 DOM 与重配协调器 */
let _appliedCoordinatorLevel: AnimationLevel | null = null
let _appliedCoordinatorIsMobile: boolean | null = null

function applyAnimationConfigGlobals(
  config: AnimationConfig,
  isMobile: boolean,
): void {
  if (currentAnimationConfig !== config) {
    currentAnimationConfig = config
    syncPerfModeToDocument(config.level)
  }

  if (
    _appliedCoordinatorLevel === config.level &&
    _appliedCoordinatorIsMobile === isMobile
  ) {
    return
  }
  _appliedCoordinatorLevel = config.level
  _appliedCoordinatorIsMobile = isMobile

  switch (config.level) {
    case 'exlight':
      configureAnimationCoordinator({
        baseConcurrent: 4,
        burstConcurrent: 8,
        burstDuration: 3000,
        maxLoopSlots: 2,
      })
      break
    case 'light':
      configureAnimationCoordinator({
        baseConcurrent: isMobile ? 6 : 10,
        burstConcurrent: isMobile ? 16 : 24,
        burstDuration: 6000,
        maxLoopSlots: isMobile ? 4 : 6,
      })
      break
    case 'standard':
      configureAnimationCoordinator({
        baseConcurrent: isMobile ? 12 : 20,
        burstConcurrent: isMobile ? 32 : 64,
        burstDuration: 10000,
        maxLoopSlots: isMobile ? 8 : 16,
      })
      break
  }
}

export function useAnimationLevel(): AnimationConfig {
  const perf = usePerformanceProfile()
  const prefContext = useContext(AnimationPreferenceContext)
  const pref = (prefContext?.preference ??
    readStoredUserPreference() ??
    'auto') as AnimationUserPreference

  // localStorage 为 auto 高/低真源；epoch 在 demote 后 +1 触发重读。
  // 手动档不订阅（也就不会启动采样探测），与此前 `pref !== 'auto'` 早退等价。
  const isAuto = pref === 'auto' && !perf.reduceMotion
  const autoEpoch = useSyncExternalStore(
    isAuto ? subscribeAutoEpoch : noopSubscribe,
    getAutoEpochSnapshot,
    getAutoEpochSnapshot,
  )

  const autoWantHigh = useMemo(() => {
    // autoEpoch 在 demote 后 +1，仅用于触发重读 localStorage，不参与计算
    void autoEpoch
    if (pref !== 'auto' && pref != null) return true
    return getStoredAutoWantHigh()
  }, [pref, autoEpoch])

  const config = useMemo(
    () => resolveAnimationConfig(pref, perf, autoWantHigh),
    [perf, pref, autoWantHigh],
  )

  useEffect(() => {
    applyAnimationConfigGlobals(config, perf.isMobile)
  }, [config, perf.isMobile])

  return config
}

function noopSubscribe(): () => void {
  return () => {}
}
