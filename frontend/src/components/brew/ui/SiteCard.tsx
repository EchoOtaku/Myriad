/** 不认识 brew_sources。 */

import type { CSSProperties } from 'react'

import { LuEdit3 as Edit3 } from '@lib/icons'

import { memo, useEffect, useRef, useState } from 'react'
import { brewMotionQuiet } from '../../../hooks/animation/pages/brewMotion'
import { cx } from './cx'
import { BrewPick } from './Pick'

const STACK_SIZE = 3
const STACK_DWELL_MS = 4000
const STACK_TUCK_MS = 200
const STACK_MOVE_MS = 720

export type SiteStackFace = {
  key: string
  src?: string | null
  mark?: string
  ink?: string | null
}

type StackSlot = 'back' | 'mid' | 'front' | 'tuck'

type StackSeat = {
  id: number
  slot: StackSlot
  face: SiteStackFace
}

function turnStackSlot(slot: StackSlot): StackSlot {
  if (slot === 'front' || slot === 'tuck') return 'back'
  if (slot === 'back') return 'mid'
  return 'front'
}

function padStackFaces(faces: readonly SiteStackFace[]): SiteStackFace[] {
  const shown = faces.slice(0, STACK_SIZE)
  while (shown.length < STACK_SIZE) {
    shown.push({ key: `pad-${shown.length}` })
  }
  return shown
}

function seatsFromPool(faces: readonly SiteStackFace[]): StackSeat[] {
  const shown = padStackFaces(faces)
  return [
    { id: 0, slot: 'back', face: shown[2]! },
    { id: 1, slot: 'mid', face: shown[1]! },
    { id: 2, slot: 'front', face: shown[0]! },
  ]
}

function SiteStack({
  faces,
  live = true,
}: {
  faces?: readonly SiteStackFace[]
  live?: boolean
}) {
  const pool = faces ?? []
  const roster = [...new Set(pool.map((face) => face.key))].toSorted().join(',')
  const poolRef = useRef(pool)
  poolRef.current = pool
  const cursorRef = useRef(Math.min(STACK_SIZE, pool.length))
  const [seats, setSeats] = useState(() => seatsFromPool(pool))

  useEffect(() => {
    setSeats(seatsFromPool(poolRef.current))
    cursorRef.current = Math.min(STACK_SIZE, poolRef.current.length)
  }, [roster])

  useEffect(() => {
    if (!live || brewMotionQuiet() || poolRef.current.length < 2) return
    let dwell = 0
    let tuck = 0
    let move = 0
    const play = () => {
      dwell = window.setTimeout(() => {
        if (document.hidden) {
          play()
          return
        }
        setSeats((current) =>
          current.map((seat) =>
            seat.slot === 'front' ? { ...seat, slot: 'tuck' } : seat,
          ),
        )
        tuck = window.setTimeout(() => {
          setSeats((current) =>
            current.map((seat) => ({
              ...seat,
              slot: turnStackSlot(seat.slot),
            })),
          )
          move = window.setTimeout(() => {
            const next = poolRef.current
            if (next.length > STACK_SIZE) {
              setSeats((current) =>
                current.map((seat) => {
                  if (seat.slot !== 'back') return seat
                  const face = next[cursorRef.current % next.length]!
                  cursorRef.current += 1
                  return { ...seat, face }
                }),
              )
            }
            play()
          }, STACK_MOVE_MS)
        }, STACK_TUCK_MS)
      }, STACK_DWELL_MS)
    }
    play()
    return () => {
      window.clearTimeout(dwell)
      window.clearTimeout(tuck)
      window.clearTimeout(move)
      setSeats((current) =>
        current.map((seat) =>
          seat.slot === 'tuck' ? { ...seat, slot: 'front' } : seat,
        ),
      )
    }
  }, [live, roster])

  return (
    <span className="brew-site__stack" aria-hidden>
      <span className="brew-site__stack-deck">
        {seats.map((seat) => (
          <span
            key={seat.id}
            className={cx('brew-site__stack-face', `is-${seat.slot}`)}
            style={
              seat.face.ink
                ? ({ '--site-ink': seat.face.ink } as CSSProperties)
                : undefined
            }
          >
            {seat.face.src ? (
              <img
                key={seat.face.key}
                src={seat.face.src}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(event) => {
                  event.currentTarget.style.display = 'none'
                }}
              />
            ) : seat.face.mark ? (
              <b key={seat.face.key}>{seat.face.mark}</b>
            ) : null}
          </span>
        ))}
      </span>
    </span>
  )
}

function SiteCardInner({
  id,
  name,
  description,
  icon,
  unread,
  latestTitle,
  latestWhen,
  on,
  cover,
  editing,
  picked,
  ink,
  emptyLabel,
  editLabel,
  onActivate,
  onOpenLatest,
  onEdit,
  onIconLoad,
  arrive,
  tone,
  stack,
}: {
  id: number | string
  name: string
  description?: string
  icon?: string | null
  unread?: number
  latestTitle?: string
  latestWhen?: string
  on?: boolean
  cover?: string | null
  editing?: boolean
  picked?: boolean
  ink?: string | null
  emptyLabel: string
  editLabel?: string
  onActivate: (id: number | string) => void
  onOpenLatest?: (id: number | string) => void
  onEdit?: (id: number | string) => void
  onIconLoad?: (img: HTMLImageElement) => void
  arrive?: number
  tone?: 'mix'
  stack?: readonly SiteStackFace[]
}) {
  return (
    <div
      data-rail-id={id}
      data-brew-surface="site"
      className={cx(
        'brew-site',
        tone === 'mix' && 'is-mix',
        on && 'is-on',
        cover && 'is-cover',
        editing && 'is-edit',
        picked && 'is-picked',
        arrive != null && 'is-arrive',
      )}
      style={
        {
          '--site-ink': ink,
          ...(arrive != null ? { '--brew-card-i': arrive } : null),
        } as CSSProperties
      }
      onClick={() => onActivate(id)}
    >
      {tone === 'mix' ? (
        <SiteStack faces={stack} live={!!on} />
      ) : null}
      {cover ? (
        <span className="brew-site__scene" aria-hidden>
          <img key={cover} src={cover} alt="" decoding="async" />
        </span>
      ) : icon ? (
        <span className="brew-site__bleed" aria-hidden>
          <img
            key={icon}
            src={icon}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
            onLoad={(event) => onIconLoad?.(event.currentTarget)}
          />
        </span>
      ) : null}
      {editing ? <BrewPick on={!!picked} /> : null}
      {editing && onEdit ? (
        <button
          type="button"
          className="brew-site__edit"
          title={editLabel}
          aria-label={editLabel}
          onClick={(event) => {
            event.stopPropagation()
            onEdit(id)
          }}
        >
          <Edit3 />
        </button>
      ) : null}
      {unread && unread > 0 ? (
        <span className="brew-site__unread">{unread > 99 ? '99+' : unread}</span>
      ) : null}
      <button
        type="button"
        className="brew-site__head"
        onClick={(event) => {
          event.stopPropagation()
          onActivate(id)
        }}
        aria-pressed={on}
      >
        <span className="brew-site__name">{name}</span>
        {!cover && description ? (
          <span className="brew-site__dek">{description}</span>
        ) : null}
      </button>
      {cover ? null : latestTitle ? (
        <button
          type="button"
          className="brew-site__article"
          onClick={(event) => {
            event.stopPropagation()
            onOpenLatest?.(id)
          }}
        >
          <span className="brew-site__article-title">{latestTitle}</span>
          {latestWhen ? (
            <span className="brew-site__when">{latestWhen}</span>
          ) : null}
        </button>
      ) : (
        <span className="brew-site__none">{emptyLabel}</span>
      )}
    </div>
  )
}

export const SiteCard = memo(SiteCardInner)
SiteCard.displayName = 'SiteCard'

export function SiteMark({
  name,
  icon,
}: {
  name: string
  icon?: string | null
}) {
  return (
    <span className="brew-mark" aria-hidden>
      {icon ? (
        <img
          key={icon}
          src={icon}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  )
}
