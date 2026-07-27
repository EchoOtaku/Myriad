import { useContext, useEffect, useMemo } from 'react'
import { AnimationPreferenceContext } from '../contexts/AnimationPreferenceContext'
import { configureAnimationCoordinator } from './animation'
import {
  getPerformanceProfileSync,
  type PerformanceProfile,
  usePerformanceProfile,
} from './usePerformanceProfile'

/**
 * Effective animation / visual-effects tier after hardware mapping.
 *
 * User still toggles two preferences only (`light` | `standard` in storage):
 * - Meets hardware bar:  low → `light`,  high → `standard`
 * - Below hardware bar:  low → `exlight`, high → `light`
 *
 * `prefers-reduced-motion` also resolves to `exlight` (former `none` merged in).
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
  /** Aggressive global backdrop kill (modals, glass, non-Tailwind). */
  killAllBackdrop: boolean
}

/**
 * Minimal tier — weak-hardware "low" slot AND prefers-reduced-motion.
 * Former `none` is fully merged here.
 */
const CONFIG_EXLIGHT: AnimationConfig = {
  level: 'exlight',
  loop: false,
  spring: false,
  durationScale: 0.4,
  widgetGlow: false,
  widgetUiRotation: false,
  killAllBackdrop: true,
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
  killAllBackdrop: false,
}

const CONFIG_STANDARD: AnimationConfig = {
  level: 'standard',
  loop: true,
  spring: true,
  durationScale: 1.0,
  widgetGlow: true,
  widgetUiRotation: true,
  killAllBackdrop: false,
}

/**
 * Whether the device may run the full `standard` tier as its "high" slot.
 *
 * Product will replace this with explicit hardware requirements later.
 * Interim: same signal as today's non-lowEnd path (`!lowEndDevice`).
 */
export function meetsAnimationHardwareRequirement(
  perf: PerformanceProfile,
): boolean {
  // TODO(product): replace with real hardware bar (cores / memory / frame sample).
  return !perf.lowEndDevice
}

/**
 * Map two-way user preference → effective config under current hardware.
 *
 * - prefers-reduced-motion → always `exlight` (not overridable)
 * - `wantHigh === true`  →  capable: standard · weak: light
 * - `wantHigh === false` →  capable: light    · weak: exlight
 * - `auto` prefers the high slot of the allowed pair
 */
export function resolveAnimationConfig(
  userPref: AnimationUserPreference | null | undefined,
  perf: PerformanceProfile,
): AnimationConfig {
  // System reduced-motion: same minimal tier as weak-hardware "low"
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
    // auto / unset: pick the high slot of the hardware-allowed pair
    wantHigh = true
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
  return resolveAnimationConfig(readStoredUserPreference() ?? 'auto', perf)
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

/** 是否处于需要性能降级的模式（exlight / light） */
export function isReducedAnimation(config?: AnimationConfig): boolean {
  const level = (config ?? currentAnimationConfig).level
  return level === 'exlight' || level === 'light'
}

/** Minimal tier (exlight): no glow, no widget UI rotation, kill all backdrops. */
export function isExlight(level?: AnimationLevel): boolean {
  const l = level ?? currentAnimationConfig.level
  return l === 'exlight'
}

/** @deprecated use isExlight — `none` was merged into exlight */
export function isExlightOrNone(level?: AnimationLevel): boolean {
  return isExlight(level)
}

function syncPerfModeToDocument(level: AnimationLevel): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.perfMode = level
}

export function useAnimationLevel(): AnimationConfig {
  const perf = usePerformanceProfile()
  const prefContext = useContext(AnimationPreferenceContext)

  const config = useMemo(() => {
    const pref = (prefContext?.preference ??
      readStoredUserPreference() ??
      'auto') as AnimationUserPreference
    return resolveAnimationConfig(pref, perf)
  }, [perf, prefContext?.preference])

  // 同步模块缓存 + DOM 标记，供非 React 路径与样式钩子读取
  useEffect(() => {
    currentAnimationConfig = config
    syncPerfModeToDocument(config.level)
  }, [config])

  // 根据性能级别自动配置动画协调器
  useEffect(() => {
    const isMobile = perf.isMobile

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
  }, [config.level, perf.isMobile])

  return config
}
