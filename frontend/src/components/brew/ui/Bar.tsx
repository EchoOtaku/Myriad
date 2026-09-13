import type { ReactNode, Ref } from 'react'

import { cx } from './cx'
import './brew.css'

export function BrewMark({ children }: { children: ReactNode }) {
  return (
    <span className="brew-bar__mark" aria-hidden>
      {children}
    </span>
  )
}

export function BrewBarWrap({
  children,
  wrapRef,
}: {
  children: ReactNode
  wrapRef?: Ref<HTMLDivElement>
}) {
  return (
    <div className="brew-bar__wrap" ref={wrapRef}>
      {children}
    </div>
  )
}

export function BrewBarMenu({ children }: { children: ReactNode }) {
  return (
    <div className="brew-bar__menu" role="listbox">
      {children}
    </div>
  )
}

export function BrewBarMenuItem({
  children,
  on,
  onClick,
}: {
  children: ReactNode
  on?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      className={cx('brew-bar__menu-item', on && 'is-on')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
