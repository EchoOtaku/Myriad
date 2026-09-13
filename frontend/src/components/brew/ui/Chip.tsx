/** 不碰订阅轨 flip，换树只改行属性。 */

import type { ReactNode } from 'react'

import { useLayoutEffect, useRef, useState } from 'react'
import { brewMotionClaim, brewMotionRelease, brewTagQuiet } from '../../../hooks/animation/pages/brew'
import { awaitLaneSwap, planChipLaneSwap } from '../../../hooks/animation/pages/brewChipPresence'

export function useBrewWaveLane(
  wave: string,
  children: ReactNode,
  play: (node: HTMLElement | null) => {
    wait: number
    waapi: boolean
    done: Promise<void>
  },
  onDisplayed?: (wave: string) => void,
  occupy?: boolean,
) {
  const rowRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef(false)
  const laneTokenRef = useRef<number | null>(null)
  const [revision, setRevision] = useState(0)
  useLayoutEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
      exitingRef.current = false
      if (laneTokenRef.current != null) brewMotionRelease(laneTokenRef.current)
    }
  }, [])
  const oldChildrenRef = useRef(children)
  const incomingRef = useRef(children)
  const pendingWaveRef = useRef(wave)
  const exitingRef = useRef(false)
  const shownRef = useRef(wave)
  incomingRef.current = children

  const [shown, setShown] = useState(wave)
  const [exiting, setExiting] = useState(false)
  const [exitHow, setExitHow] = useState<'waapi' | 'css'>('css')
  shownRef.current = shown
  const onDisplayedRef = useRef(onDisplayed)
  onDisplayedRef.current = onDisplayed

  if (!exiting && wave === shown) {
    oldChildrenRef.current = children
  }

  useLayoutEffect(() => {
    onDisplayedRef.current?.(shown)
  }, [shown])

  useLayoutEffect(() => {
    const plan = planChipLaneSwap(shownRef.current, wave, exitingRef.current)
    if (plan === 'hold') {
      oldChildrenRef.current = incomingRef.current
      return
    }
    pendingWaveRef.current = wave
    if (plan === 'retarget') return

    if (brewTagQuiet()) {
      shownRef.current = wave
      oldChildrenRef.current = incomingRef.current
      exitingRef.current = false
      setShown(wave)
      setExiting(false)
      return
    }

    const token = occupy ? brewMotionClaim('lane') : null
    laneTokenRef.current = token
    const { wait, waapi, done } = play(rowRef.current)
    exitingRef.current = true
    setExitHow(waapi ? 'waapi' : 'css')
    setExiting(true)

    const finish = () => {
      if (!liveRef.current || !exitingRef.current) return
      exitingRef.current = false
      const next = pendingWaveRef.current
      shownRef.current = next
      oldChildrenRef.current = incomingRef.current
      setShown(next)
      setRevision((value) => value + 1)
      setExiting(false)
      if (token != null) brewMotionRelease(token)
    }

    void awaitLaneSwap(done, wait).then(finish)
    return () => {
      if (exitingRef.current) return
      if (token != null) brewMotionRelease(token)
    }
  }, [wave, play, occupy])

  const frozen = exiting || wave !== shown
  return {
    rowRef,
    revision,
    frozen,
    exiting,
    exitHow,
    shown,
    view: frozen ? oldChildrenRef.current : children,
  }
}
