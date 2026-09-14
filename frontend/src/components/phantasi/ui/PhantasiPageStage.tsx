import type { ReactNode } from 'react'

export function PhantasiPageStage({
  title,
  children,
}: {
  title: ReactNode
  children: ReactNode
}) {
  return (
    <div className="phantasi-page">
      <div className="phantasi-page__air" aria-hidden />
      <div className="phantasi-page__stage">
        {title}
        <div className="phantasi-page__body">{children}</div>
      </div>
    </div>
  )
}
