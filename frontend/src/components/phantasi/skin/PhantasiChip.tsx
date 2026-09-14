/** 板块 / 视图换树：先揭订阅轨，再整舞台同退。 */

import type { ReactNode } from 'react'
import { useCallback, useLayoutEffect } from 'react'

import { playPhantasiSurfaceEnter, playPhantasiSurfaceExit } from '../../../hooks/animation/pages/phantasiChipPresence'
import { usePhantasiWaveLane } from '../ui/Chip'
import { revealFeedsTree } from './flipCards'

export function PhantasiViewLane({
  children,
  wave,
  className,
  onDisplayed,
  suspended = false,
}: {
  children: ReactNode
  wave: string
  className?: string
  onDisplayed?: (wave: string) => void
  suspended?: boolean
}) {
  const play = useCallback((node: HTMLElement | null) => {
    revealFeedsTree(node)
    return playPhantasiSurfaceExit(node)
  }, [])
  const { rowRef, revision, frozen, exiting, exitHow, shown, view } = usePhantasiWaveLane(
    wave,
    children,
    play,
    onDisplayed,
    true,
  )

  useLayoutEffect(() => {
    if (revision > 0 && !frozen) playPhantasiSurfaceEnter(rowRef.current)
  }, [revision, frozen, rowRef])

  return (
    <div
      className={`phantasi-view-lane${className ? ` ${className}` : ''}`}
      ref={rowRef}
      inert={frozen || suspended || undefined}
      data-chip-phase={exiting ? 'exit' : 'enter'}
      data-chip-exit={exiting ? exitHow : undefined}
      data-phantasi-view={shown}
    >
      {view}
    </div>
  )
}
