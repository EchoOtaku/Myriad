/** 不认识 brew_sources。挂在 #bg-container，盖住壁纸、压在 #bg-gradient 底下。标题层另挂 z-4，压过渐变。 */

import type { SyntheticEvent } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getIconUrl, getImageUrl } from '../constants'
import { brewMotionQuiet } from '../../../hooks/animation/pages/brewMotion'
import { cx } from './cx'

export const BREW_PEEK_AIR_ID = 'brew-peek-air'
export const BREW_PEEK_COPY_ID = 'brew-peek-copy'
export const BREW_PEEK_EXIT_MS = 360

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

type Shot = {
  id: number
  src: string
  on: boolean
}

type CopyLayer = {
  id: number
  face: BrewPeekFace
  on: boolean
}

let shotSeq = 0

function nextShot(): number {
  shotSeq += 1
  return shotSeq
}

function hideBrokenPeekIcon(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.hidden = true
}

export function BrewPeekAir({ face }: { face: BrewPeekFace | null }) {
  const src = face?.src ?? null
  const [shots, setShots] = useState<Shot[]>([])
  const [copies, setCopies] = useState<CopyLayer[]>([])
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

    if (!src) {
      setShots((current) => current.map((shot) => ({ ...shot, on: false })))
      exitTimer = window.setTimeout(() => {
        if (!cancelled) setShots([])
      }, wait)
      return () => {
        cancelled = true
        window.clearTimeout(exitTimer)
      }
    }

    const image = new Image()
    image.src = src
    const show = () => {
      if (cancelled) return
      setShots((current) => {
        if (current.some((shot) => shot.src === src && shot.on)) return current
        const outgoing = current.filter((shot) => shot.on).slice(-1)
        return [...outgoing, { id: nextShot(), src, on: false }]
      })
      const arm = () => {
        if (cancelled) return
        setShots((current) =>
          current.map((shot) =>
            shot.src === src
              ? { ...shot, on: true }
              : { ...shot, on: false },
          ),
        )
      }
      if (quiet) arm()
      else {
        frame = window.requestAnimationFrame(() => {
          frame = window.requestAnimationFrame(arm)
        })
      }
      exitTimer = window.setTimeout(() => {
        if (!cancelled) {
          setShots((current) =>
            current.filter((shot) => shot.on || shot.src === src),
          )
        }
      }, wait)
    }
    if (image.complete && image.naturalWidth > 0) show()
    else {
      image.onload = show
      image.onerror = () => {
        if (cancelled) return
        setShots((current) => current.map((shot) => ({ ...shot, on: false })))
      }
    }
    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
      window.clearTimeout(exitTimer)
      window.cancelAnimationFrame(frame)
    }
  }, [src])

  useEffect(() => {
    let cancelled = false
    let exitTimer = 0
    let frame = 0
    const quiet = brewMotionQuiet()
    const wait = quiet ? 0 : BREW_PEEK_EXIT_MS

    if (!face) {
      setCopies((current) => current.map((layer) => ({ ...layer, on: false })))
      exitTimer = window.setTimeout(() => {
        if (!cancelled) setCopies([])
      }, wait)
      return () => {
        cancelled = true
        window.clearTimeout(exitTimer)
      }
    }

    const ready = shots.some((shot) => shot.on && shot.src === face.src)
    if (!ready) return

    const same = (layer: CopyLayer) =>
      layer.face.src === face.src && layer.face.title === face.title

    setCopies((current) => {
      if (current.some((layer) => layer.on && same(layer))) return current
      const outgoing = current.filter((layer) => layer.on).slice(-1)
      return [...outgoing, { id: nextShot(), face, on: false }]
    })

    const arm = () => {
      if (cancelled) return
      setCopies((current) =>
        current.map((layer) => ({ ...layer, on: same(layer) })),
      )
    }
    if (quiet) arm()
    else {
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(arm)
      })
    }
    exitTimer = window.setTimeout(() => {
      if (!cancelled) {
        setCopies((current) =>
          current.filter((layer) => layer.on || same(layer)),
        )
      }
    }, wait)
    return () => {
      cancelled = true
      window.clearTimeout(exitTimer)
      window.cancelAnimationFrame(frame)
    }
  }, [face, shots])

  if (!host) return null
  const on = shots.some((shot) => shot.on)
  return createPortal(
    <>
      <div
        id={BREW_PEEK_AIR_ID}
        className={cx('brew-peek-air', on && 'is-on')}
        aria-hidden
      >
        {shots.map((shot) => (
          <span
            key={shot.id}
            className={cx('brew-peek-air__shot', shot.on && 'is-on')}
            style={{ backgroundImage: `url("${shot.src}")` }}
          />
        ))}
      </div>
      {copies.length ? (
        <div
          id={BREW_PEEK_COPY_ID}
          className="brew-peek-air__copy"
          aria-hidden
        >
          {copies.map((layer) => (
            <div
              key={layer.id}
              className={cx('brew-peek-air__lede', layer.on && 'is-on')}
            >
              {layer.face.source || layer.face.sourceIcon ? (
                <span className="brew-peek-air__site">
                  {layer.face.sourceIcon ? (
                    <img
                      src={layer.face.sourceIcon}
                      alt=""
                      onError={hideBrokenPeekIcon}
                    />
                  ) : layer.face.source ? (
                    <span className="brew-peek-air__mark" aria-hidden>
                      {layer.face.source.slice(0, 1)}
                    </span>
                  ) : null}
                  {layer.face.source ? <span>{layer.face.source}</span> : null}
                </span>
              ) : null}
              {layer.face.title ? (
                <span className="brew-peek-air__title">{layer.face.title}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>,
    host,
  )
}
