/** 不认识 brew_sources。挂在 #bg-container，盖住壁纸、压在 #bg-gradient 底下。标题层另挂 z-4，压过渐变。 */

import type { SyntheticEvent } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getIconUrl, getImageUrl } from '../constants'
import { brewMotionQuiet } from '../../../hooks/animation/pages/brewMotion'
import { cx } from './cx'

export const BREW_PEEK_AIR_ID = 'brew-peek-air'
export const BREW_PEEK_COPY_ID = 'brew-peek-copy'
export const BREW_PEEK_EXIT_MS = 520
export const BREW_PEEK_HANDOFF_MS = 100

export type BrewPeekFace = {
  src: string
  title: string
  source: string
  sourceIcon: string | null
}

export function toBrewPeekFace(
  item: { title: string; image?: string | null },
  site: { name: string; icon?: string | null },
): BrewPeekFace | null {
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

type Layer = {
  id: number
  face: BrewPeekFace
  on: boolean
}

let layerSeq = 0

function nextLayer(): number {
  layerSeq += 1
  return layerSeq
}

function sameFace(layer: Layer, face: BrewPeekFace): boolean {
  return layer.face.src === face.src && layer.face.title === face.title
}

function hideBrokenPeekIcon(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.hidden = true
}

function PeekLede({ face }: { face: BrewPeekFace }) {
  return (
    <>
      {face.source || face.sourceIcon ? (
        <span className="brew-peek-air__site">
          {face.sourceIcon ? (
            <img src={face.sourceIcon} alt="" onError={hideBrokenPeekIcon} />
          ) : face.source ? (
            <span className="brew-peek-air__mark" aria-hidden>
              {face.source.slice(0, 1)}
            </span>
          ) : null}
          {face.source ? <span>{face.source}</span> : null}
        </span>
      ) : null}
      {face.title ? (
        <span className="brew-peek-air__title">{face.title}</span>
      ) : null}
    </>
  )
}

export function BrewPeekAir({ face }: { face: BrewPeekFace | null }) {
  const [layers, setLayers] = useState<Layer[]>([])
  const host =
    typeof document === 'undefined'
      ? null
      : document.getElementById('bg-container')

  useEffect(() => {
    let cancelled = false
    let exitTimer = 0
    let frame = 0
    const quiet = brewMotionQuiet()
    const wait = quiet ? 0 : BREW_PEEK_EXIT_MS

    if (!face) {
      setLayers((current) => current.map((layer) => ({ ...layer, on: false })))
      exitTimer = window.setTimeout(() => {
        if (!cancelled) setLayers([])
      }, wait)
      return () => {
        cancelled = true
        window.clearTimeout(exitTimer)
      }
    }

    const reveal = () => {
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
      const arm = () => {
        if (cancelled || !face) return
        setLayers((current) =>
          current.map((layer) => ({
            ...layer,
            on: sameFace(layer, face),
          })),
        )
      }
      if (quiet) {
        arm()
        return
      }
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(arm)
      })
      exitTimer = window.setTimeout(() => {
        if (!cancelled) {
          setLayers((current) =>
            current.filter((layer) => layer.on || sameFace(layer, face)),
          )
        }
      }, wait)
    }

    const image = new Image()
    image.src = face.src
    if (image.complete && image.naturalWidth > 0) reveal()
    else {
      image.onload = reveal
      image.onerror = () => {
        if (cancelled) return
        setLayers((current) => current.map((layer) => ({ ...layer, on: false })))
      }
    }
    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
      window.clearTimeout(exitTimer)
      window.cancelAnimationFrame(frame)
    }
  }, [face])

  if (!host) return null
  const on = layers.some((layer) => layer.on)
  const swap = face != null && layers.length > 1
  return createPortal(
    <>
      <div
        id={BREW_PEEK_AIR_ID}
        className={cx('brew-peek-air', on && 'is-on', swap && 'is-swap')}
        aria-hidden
      >
        {layers.map((layer) => (
          <span
            key={layer.id}
            className={cx('brew-peek-air__shot', layer.on && 'is-on')}
            style={{ backgroundImage: `url("${layer.face.src}")` }}
          />
        ))}
      </div>
      {layers.length ? (
        <div
          id={BREW_PEEK_COPY_ID}
          className={cx('brew-peek-air__copy', swap && 'is-swap')}
          aria-hidden
        >
          {layers.map((layer) => (
            <div
              key={layer.id}
              className={cx('brew-peek-air__lede', layer.on && 'is-on')}
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
