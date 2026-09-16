/** 不认识 phantasi_sources。挂在 #bg-container，盖住壁纸、压在 #bg-gradient 底下。标题层另挂 z-4，压过渐变。 */

import type { SyntheticEvent } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  batchWrite,
  scheduleTask,
} from '../../../hooks/animation'
import {
  onPhantasiMotion,
  phantasiMotionClaim,
  phantasiMotionOwns,
  phantasiMotionQuiet,
  phantasiMotionRelease,
  whenPhantasiMotionIdle,
  whenPhantasiPeekReady,
} from '../../../hooks/animation/pages/phantasiMotion'
import { getIconUrl, getImageUrl } from '../constants'
import { cx } from './cx'

export const PHANTASI_PEEK_AIR_ID = 'phantasi-peek-air'
export const PHANTASI_PEEK_COPY_ID = 'phantasi-peek-copy'
export const PHANTASI_PEEK_EXIT_MS = 520

export interface PhantasiPeekFace {
  src: string
  title: string
  source: string
  sourceIcon: string | null
}

export function toPhantasiPeekFace(
  item: { title: string; image?: string | null },
  site: { name: string; icon?: string | null },
): PhantasiPeekFace | null {
  const image = item.image?.trim()
  const src = image ? getImageUrl(image) : null
  if (!src) return null
  return {
    src,
    title: item.title.trim(),
    source: site.name.trim(),
    sourceIcon: getIconUrl(site.icon ?? null),
  }
}

interface Layer {
  id: number
  face: PhantasiPeekFace
  on: boolean
}

let layerSeq = 0

function nextLayer(): number {
  layerSeq += 1
  return layerSeq
}

export function samePeekFace(
  a: PhantasiPeekFace | null,
  b: PhantasiPeekFace | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.src === b.src && a.title === b.title && a.source === b.source
}

let sessionFace: PhantasiPeekFace | null = null
const sessionListeners = new Set<() => void>()

export function readPeekFace(): PhantasiPeekFace | null {
  return sessionFace
}

export function subscribePeekFace(fn: () => void): () => void {
  sessionListeners.add(fn)
  return () => {
    sessionListeners.delete(fn)
  }
}

export function writePeekFace(next: PhantasiPeekFace | null): void {
  if (samePeekFace(sessionFace, next)) return
  sessionFace = next
  for (const fn of sessionListeners) fn()
}

/** 每次换卡都覆盖壁纸，包括没有封面的卡。 */
export function applyPeekFace(next: PhantasiPeekFace | null): boolean {
  writePeekFace(next)
  return next !== null
}

function sameFace(layer: Layer, face: PhantasiPeekFace): boolean {
  return samePeekFace(layer.face, face)
}

function hideBrokenPeekIcon(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.hidden = true
}

function PeekLede({ face }: { face: PhantasiPeekFace }) {
  return (
    <>
      {face.source || face.sourceIcon ? (
        <span className="phantasi-peek-air__site">
          {face.sourceIcon ? (
            <img src={face.sourceIcon} alt="" onError={hideBrokenPeekIcon} />
          ) : face.source ? (
            <span className="phantasi-peek-air__mark" aria-hidden>
              {face.source.slice(0, 1)}
            </span>
          ) : null}
          {face.source ? <span>{face.source}</span> : null}
        </span>
      ) : null}
      {face.title ? (
        <span className="phantasi-peek-air__title">{face.title}</span>
      ) : null}
    </>
  )
}

function afterPaint(fn: () => void): () => void {
  let cancelled = false
  const run = () => {
    if (!cancelled) fn()
  }
  batchWrite(() => {
    if (cancelled) return
    batchWrite(run)
  })
  return () => {
    cancelled = true
  }
}

export function PhantasiPeekAir({ face }: { face: PhantasiPeekFace | null }) {
  const [layers, setLayers] = useState<Layer[]>([])
  const host =
    typeof document === 'undefined'
      ? null
      : document.getElementById('bg-container')

  useEffect(() => {
    let cancelled = false
    let claimId = 0
    let exitTimer = 0
    const stops: Array<() => void> = []
    const quiet = phantasiMotionQuiet()
    const wait = quiet ? 0 : PHANTASI_PEEK_EXIT_MS

    const releaseClaim = () => {
      if (!claimId) return
      phantasiMotionRelease(claimId)
      claimId = 0
    }

    const takeClaim = (): boolean => {
      if (claimId && phantasiMotionOwns(claimId)) return true
      claimId = phantasiMotionClaim('peek')
      return phantasiMotionOwns(claimId)
    }

    if (!face) {
      releaseClaim()
      setLayers((current) => current.map((layer) => ({ ...layer, on: false })))
      if (quiet) {
        setLayers([])
        return () => {
          cancelled = true
        }
      }
      exitTimer = window.setTimeout(() => {
        if (!cancelled) setLayers([])
      }, wait)
      return () => {
        cancelled = true
        window.clearTimeout(exitTimer)
      }
    }

    const arm = () => {
      if (cancelled || !face) return
      setLayers((current) =>
        current.map((layer) => ({
          ...layer,
          on: sameFace(layer, face),
        })),
      )
    }

    const paint = () => {
      if (cancelled || !face) return
      setLayers((current) => {
        if (current.some((layer) => layer.on && sameFace(layer, face))) {
          return current
        }
        const outgoing = current.filter((layer) => layer.on).slice(-1)
        const existing = current.find((layer) => sameFace(layer, face))
        const incoming = existing ?? { id: nextLayer(), face, on: false }
        return [
          ...outgoing.filter((layer) => layer.id !== incoming.id),
          incoming,
        ]
      })
      if (quiet) {
        arm()
        return
      }
      stops.push(afterPaint(arm))
      exitTimer = window.setTimeout(() => {
        if (cancelled) return
        setLayers((current) =>
          current.filter((layer) => layer.on || sameFace(layer, face)),
        )
      }, wait)
    }

    const holdClaim = () => {
      if (cancelled || !face) return
      if (!takeClaim()) {
        stops.push(whenPhantasiMotionIdle(holdClaim))
        return
      }
      stops.push(whenPhantasiPeekReady(() => {}))
    }

    stops.push(
      onPhantasiMotion(() => {
        if (cancelled || !face) return
        if (!claimId || phantasiMotionOwns(claimId)) return
        claimId = 0
        stops.push(whenPhantasiMotionIdle(holdClaim))
      }),
    )

    paint()
    scheduleTask(holdClaim)
    const image = new Image()
    image.src = face.src
    image.onerror = () => {
      if (cancelled) return
      window.clearTimeout(exitTimer)
      setLayers((current) => current.map((layer) => ({ ...layer, on: false })))
      exitTimer = window.setTimeout(() => {
        if (!cancelled) setLayers([])
      }, wait)
    }

    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
      window.clearTimeout(exitTimer)
      for (const stop of stops) stop()
      releaseClaim()
    }
  }, [face])

  if (!host) return null
  const on = layers.some((layer) => layer.on)
  const swap = face != null && layers.length > 1
  return createPortal(
    <>
      <div
        id={PHANTASI_PEEK_AIR_ID}
        className={cx('phantasi-peek-air', on && 'is-on', swap && 'is-swap')}
        aria-hidden
      >
        {layers.map((layer) => (
          <span
            key={layer.id}
            className={cx('phantasi-peek-air__shot', layer.on && 'is-on')}
            style={{ backgroundImage: `url("${layer.face.src}")` }}
          />
        ))}
      </div>
      {layers.length ? (
        <div
          id={PHANTASI_PEEK_COPY_ID}
          className={cx('phantasi-peek-air__copy', swap && 'is-swap')}
          aria-hidden
        >
          {layers.map((layer) => (
            <div
              key={layer.id}
              className={cx('phantasi-peek-air__lede', layer.on && 'is-on')}
            >
              <PeekLede face={layer.face} />
            </div>
          ))}
        </div>
      ) : null}
    </>,
    host,
  )
}
