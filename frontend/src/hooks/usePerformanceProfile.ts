import { useEffect, useRef, useState } from 'react'
import {
  collectHardwareSignals,
  detectAppleSiliconAsync,
  evaluateHighHardware,
  type HardwareSignals,
  type OsKind,
} from '../utils/deviceHardwareTier'

/**
 * 设备性能画像与动态特性检测
 * - 分平台硬件门槛 → highHardware / lowEndDevice
 * - 供 useAnimationLevel 映射 standard/light/exlight
 */
export interface PerformanceProfile {
  isMobile: boolean
  reduceMotion: boolean
  /**
   * 未达「高硬件」门槛（或 reduceMotion）。
   * 动画侧：不达标时用户高/低 = light / exlight。
   */
  lowEndDevice: boolean
  /** 是否达到分平台高硬件标准（与 reduceMotion 无关） */
  highHardware: boolean
  os: OsKind
  hardwareConcurrency: number | null
  deviceMemory: number | null
  /** debug */
  hardwareReason?: string
}

// SSR 安全的默认值 - 乐观策略：假设为中高端设备
const DEFAULT_PROFILE: PerformanceProfile = {
  isMobile: false,
  reduceMotion: false,
  lowEndDevice: false,
  highHardware: true,
  os: 'unknown',
  hardwareConcurrency: null,
  deviceMemory: null,
}

// 🔧 性能优化：全局缓存检测结果，避免重复检测
let cachedProfile: PerformanceProfile | null = null
let hasDetected = false

function buildProfile(
  signals: HardwareSignals,
  reduceMotion: boolean,
  isMobile: boolean,
): PerformanceProfile {
  const tier = evaluateHighHardware(signals)
  // reduceMotion 不改变 highHardware 字段，但 lowEndDevice 对旧调用方仍表示「应降级」
  const lowEndDevice = reduceMotion || !tier.highHardware
  return {
    isMobile,
    reduceMotion,
    lowEndDevice,
    highHardware: tier.highHardware,
    os: signals.os,
    hardwareConcurrency: signals.cores,
    deviceMemory: signals.memoryGiB,
    hardwareReason: tier.reason,
  }
}

function detectPerformanceProfile(): PerformanceProfile {
  // 🔧 优化：如果已经检测过，直接返回缓存
  if (hasDetected && cachedProfile) {
    return cachedProfile
  }

  // 每次调用时检测浏览器环境
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return DEFAULT_PROFILE
  }

  try {
    const isMobile = window.matchMedia(
      '(hover: none) and (pointer: coarse)',
    ).matches
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const signals = collectHardwareSignals()
    const profile = buildProfile(signals, reduceMotion, isMobile)

    cachedProfile = profile
    hasDetected = true

    return profile
  } catch (e) {
    console.warn('Failed to detect performance profile:', e)
    return DEFAULT_PROFILE
  }
}

/**
 * 同步获取性能配置（用于模块初始化时，非 React 上下文）
 * 返回当前检测到的设备性能画像
 */
export function getPerformanceProfileSync(): PerformanceProfile {
  return detectPerformanceProfile()
}

/** 测试或 macOS async 补全后清空缓存 */
export function resetPerformanceProfileCache(): void {
  hasDetected = false
  cachedProfile = null
}

/** 将低端标记同步到 <html>，激活 performance.css 中的 [data-low-end-device] 规则 */
function syncLowEndToDocument(profile: PerformanceProfile) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (profile.lowEndDevice) {
    root.dataset.lowEndDevice = 'true'
  } else {
    delete root.dataset.lowEndDevice
  }
  root.dataset.deviceOs = profile.os
  root.dataset.highHardware = profile.highHardware ? 'true' : 'false'
  if (profile.hardwareReason) {
    root.dataset.hardwareReason = profile.hardwareReason
  }
}

export function usePerformanceProfile(): PerformanceProfile {
  // 🔧 SSR 安全：始终使用默认值作为初始状态，避免 hydration 不匹配
  const [profile, setProfile] = useState<PerformanceProfile>(DEFAULT_PROFILE)
  const hasInitialized = useRef(false)

  // 客户端初始化：在组件挂载后检测真实性能配置
  useEffect(() => {
    if (hasInitialized.current) return
    hasInitialized.current = true

    const detected = detectPerformanceProfile()
    syncLowEndToDocument(detected)
    setProfile(detected)

    // macOS：异步补全 architecture（Apple Silicon）
    if (detected.os === 'macos') {
      void detectAppleSiliconAsync().then((appleSilicon) => {
        if (appleSilicon == null) return
        const signals = collectHardwareSignals()
        signals.appleSilicon = appleSilicon
        const isMobile = window.matchMedia(
          '(hover: none) and (pointer: coarse)',
        ).matches
        const reduceMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches
        const next = buildProfile(signals, reduceMotion, isMobile)
        resetPerformanceProfileCache()
        cachedProfile = next
        hasDetected = true
        syncLowEndToDocument(next)
        setProfile(next)
      })
    }
  }, [])

  // 监听 reduceMotion 变化
  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => {
      resetPerformanceProfileCache()
      const next = detectPerformanceProfile()
      syncLowEndToDocument(next)
      setProfile(next)
    }

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  return profile
}
