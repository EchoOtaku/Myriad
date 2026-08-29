/**
 * 思考/在做时给流光两层现场上色，隔几秒换一层淡入。
 * 颜色写在元素自己的自定义属性上，伪元素继承。
 */

import type { RefObject } from 'react'
import { useLayoutEffect } from 'react'
import { applyAuroraPrism, paintAuroraPrism } from './agentAuroraRandom'

function isPrismStatus(status: string): boolean {
  return status === 'thinking' || status === 'working'
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

function paintLayer(el: HTMLElement | null): void {
  if (!el) return
  applyAuroraPrism(el, paintAuroraPrism(Math.random, isDark()))
}

export function useAgentAuroraPrism(
  status: string,
  enabled: boolean,
  layerA: RefObject<HTMLElement | null>,
  layerB: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    if (!enabled || !isPrismStatus(status)) return
    const a = layerA.current
    const b = layerB.current
    if (!a || !b) return

    let current = 0
    const layers = [a, b] as const
    const show = (index: number) => {
      paintLayer(layers[index])
      layers[index].dataset.active = 'true'
      layers[1 - index].removeAttribute('data-active')
      current = index
    }
    show(0)

    if (prefersReducedMotion()) return

    let timer = 0
    const schedule = () => {
      timer = window.setTimeout(() => {
        show(1 - current)
        schedule()
      }, 5200 + Math.random() * 7000)
    }
    schedule()
    return () => {
      window.clearTimeout(timer)
    }
  }, [status, enabled, layerA, layerB])
}
