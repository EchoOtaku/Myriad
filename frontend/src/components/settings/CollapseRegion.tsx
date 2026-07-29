/**
 * 折叠区域：高度从 0 到内容高的动画容器。
 *
 * 用 grid-template-rows 0fr→1fr 做高度动画（不需要测量内容高，
 * 内容变化时也不会失准）。收起播完动画才卸载子节点，
 * 展开落定后把 overflow 放开——组内的下拉菜单 / 气泡要能溢出。
 *
 * 状态机：collapsed →(下一帧) entering →(播完) open →(收起) collapsed →(播完) 卸载
 */

import type { ReactNode } from 'react'

import React, { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion, SETTINGS_DURATION_MS } from './motion'
import './settings-motion.css'

type CollapseState = 'collapsed' | 'entering' | 'open'

export interface CollapseRegionProps {
  open: boolean
  children: ReactNode
  className?: string
}

export const CollapseRegion: React.FC<CollapseRegionProps> = ({
  open,
  children,
  className = '',
}) => {
  const [mounted, setMounted] = useState(open)
  const [state, setState] = useState<CollapseState>(open ? 'open' : 'collapsed')
  /** 首帧就展开时不播入场（整页加载不该看到所有组一起长出来） */
  const isFirstRun = useRef(true)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const first = isFirstRun.current
    isFirstRun.current = false
    window.clearTimeout(timerRef.current)

    const settleDelay = prefersReducedMotion() ? 0 : SETTINGS_DURATION_MS.slow

    if (open) {
      setMounted(true)
      if (first) {
        setState('open')
        return undefined
      }

      // 先以收起态渲染一帧，下一帧再切展开，否则两次变更合成一帧、不产生过渡
      setState('collapsed')
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          setState('entering')
          timerRef.current = window.setTimeout(setState, settleDelay, 'open')
        })
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }

    setState('collapsed')
    if (first) {
      setMounted(false)
      return undefined
    }
    timerRef.current = window.setTimeout(setMounted, settleDelay, false)
    return undefined
  }, [open])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  if (!mounted) return null

  return (
    <div
      className={`sm-collapse ${className}`.trim()}
      data-state={state}
      aria-hidden={!open || undefined}
    >
      <div className="sm-collapse-inner">{children}</div>
    </div>
  )
}

CollapseRegion.displayName = 'CollapseRegion'

export default CollapseRegion
