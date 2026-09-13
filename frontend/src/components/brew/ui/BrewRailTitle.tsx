import type { ReactNode } from 'react'

export function BrewRailTitle({
  id,
  children,
  action,
}: {
  id: string
  children: string
  action?: ReactNode
}) {
  return (
    <div className="brew-rail-title">
      <h2 className="brew-rail-title__label" id={id}>
        {children}
      </h2>
      {action}
    </div>
  )
}
