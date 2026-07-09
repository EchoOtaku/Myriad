import { useContext, useEffect, useMemo } from 'react'
import { AnimationPreferenceContext } from '../contexts/AnimationPreferenceContext'
import { configureAnimationCoordinator } from './animation'
import {
  getPerformanceProfileSync,
  usePerformanceProfile,
} from './usePerformanceProfile'

export type AnimationLevel = 'none' | 'light' | 'standard'

export interface AnimationConfig {
  level: AnimationLevel
  // helpers
  loop: boolean // allow infinite loops
  spring: boolean // allow spring physics
  durationScale: number // multiply base duration
}

const CONFIG_NONE: AnimationConfig = {
  level: 'none',
  loop: false,
  spring: false,
  durationScale: 0.0,
}

const CONFIG_LIGHT: AnimationConfig = {
  level: 'light',
  loop: false,
  spring: false,
  durationScale: 0.6,
}

const CONFIG_STANDARD: AnimationConfig = {
  level: 'standard',
  loop: true,
  spring: true,
  durationScale: 1.0,
}

/**
 * 同步获取动画配置（用于模块初始化时）
 * 注意：首次渲染前可能尚未读到用户手动偏好；偏好生效后请用 getCurrentAnimationConfig
 */
export function getAnimationConfigSync(): AnimationConfig {
  const perf = getPerformanceProfileSync()

  // prefers-reduced-motion 优先（无法被手动覆盖）
  if (perf.reduceMotion) {
    return CONFIG_NONE
  }

  // 客户端：尊重 localStorage 中的用户手动偏好
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('animation-preference')
      if (stored === 'light') return CONFIG_LIGHT
      if (stored === 'standard') return CONFIG_STANDARD
      // 'auto' 或未设置：走硬件检测
    } catch {
      // ignore storage access errors
    }
  }

  // 低端设备
  if (perf.lowEndDevice) {
    return CONFIG_LIGHT
  }

  // 标准设备
  return CONFIG_STANDARD
}

/** 模块级缓存：供非 React 回调（如音乐呼吸动画）读取用户偏好后的真实级别 */
let currentAnimationConfig: AnimationConfig = getAnimationConfigSync()

/**
 * 获取当前生效的动画配置（含用户手动「低性能/中高性能」偏好）
 * 由 useAnimationLevel 挂载后持续更新
 */
export function getCurrentAnimationConfig(): AnimationConfig {
  return currentAnimationConfig
}

/** 是否处于需要性能降级的模式（light / none） */
export function isReducedAnimation(config?: AnimationConfig): boolean {
  const level = (config ?? currentAnimationConfig).level
  return level === 'light' || level === 'none'
}

function syncPerfModeToDocument(level: AnimationLevel): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.perfMode = level
  // 不改写 blur / 壁纸相关样式；仅供脚本与未来非模糊类降级钩子使用
}

export function useAnimationLevel(): AnimationConfig {
  const perf = usePerformanceProfile()
  const prefContext = useContext(AnimationPreferenceContext)

  const config = useMemo(() => {
    // prefers-reduced-motion 优先（无法被手动覆盖）
    if (perf.reduceMotion) {
      return CONFIG_NONE
    }

    // 如果有手动设置的偏好，使用手动偏好
    if (prefContext?.preference && prefContext.preference !== 'auto') {
      if (prefContext.preference === 'light') {
        return CONFIG_LIGHT
      }
      if (prefContext.preference === 'standard') {
        return CONFIG_STANDARD
      }
    }

    // 自动检测：低端设备
    if (perf.lowEndDevice) {
      return CONFIG_LIGHT
    }
    // 自动检测：标准设备
    return CONFIG_STANDARD
  }, [perf.reduceMotion, perf.lowEndDevice, prefContext?.preference])

  // 同步模块缓存 + DOM 标记，供非 React 路径与样式钩子读取
  useEffect(() => {
    currentAnimationConfig = config
    syncPerfModeToDocument(config.level)
  }, [config])

  // 根据性能级别自动配置动画协调器
  useEffect(() => {
    const isMobile = perf.isMobile

    switch (config.level) {
      case 'none':
        // 完全禁用动画时，最小化并发
        configureAnimationCoordinator({
          baseConcurrent: 4,
          burstConcurrent: 8,
          burstDuration: 3000,
          maxLoopSlots: 2,
        })
        break
      case 'light':
        // 低端设备，限制同时动画数量
        configureAnimationCoordinator({
          baseConcurrent: isMobile ? 6 : 10,
          burstConcurrent: isMobile ? 16 : 24,
          burstDuration: 6000,
          maxLoopSlots: isMobile ? 4 : 6,
        })
        break
      case 'standard':
        // 标准/高性能设备，允许更多并发动画
        // 🔥 提高并发限制以充分利用高端 GPU
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
