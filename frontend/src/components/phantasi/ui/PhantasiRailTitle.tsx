import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx'

export function PhantasiRailTitle({
  id,
  children,
  action,
  arrive = 0,
  pinned = false,
}: {
  id?: string
  children: string
  action?: ReactNode
  arrive?: number | false
  pinned?: boolean
}) {
  const entering = arrive !== false
  return (
    <div
      className={cx(
        'phantasi-rail-title',
        entering && 'is-arrive',
        pinned && 'is-actions-on',
      )}
      data-phantasi-surface={entering ? 'title' : undefined}
      style={
        typeof arrive === 'number'
          ? ({ '--phantasi-card-i': arrive } as CSSProperties)
          : undefined
      }
    >
      <h2 className="phantasi-rail-title__label" id={id}>
        {children}
      </h2>
      {action ? (
        <div className="phantasi-rail-title__actions">{action}</div>
      ) : null}
    </div>
  )
}
