/** 板块 / 视图换树：先揭订阅轨，再整舞台同退。 */

import type { ReactNode } from 'react'
import { useCallback, useLayoutEffect } from 'react'

import { playBrewSurfaceEnter, playBrewSurfaceExit } from '../../../hooks/animation/pages/brewChipPresence'
import { useBrewWaveLane } from '../ui/Chip'
import { revealFeedsTree } from './flipCards'

export function BrewViewLane({
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
    return playBrewSurfaceExit(node)
  }, [])
  const { rowRef, revision, frozen, exiting, exitHow, shown, view } = useBrewWaveLane(
    wave,
    children,
    play,
    onDisplayed,
    true,
  )

  useLayoutEffect(() => {
    if (revision > 0 && !frozen) playBrewSurfaceEnter(rowRef.current)
  }, [revision, frozen, rowRef])

  return (
    <div
      className={`brew-view-lane${className ? ` ${className}` : ''}`}
      ref={rowRef}
      inert={frozen || suspended || undefined}
      data-chip-phase={exiting ? 'exit' : 'enter'}
      data-chip-exit={exiting ? exitHow : undefined}
      data-brew-view={shown}
    >
      {view}
    </div>
  )
}
