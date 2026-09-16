/** 不认识 phantasi_items。 */

import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from 'react'

import { forwardRef, useCallback, useRef } from 'react'
import { scheduleTask } from '../../../hooks/animation'
import { whenPhantasiMotionIdle } from '../../../hooks/animation/pages/phantasiMotion'
import { cx } from './cx'
import {
  notePeekPointer,
  peekGoesToNav,
  peekLaneIsLive,
  peekLaneKeepsAir,
  peekLaneIsSwapping,
  peekNodeFromPoint,
  peekPreviewFromStory,
  peekStoryNode,
  peekSwapHoldsAir,
  type PeekStoryPreview,
} from './peekLane'
import { PhantasiPick } from './Pick'

function hideBrokenSourceIcon(
  event: SyntheticEvent<HTMLImageElement>,
): void {
  event.currentTarget.hidden = true
}

export function markPhantasiStoryPeek(target: EventTarget | null, on: boolean): void {
  const node = peekStoryNode(target)
  if (!node) return
  if (on) {
    clearPhantasiStoryPeeks()
    node.classList.add('is-peek')
    return
  }
  node.classList.remove('is-peek')
}

export function releasePhantasiStoryPeek(
  target: EventTarget | null,
  related: EventTarget | null,
  onEnd?: () => void,
): void {
  markPhantasiStoryPeek(target, false)
  if (peekLaneKeepsAir(target, related)) return
  if (peekSwapHoldsAir(target)) return
  onEnd?.()
}

export function dropPhantasiPeekLane(
  root: EventTarget | null,
  related: EventTarget | null,
  onEnd?: () => void,
): void {
  const host =
    root && typeof (root as Element).querySelectorAll === 'function'
      ? (root as Element)
      : null
  clearPhantasiStoryPeeks(host)
  if (peekLaneKeepsAir(root, related)) return
  if (peekSwapHoldsAir(root)) return
  onEnd?.()
}

export function resumePhantasiStoryPeek(
  onPeek?: (item: PeekStoryPreview) => void,
): boolean {
  if (peekLaneIsSwapping()) return false
  const node = peekNodeFromPoint()
  if (!node) return false
  markPhantasiStoryPeek(node, true)
  const item = peekPreviewFromStory(node)
  if (item) onPeek?.(item)
  return true
}

let peekResumeGen = 0
let peekResumeStop: (() => void) | null = null

export function cancelPhantasiPeekResume(): void {
  peekResumeGen += 1
  peekResumeStop?.()
  peekResumeStop = null
}

export function usePhantasiPeekLane({
  onPeek,
  onPeekEnd,
  blocked,
}: {
  onPeek?: (item: PeekStoryPreview) => void
  onPeekEnd?: () => void
  blocked?: () => boolean
}): {
  onPointerOver: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerOut: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onFocus: (event: ReactFocusEvent<HTMLElement>) => void
  onBlur: (event: ReactFocusEvent<HTMLElement>) => void
} {
  const onPeekRef = useRef(onPeek)
  onPeekRef.current = onPeek
  const onPeekEndRef = useRef(onPeekEnd)
  onPeekEndRef.current = onPeekEnd
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked

  const onPointerOver = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch' || blockedRef.current?.()) return
    const node = peekStoryNode(event.target)
    if (!node) return
    const from = event.relatedTarget
    if (from instanceof Node && node.contains(from)) return
    notePeekPointer(event)
    markPhantasiStoryPeek(node, true)
    const item = peekPreviewFromStory(node)
    if (item) onPeekRef.current?.(item)
  }, [])

  const onPointerOut = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch' || blockedRef.current?.()) return
    if (!peekLaneIsLive(event.currentTarget)) return
    notePeekPointer(event)
    const node = peekStoryNode(event.target)
    const to = event.relatedTarget
    if (node && to instanceof Node && node.contains(to)) return
    if (peekGoesToNav(to)) {
      markPhantasiStoryPeek(node, false)
      return
    }
    releasePhantasiStoryPeek(node ?? event.target, to, onPeekEndRef.current)
  }, [])

  const onPointerLeave = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch' || blockedRef.current?.()) return
    if (!peekLaneIsLive(event.currentTarget)) return
    notePeekPointer(event)
    const to = event.relatedTarget
    if (to instanceof Node && event.currentTarget.contains(to)) return
    if (peekGoesToNav(to)) {
      clearPhantasiStoryPeeks(event.currentTarget)
      return
    }
    dropPhantasiPeekLane(event.currentTarget, to, onPeekEndRef.current)
  }, [])

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (blockedRef.current?.()) return
    if (!peekLaneIsLive(event.currentTarget)) return
    markPhantasiStoryPeek(event.target, false)
    if (peekSwapHoldsAir(event.target)) return
    onPeekEndRef.current?.()
  }, [])

  const onFocus = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    if (blockedRef.current?.()) return
    const node = peekStoryNode(event.target)
    if (!node) return
    markPhantasiStoryPeek(node, true)
    const item = peekPreviewFromStory(node)
    if (item) onPeekRef.current?.(item)
  }, [])

  const onBlur = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    if (blockedRef.current?.()) return
    releasePhantasiStoryPeek(
      event.target,
      event.relatedTarget,
      onPeekEndRef.current,
    )
  }, [])

  return {
    onPointerOver,
    onPointerOut,
    onPointerLeave,
    onPointerCancel,
    onFocus,
    onBlur,
  }
}

export function schedulePhantasiPeekResume(
  onPeek: (item: PeekStoryPreview) => void,
): void {
  cancelPhantasiPeekResume()
  const gen = peekResumeGen
  peekResumeStop = whenPhantasiMotionIdle(() => {
    if (gen !== peekResumeGen) return
    if (resumePhantasiStoryPeek(onPeek)) {
      cancelPhantasiPeekResume()
      return
    }
    scheduleTask(() => {
      if (gen !== peekResumeGen) return
      resumePhantasiStoryPeek(onPeek)
    })
  })
}

export function clearPhantasiStoryPeeks(root?: ParentNode | null): void {
  const scope = root ?? (typeof document === 'undefined' ? null : document)
  scope?.querySelectorAll('.phantasi-story.is-peek').forEach((node) => {
    node.classList.remove('is-peek')
  })
}

function syncStoryCoverClass(story: Element | null, coverOk: boolean): void {
  if (!(story instanceof HTMLElement)) return
  if (coverOk) {
    story.classList.add('has-cover')
    if (story.querySelector('.phantasi-story__peek')) story.classList.add('has-peek')
    return
  }
  story.classList.remove('has-cover', 'has-peek')
}

function hideBrokenStoryCover(
  event: SyntheticEvent<HTMLImageElement>,
): void {
  const thumb = event.currentTarget.closest('.phantasi-story__thumb')
  if (thumb instanceof HTMLElement) thumb.hidden = true
  syncStoryCoverClass(event.currentTarget.closest('.phantasi-story'), false)
}

function showLoadedStoryCover(event: SyntheticEvent<HTMLImageElement>): void {
  const thumb = event.currentTarget.closest('.phantasi-story__thumb')
  if (thumb instanceof HTMLElement) thumb.hidden = false
  syncStoryCoverClass(event.currentTarget.closest('.phantasi-story'), true)
}

const placeAbs = new Map<string, CSSProperties>()
const storyClass = new Map<number, string>()

function storyCardClass(
  unread: boolean,
  cover: boolean,
  star: boolean,
  hold: boolean,
  peek: boolean,
): string {
  const key =
    (unread ? 1 : 0)
    | (cover ? 2 : 0)
    | (star ? 4 : 0)
    | (hold ? 8 : 0)
    | (peek ? 16 : 0)
  const hit = storyClass.get(key)
  if (hit) return hit
  const next = cx(
    'phantasi-story phantasi-float phantasi-story__hit phantasi-story__shell',
    unread && 'is-unread',
    cover && 'has-cover',
    peek && 'has-peek',
    star && 'has-star',
    hold && 'is-hold',
  )
  storyClass.set(key, next)
  return next
}

function storyPlaceStyle(col: number, row: 1 | 2): CSSProperties {
  const key = `${col}:${row}`
  const hit = placeAbs.get(key)
  if (hit) return hit
  const style: CSSProperties = {
    position: 'absolute',
    left: `calc(${col - 1} * (var(--phantasi-story-w) + 0.75rem))`,
    top: row === 2
      ? 'calc(var(--phantasi-story-h) + var(--phantasi-items-gap))'
      : 0,
    width: 'var(--phantasi-story-w)',
    height: 'var(--phantasi-story-h)',
  }
  placeAbs.set(key, style)
  return style
}

interface StoryCardFace {
  id: number | string
  title: string
  summary?: string
  cover?: string | null
  source?: string
  sourceIcon?: string | null
  when?: string
  topic?: string | null
  hue?: string | null
  author?: string | null
  unread?: boolean
  starred?: boolean
}

export const StoryCard = forwardRef<
  HTMLButtonElement,
  {
    face?: StoryCardFace
    unreadLabel?: string
    starLabel?: string
    unstarLabel?: string
    onOpen?: () => void
    shell?: boolean
    onPeek?: () => void
    onPeekEnd?: () => void
    onToggleStar?: () => void
    current?: boolean
    picked?: boolean
    picking?: boolean
    arrive?: number
    railId?: number | string
    place?: { column: number; row: 1 | 2 }
    railCol?: number
    eagerCover?: boolean
    holdCover?: boolean
    canStar?: boolean
    html?: string
  }
>((
  {
    face,
    unreadLabel,
    starLabel,
    unstarLabel,
    onOpen,
    onPeek,
    onPeekEnd,
    onToggleStar,
    current = false,
    picked = false,
    picking = false,
    arrive,
    railId,
    place,
    railCol,
    eagerCover = false,
    holdCover = false,
    canStar,
    html,
    shell = false,
  },
  ref,
) => {
  const placed =
    railCol != null && place
      ? storyPlaceStyle(railCol, place.row)
      : place
        ? { gridColumn: place.column, gridRow: place.row }
        : null
  if (shell || !face) {
    return (
      <button
        ref={ref}
        type="button"
        data-rail-id={railId}
        data-rail-col={railCol ?? place?.column}
        data-phantasi-surface="story"
        className="phantasi-story phantasi-story--slot"
        style={placed ?? undefined}
        aria-hidden
        tabIndex={-1}
      />
    )
  }
  const style = (
    face.hue || arrive != null
      ? {
          ...(face.hue ? { '--story-topic': face.hue } : null),
          ...(arrive != null ? { '--phantasi-card-i': arrive } : null),
          ...placed,
        }
      : placed
  ) as CSSProperties | null
  const deferCover = holdCover && !eagerCover
  const showStar = canStar ?? !!onToggleStar
  const peek = !!(face.cover && face.summary)
  if (
    html
    && !onOpen
    && !onPeek
    && !onPeekEnd
    && !onToggleStar
    && !picking
    && !current
    && !picked
    && arrive == null
  ) {
    return (
      <button
        ref={ref}
        type="button"
        data-rail-id={railId}
        data-rail-col={railCol ?? place?.column}
        data-phantasi-surface="story"
        className={storyCardClass(
          !!face.unread,
          !!face.cover,
          showStar,
          deferCover,
          peek,
        )}
        style={style ?? undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      data-rail-id={railId}
      data-rail-col={railCol ?? place?.column}
      data-phantasi-surface="story"
      data-phantasi-card={arrive != null ? `story:${face.id}` : undefined}
      className={
        current || picked || picking || arrive != null
          ? cx(
              storyCardClass(
                !!face.unread,
                !!face.cover,
                showStar && !picking,
                deferCover,
                peek,
              ),
              current && 'is-current',
              picked && 'is-picked',
              picking && 'is-picking',
              arrive != null && 'is-arrive',
            )
          : storyCardClass(
              !!face.unread,
              !!face.cover,
              showStar,
              deferCover,
              peek,
            )
      }
      style={style ?? undefined}
      onClick={onOpen}
      aria-pressed={picking ? picked : undefined}
    >
        <span className="phantasi-story__kicker">
          {face.topic ? (
            <span className="phantasi-story__topic">{face.topic}</span>
          ) : null}
          {face.source || face.sourceIcon ? (
            <span
              className="phantasi-story__source"
              {...(deferCover && face.sourceIcon
                ? { 'data-src': face.sourceIcon }
                : {})}
            >
              {face.sourceIcon && !deferCover ? (
                <img
                  key={face.sourceIcon}
                  src={face.sourceIcon}
                  data-src={face.sourceIcon}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={hideBrokenSourceIcon}
                />
              ) : !face.sourceIcon && face.source ? (
                <span className="phantasi-story__source-mark" aria-hidden>
                  {face.source.slice(0, 1)}
                </span>
              ) : null}
              {face.source ? <span>{face.source}</span> : null}
            </span>
          ) : null}
          {face.when ? (
            <span className="phantasi-story__meta">{face.when}</span>
          ) : null}
          {face.unread ? (
            <span className="phantasi-story__unread">{unreadLabel}</span>
          ) : null}
        </span>
        <span className="phantasi-story__title">{face.title}</span>
        {face.author ? (
          <span className="phantasi-story__byline">{face.author}</span>
        ) : null}
        {face.cover ? (
          <span
            key={face.cover}
            className="phantasi-story__thumb"
            aria-hidden
            {...(deferCover ? { 'data-src': face.cover } : {})}
          >
            {deferCover ? null : (
              <img
                src={face.cover}
                data-src={face.cover}
                alt=""
                loading={eagerCover ? 'eager' : 'lazy'}
                decoding="async"
                onError={hideBrokenStoryCover}
                onLoad={showLoadedStoryCover}
              />
            )}
          </span>
        ) : null}
        {face.summary ? (
          <span className="phantasi-story__summary">{face.summary}</span>
        ) : null}
        {face.cover && face.summary ? (
          <span className="phantasi-story__peek" aria-hidden>
            {face.summary}
          </span>
        ) : null}
      {picking ? (
        <PhantasiPick on={picked} />
      ) : showStar ? (
        <span
          className={cx('phantasi-story__star', face.starred && 'is-on')}
          title={face.starred ? unstarLabel : starLabel}
          aria-label={face.starred ? unstarLabel : starLabel}
          aria-pressed={!!face.starred}
          role="button"
          onClick={
            onToggleStar
              ? (event) => {
                  event.stopPropagation()
                  onToggleStar()
                }
              : undefined
          }
        />
      ) : null}
    </button>
  )
})
