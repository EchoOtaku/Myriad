import type { ReactNode } from 'react'

export function BrewPageStage({
  title,
  children,
}: {
  title: ReactNode
  children: ReactNode
}) {
  return (
    <div className="brew-page">
      <div className="brew-page__air" aria-hidden />
      <div className="brew-page__stage">
        {title}
        <div className="brew-page__body">{children}</div>
      </div>
    </div>
  )
}
