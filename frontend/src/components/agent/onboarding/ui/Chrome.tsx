import type { ComponentType, ReactNode, SVGProps } from 'react'
import { LuArrowRight, LuLoader2 } from '@lib/icons'

type Glyph = ComponentType<SVGProps<SVGSVGElement>>

export function StepBody({ children }: { children: ReactNode }) {
  return <div className="life-ob-body sm-stagger">{children}</div>
}

export function GhostButton({
  label,
  icon: Icon,
  disabled,
  plain = false,
  onClick,
}: {
  label: string
  icon?: Glyph
  disabled?: boolean
  plain?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`life-ghost-button${plain ? ' life-ghost-button--text' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {Icon && <Icon aria-hidden />}
      {label}
    </button>
  )
}

export function PrimaryButton({
  label,
  icon: Icon = LuArrowRight,
  busy = false,
  disabled = false,
  onClick,
}: {
  label: string
  icon?: Glyph | null
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="life-primary-button life-ob-cta"
      disabled={disabled || busy}
      onClick={onClick}
    >
      <span>{label}</span>
      {busy ? (
        <LuLoader2 className="is-spinning" aria-hidden />
      ) : Icon ? (
        <Icon aria-hidden />
      ) : null}
    </button>
  )
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <footer className="life-ob-bar">{children}</footer>
}
