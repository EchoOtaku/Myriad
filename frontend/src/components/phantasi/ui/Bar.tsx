import type { ReactNode, Ref } from 'react'

import { cx } from './cx'
import './phantasi.css'

export function PhantasiMark({ children }: { children: ReactNode }) {
  return (
    <span className="phantasi-bar__mark" aria-hidden>
      {children}
    </span>
  )
}

export function PhantasiBarWrap({
  children,
  wrapRef,
}: {
  children: ReactNode
  wrapRef?: Ref<HTMLDivElement>
}) {
  return (
    <div className="phantasi-bar__wrap" ref={wrapRef}>
      {children}
    </div>
  )
}

export function PhantasiBarMenu({ children }: { children: ReactNode }) {
  return (
    <div className="phantasi-bar__menu" role="listbox">
      {children}
    </div>
  )
}

export function PhantasiBarMenuItem({
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
      className={cx('phantasi-bar__menu-item', on && 'is-on')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
