/** Small presentational controls used across the store surface. */

import type { MouseEvent, ReactNode } from 'react'
import {
  AnimatePresenceShim as AnimatePresence,
  motionShim as motion,
} from '@lib/motionShim'
import {

  useEffect,
  useMemo,
  useState,
} from 'react'
import { isExlight, useAnimationLevel } from '../../../hooks/useAnimationLevel'

/** App Store 风格分类芯片 */
export function CategoryPill({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active ? 'true' : 'false'}
      className="as-store__cat"
    >
      {label}
    </button>
  )
}

/** 获取 / 打开 / 更新 胶囊按钮 */
export function StoreGetButton({
  kind,
  label,
  disabled,
  onClick,
  title,
}: {
  kind: 'get' | 'open' | 'update' | 'busy'
  label: ReactNode
  disabled?: boolean
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  title?: string
}) {
  return (
    <button
      type="button"
      className={`as-get as-get--${kind}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  )
}

/** Progress percent with a smaller `%` so the digits stay readable. */
export function ProgressPercent({
  value,
  className = '',
}: {
  value: number
  className?: string
}) {
  return (
    <span className={`tabular-nums font-bold leading-none ${className}`}>
      {Math.round(value)}
      <span className="text-[0.72em] font-semibold opacity-80">%</span>
    </span>
  )
}

/** Hero subtitle: cross-fade between category and author. */
export function RotatingDetailSubtitle({ lines }: { lines: string[] }) {
  const animConfig = useAnimationLevel()
  const reduced = isExlight(animConfig)
  const [index, setIndex] = useState(0)
  const unique = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const line of lines) {
      const text = line.trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      out.push(text)
    }
    return out
  }, [lines])

  useEffect(() => {
    setIndex(0)
  }, [unique.join('\0')])

  useEffect(() => {
    if (unique.length <= 1 || reduced) return
    const id = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % unique.length)
    }, 3200)
    return () => window.clearInterval(id)
  }, [unique, reduced])

  if (unique.length === 0) return null

  const active = reduced ? unique.join(' · ') : unique[index % unique.length]

  return (
    <p className="as-detail__category" aria-live="polite">
      {reduced ? (
        <span className="as-detail__subtitle-line">{active}</span>
      ) : (
        <span className="as-detail__subtitle-viewport">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={active}
              className="as-detail__subtitle-line"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.35 * animConfig.durationScale,
                ease: 'easeInOut',
              }}
            >
              {active}
            </motion.span>
          </AnimatePresence>
        </span>
      )}
    </p>
  )
}
