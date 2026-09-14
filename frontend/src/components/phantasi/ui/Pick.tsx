import { LuCheck as Check } from '@lib/icons'

import { cx } from './cx'

export function PhantasiPick({ on }: { on: boolean }) {
  return (
    <span className={cx('phantasi-pick', on && 'is-on')} aria-hidden>
      <Check />
    </span>
  )
}
