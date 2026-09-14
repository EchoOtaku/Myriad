/** 不认识 brew_items。 */

import type { CSSProperties, ReactNode, SyntheticEvent } from 'react'

import { forwardRef } from 'react'
import { cx } from './cx'
import { BrewPick } from './Pick'

function hideBrokenSourceIcon(
  event: SyntheticEvent<HTMLImageElement>,
): void {
  event.currentTarget.hidden = true
}

export function markBrewStoryPeek(target: EventTarget | null, on: boolean): void {
  if (!(target instanceof Element)) return
  const node = target.closest('.brew-story')
  if (
    !(node instanceof HTMLElement)
    || node.classList.contains('brew-story--slot')
  ) {
    return
  }
  if (on) {
    clearBrewStoryPeeks()
    node.classList.add('is-peek')
    return
  }
  node.classList.remove('is-peek')
}

export function clearBrewStoryPeeks(root?: ParentNode | null): void {
  const scope = root ?? (typeof document === 'undefined' ? null : document)
  scope?.querySelectorAll('.brew-story.is-peek').forEach((node) => {
    node.classList.remove('is-peek')
  })
}

function syncStoryCoverClass(story: Element | null, coverOk: boolean): void {
  if (!(story instanceof HTMLElement)) return
  if (coverOk) {
    story.classList.add('has-cover')
    if (story.querySelector('.brew-story__peek')) story.classList.add('has-peek')
    return
  }
  story.classList.remove('has-cover', 'has-peek')
}

function hideBrokenStoryCover(
  event: SyntheticEvent<HTMLImageElement>,
): void {
  const thumb = event.currentTarget.closest('.brew-story__thumb')
  if (thumb instanceof HTMLElement) thumb.hidden = true
  syncStoryCoverClass(event.currentTarget.closest('.brew-story'), false)
}

function showLoadedStoryCover(event: SyntheticEvent<HTMLImageElement>): void {
  const thumb = event.currentTarget.closest('.brew-story__thumb')
  if (thumb instanceof HTMLElement) thumb.hidden = false
  syncStoryCoverClass(event.currentTarget.closest('.brew-story'), true)
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
    'brew-story brew-float brew-story__hit brew-story__shell',
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
    left: `calc(${col - 1} * (var(--brew-story-w) + 0.75rem))`,
    top: row === 2
      ? 'calc(var(--brew-story-h) + var(--brew-items-gap))'
      : 0,
    width: 'var(--brew-story-w)',
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
        data-brew-surface="story"
        className="brew-story brew-story--slot"
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
          ...(arrive != null ? { '--brew-card-i': arrive } : null),
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
        data-brew-surface="story"
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
      data-brew-surface="story"
      data-brew-card={arrive != null ? `story:${face.id}` : undefined}
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
      onPointerEnter={
        onPeek
          ? (event) => {
              if (event.pointerType === 'touch') return
              markBrewStoryPeek(event.currentTarget, true)
              onPeek()
            }
          : undefined
      }
      onPointerLeave={
        onPeekEnd
          ? (event) => {
              markBrewStoryPeek(event.currentTarget, false)
              onPeekEnd()
            }
          : undefined
      }
    >
        <span className="brew-story__kicker">
          {face.topic ? (
            <span className="brew-story__topic">{face.topic}</span>
          ) : null}
          {face.source || face.sourceIcon ? (
            <span
              className="brew-story__source"
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
                <span className="brew-story__source-mark" aria-hidden>
                  {face.source.slice(0, 1)}
                </span>
              ) : null}
              {face.source ? <span>{face.source}</span> : null}
            </span>
          ) : null}
          {face.when ? (
            <span className="brew-story__meta">{face.when}</span>
          ) : null}
          {face.unread ? (
            <span className="brew-story__unread">{unreadLabel}</span>
          ) : null}
        </span>
        <span className="brew-story__title">{face.title}</span>
        {face.author ? (
          <span className="brew-story__byline">{face.author}</span>
        ) : null}
        {face.cover ? (
          <span
            key={face.cover}
            className="brew-story__thumb"
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
          <span className="brew-story__summary">{face.summary}</span>
        ) : null}
        {face.cover && face.summary ? (
          <span className="brew-story__peek" aria-hidden>
            {face.summary}
          </span>
        ) : null}
      {picking ? (
        <BrewPick on={picked} />
      ) : showStar ? (
        <span
          className={cx('brew-story__star', face.starred && 'is-on')}
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

export function StoryGrid({ children }: { children: ReactNode }) {
  return <div className="brew-skin brew-stories">{children}</div>
}
