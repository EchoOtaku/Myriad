import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx'

export function BrewRailTitle({
  id,
  children,
  action,
  arrive = 0,
}: {
  id?: string
  children: string
  action?: ReactNode
  arrive?: number | false
}) {
  const entering = arrive !== false
  return (
    <div
      className={cx('brew-rail-title', entering && 'is-arrive')}
      data-brew-surface={entering ? 'title' : undefined}
      style={
        typeof arrive === 'number'
          ? ({ '--brew-card-i': arrive } as CSSProperties)
          : undefined
      }
    >
      <h2 className="brew-rail-title__label" id={id}>
        {children}
      </h2>
      {action}
    </div>
  )
}
