import { useMemo } from 'react'

import { isExlight, useAnimationLevel } from '../../useAnimationLevel'
import { registerPageCleanup } from '../core'
import { phantasiMotionQuiet, phantasiMotionReset } from './phantasiMotion'

export { phantasiMotionClaim, phantasiMotionRelease } from './phantasiMotion'
export { phantasiTagQuiet } from './phantasiTag'

type AnimationConfig = ReturnType<typeof useAnimationLevel>

const _PAGE_ID = 'phantasi'
const VEIL_ENTER_DELAY_MS = 48
const VEIL_EXIT_MS = 560

let phantasiVeilEnterTimer = 0
let phantasiVeilExitTimer = 0

function phantasiVeilQuiet(): boolean {
  return phantasiMotionQuiet()
}

/** 内容就绪后加深底部遮罩（范围 + 浓度）。 */
export function playPhantasiVeilEnter(): void {
  if (typeof document === 'undefined') return
  window.clearTimeout(phantasiVeilExitTimer)
  phantasiVeilExitTimer = 0

  const root = document.documentElement
  const host = document.getElementById('bg-gradient')
  root.setAttribute('data-phantasi-veil', '')
  if (!host) return

  let bloom = document.getElementById('phantasi-veil-bloom')
  if (!bloom) {
    bloom = document.createElement('div')
    bloom.id = 'phantasi-veil-bloom'
    bloom.setAttribute('aria-hidden', 'true')
    host.appendChild(bloom)
    void bloom.offsetWidth
  }

  window.clearTimeout(phantasiVeilEnterTimer)
  phantasiVeilEnterTimer = window.setTimeout(() => {
    if (phantasiVeilQuiet()) bloom.style.opacity = '1'
    else bloom.classList.add('is-on')
    phantasiVeilEnterTimer = 0
  }, VEIL_ENTER_DELAY_MS)
}

/** 离开时先收浓度，再卸节点，避免硬切。 */
export function playPhantasiVeilExit(): void {
  if (typeof document === 'undefined') return
  window.clearTimeout(phantasiVeilEnterTimer)
  window.clearTimeout(phantasiVeilExitTimer)
  phantasiVeilEnterTimer = 0

  document.documentElement.removeAttribute('data-phantasi-veil')
  const bloom = document.getElementById('phantasi-veil-bloom')
  if (!bloom) return

  bloom.classList.remove('is-on')
  bloom.style.removeProperty('opacity')
  if (phantasiVeilQuiet()) {
    bloom.remove()
    return
  }
  phantasiVeilExitTimer = window.setTimeout(() => {
    document.getElementById('phantasi-veil-bloom')?.remove()
    phantasiVeilExitTimer = 0
  }, VEIL_EXIT_MS + 40)
}

/** startPage('phantasi') 由 useRouteScheduler 统一调用。 */
export function usePhantasiScheduler(): void {}

// 按 level 缓存，避免每次新对象。
const ANIM_CONFIG_CACHE = new Map<
  string,
  ReturnType<typeof usePhantasiAnimationConfig>
>()

export function usePhantasiAnimationConfig(): AnimationConfig {
  const baseConfig = useAnimationLevel()

  return useMemo(() => {
    const cacheKey = baseConfig.level
    const cached = ANIM_CONFIG_CACHE.get(cacheKey)
    if (cached?.level === baseConfig.level) {
      return cached
    }

    ANIM_CONFIG_CACHE.set(cacheKey, baseConfig)
    return baseConfig
  }, [baseConfig])
}

export const phantasiAnimationPresets = {

  readerEnter: {
    initial: { opacity: 0, y: 40 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 40 },
  },
} as const

export function getPhantasiTransition(
  animConfig: AnimationConfig,
  type: 'reader' = 'reader',
): { duration: number; ease: [number, number, number, number] } {
  const durations = {
    reader:
      isExlight(animConfig)
        ? 0
        : animConfig.level === 'light'
          ? 0.2
          : 0.4,
  }

  return {
    duration: durations[type],
    ease: [0.16, 1, 0.3, 1],
  }
}

function cleanupPhantasi(): void {
  ANIM_CONFIG_CACHE.clear()
  phantasiMotionReset()
  playPhantasiVeilExit()
}

registerPageCleanup(_PAGE_ID, cleanupPhantasi)
