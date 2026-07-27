import { useEffect, useRef, useState } from 'react'
import {
  collectHardwareSignals,
  detectAppleSiliconAsync,
  evaluateHighHardware,
  type HardwareSignals,
  type OsKind,
} from '../utils/deviceHardwareTier'

/**
 * 设备性能画像
 *
 * 硬件是否达标只看 `highHardware`（分平台规则见 deviceHardwareTier）。
 * 动效降级看 `data-perf-mode` / useAnimationLevel（exlight|light|standard），
 * 不再维护独立的 lowEndDevice 布尔。
 */
export interface PerformanceProfile {
  isMobile: boolean
  reduceMotion: boolean
  /** 是否达到分平台高硬件标准（与 reduceMotion 无关） */
  highHardware: boolean
  os: OsKind
  hardwareConcurrency: number | null
  deviceMemory: number | null
  /** 判定原因；仅 dev 写入 DOM */
  hardwareReason?: string
}

const DEFAULT_PROFILE: PerformanceProfile = {
  isMobile: false,
  reduceMotion: false,
  highHardware: true,
  os: 'unknown',
  hardwareConcurrency: null,
  deviceMemory: null,
}

let cachedProfile: PerformanceProfile | null = null
let hasDetected = false

function buildProfile(
  signals: HardwareSignals,
  reduceMotion: boolean,
  isMobile: boolean,
): PerformanceProfile {
  const tier = evaluateHighHardware(signals)
  return {
    isMobile,
    reduceMotion,
    highHardware: tier.highHardware,
    os: signals.os,
    hardwareConcurrency: signals.cores,
    deviceMemory: signals.memoryGiB,
    hardwareReason: tier.reason,
  }
}

function detectPerformanceProfile(): PerformanceProfile {
  if (hasDetected && cachedProfile) {
    return cachedProfile
  }

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

export function getPerformanceProfileSync(): PerformanceProfile {
  return detectPerformanceProfile()
}

export function resetPerformanceProfileCache(): void {
  hasDetected = false
  cachedProfile = null
}

/** Sync hardware flags to <html> for CSS / debug (no lowEndDevice). */
function syncHardwareToDocument(profile: PerformanceProfile) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // Drop legacy marker if any
  delete root.dataset.lowEndDevice

  root.dataset.deviceOs = profile.os
  root.dataset.highHardware = profile.highHardware ? 'true' : 'false'

  // hardwareReason 仅开发构建挂 DOM，避免生产泄漏设备指纹式信息
  const isDev =
    typeof import.meta !== 'undefined' &&
    // Vite
    Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)
  if (isDev && profile.hardwareReason) {
    root.dataset.hardwareReason = profile.hardwareReason
  } else {
    delete root.dataset.hardwareReason
  }
}

function readViewportFlags() {
  const isMobile = window.matchMedia(
    '(hover: none) and (pointer: coarse)',
  ).matches
  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
  return { isMobile, reduceMotion }
}

export function usePerformanceProfile(): PerformanceProfile {
  const [profile, setProfile] = useState<PerformanceProfile>(DEFAULT_PROFILE)
  const hasInitialized = useRef(false)

  useEffect(() => {
    if (hasInitialized.current) return
    hasInitialized.current = true

    let cancelled = false
    const apply = (next: PerformanceProfile) => {
      if (cancelled) return
      resetPerformanceProfileCache()
      cachedProfile = next
      hasDetected = true
      syncHardwareToDocument(next)
      setProfile(next)
    }

    const detected = detectPerformanceProfile()
    syncHardwareToDocument(detected)
    setProfile(detected)

    // macOS：同步路径可能认不出芯片（保守 low）。异步 architecture 确认后再升/降。
    // 先保持 conservative 结果，避免 Intel 误开 standard。
    if (detected.os === 'macos') {
      void detectAppleSiliconAsync().then((appleSilicon) => {
        if (cancelled || appleSilicon == null) return
        const signals = collectHardwareSignals()
        if (signals.appleSilicon === appleSilicon) return
        signals.appleSilicon = appleSilicon
        const { isMobile, reduceMotion } = readViewportFlags()
        apply(buildProfile(signals, reduceMotion, isMobile))
      })
    }

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => {
      resetPerformanceProfileCache()
      const next = detectPerformanceProfile()
      syncHardwareToDocument(next)
      setProfile(next)
    }

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  return profile
}
