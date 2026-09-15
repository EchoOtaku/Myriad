import type { ReactNode } from 'react'

export function FormBlock({
  title,
  hint,
  children,
}: {
  title?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="phantasi-add-form__block">
      {title ? <h3 className="phantasi-add-form__block-title">{title}</h3> : null}
      {hint ? <p className="phantasi-add-form__block-hint">{hint}</p> : null}
      <div className="phantasi-add-form__block-body">{children}</div>
    </section>
  )
}
