import type { ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'

/**
 * 动效偏好（用户只在两档间切换；落地档位由硬件是否达标映射）
 * - 'auto': 取当前硬件允许对中的「高」档
 * - 'standard': 用户选「高」→ 达标 hardware: standard · 不达标: light
 * - 'light': 用户选「低」→ 达标 hardware: light · 不达标: exlight
 *
 * 真正的 AnimationLevel（exlight | light | standard）见 useAnimationLevel。
 * prefers-reduced-motion 与弱机「低」档均落到 exlight（已无独立 none）。
 */
export type AnimationPreference = 'auto' | 'standard' | 'light'

interface AnimationPreferenceContextType {
  preference: AnimationPreference
  setPreference: (pref: AnimationPreference) => void
  togglePerformanceMode: () => void // 在 standard 和 light 之间切换
}

const AnimationPreferenceContext = createContext<
  AnimationPreferenceContextType | undefined
>(undefined)

// Export the context for direct useContext access
export { AnimationPreferenceContext }

const STORAGE_KEY = 'animation-preference'

export function AnimationPreferenceProvider({
  children,
}: {
  children: ReactNode
}) {
  const [preference, setPreferenceState] = useState<AnimationPreference>(() => {
    // 从 localStorage 读取用户偏好
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'auto' || stored === 'standard' || stored === 'light') {
        return stored
      }
    }
    return 'auto' // 默认自动检测
  })

  // 保存偏好到 localStorage
  const setPreference = (pref: AnimationPreference) => {
    setPreferenceState(pref)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, pref)
    }
  }

  // 两档切换：高(standard) ↔ 低(light)。硬件映射在 useAnimationLevel 内完成。
  const togglePerformanceMode = () => {
    const currentMode = preference === 'auto' ? 'standard' : preference
    const newMode = currentMode === 'standard' ? 'light' : 'standard'
    setPreference(newMode)
  }

  return (
    <AnimationPreferenceContext.Provider
      value={{ preference, setPreference, togglePerformanceMode }}
    >
      {children}
    </AnimationPreferenceContext.Provider>
  )
}

export function useAnimationPreference() {
  const context = useContext(AnimationPreferenceContext)
  if (context === undefined) {
    throw new Error(
      'useAnimationPreference must be used within AnimationPreferenceProvider',
    )
  }
  return context
}
