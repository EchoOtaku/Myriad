import type { PhantasiSource } from '../../../types/phantasi'
import type { TimeTranslations } from '../types'

import { memo } from 'react'
import { extractColorsFromLoadedImage } from '../../../utils/colorExtractor'
import {
  DEFAULT_THEME_COLOR,
  getIconUrl,
  normalizeThemeColor,
} from '../constants'
import { isSiteSource } from '../logic/board'
import { LATEST_FEED_ID } from '../logic/feedStories'
import { SiteCard } from '../ui/SiteCard'
import { phantasiRelativeTime } from './time'

function indexSiteOnEls(
  track: HTMLElement,
  byId: Map<number, HTMLElement>,
): void {
  if (byId.size > 0) return
  const kids = track.children
  for (let i = 0; i < kids.length; i++) {
    const el = kids[i] as HTMLElement
    const next = Number(el.dataset?.railId)
    if (Number.isFinite(next)) byId.set(next, el)
  }
}

export function paintSiteOn(
  track: HTMLElement | null,
  id: number | null,
  painted: { current: number | null },
  paintedEl: { current: HTMLElement | null },
  byId: Map<number, HTMLElement>,
): void {
  if (!track || id == null || painted.current === id) return
  indexSiteOnEls(track, byId)
  const prevEl =
    paintedEl.current
    ?? (painted.current != null ? byId.get(painted.current) : undefined)
  prevEl?.classList.remove('is-on')
  let next = byId.get(id)
  if (!next) {
    next = track.querySelector<HTMLElement>(`.phantasi-site[data-rail-id="${id}"]`) ?? undefined
    if (next) byId.set(id, next)
  }
  next?.classList.add('is-on')
  painted.current = id
  paintedEl.current = next ?? null
}

export function paintSiteInk(img: HTMLImageElement, fallback: string | null): void {
  if (fallback) return
  try {
    const primary = extractColorsFromLoadedImage(img).primary
    if (
      !primary ||
      primary === DEFAULT_THEME_COLOR ||
      primary === '#6b7280'
    ) {
      return
    }
    const card = img.closest('.phantasi-site')
    if (card instanceof HTMLElement) {
      card.style.setProperty('--site-ink', normalizeThemeColor(primary))
    }
  } catch {
    // 取色失败保持默认灰。
  }
}

type MixCard = {
  id: number
  name: string
  description: string
  latestTitle?: string
  latestWhen?: string
  stack: Array<{
    key: string
    src?: string | null
    mark?: string
    ink?: string | null
  }>
}

export const PhantasiFeedsSites = memo(function PhantasiFeedsSites({
  sources,
  inbox,
  mixes = [],
  onId,
  times,
  locale,
  isEditMode,
  selectedIds,
  emptyLabel,
  editLabel,
  canEdit,
  onActivate,
  onEdit,
  onIconLoad,
}: {
  sources: PhantasiSource[]
  inbox: Omit<MixCard, 'id'> | null
  mixes?: MixCard[]
  onId: number | null | undefined
  times: TimeTranslations
  locale: string
  isEditMode: boolean
  selectedIds?: Set<number>
  emptyLabel: string
  editLabel: string
  canEdit: boolean
  onActivate: (id: number | string) => void
  onEdit: (id: number | string) => void
  onIconLoad: (img: HTMLImageElement) => void
}) {
  return (
    <>
      {inbox ? (
        <SiteCard
          key={LATEST_FEED_ID}
          id={LATEST_FEED_ID}
          arrive={0}
          name={inbox.name}
          description={inbox.description}
          latestTitle={inbox.latestTitle}
          latestWhen={inbox.latestWhen}
          on={onId === LATEST_FEED_ID}
          editing={false}
          tone="mix"
          stack={inbox.stack}
          emptyLabel={emptyLabel}
          onActivate={onActivate}
          onIconLoad={onIconLoad}
        />
      ) : null}
      {mixes.map((mix, index) => {
        const arrive = (inbox ? 1 : 0) + index
        return (
          <SiteCard
            key={mix.id}
            id={mix.id}
            arrive={arrive < 8 ? arrive : undefined}
            name={mix.name}
            description={mix.description}
            latestTitle={mix.latestTitle}
            latestWhen={mix.latestWhen}
            on={onId === mix.id}
            editing={false}
            tone="mix"
            stack={mix.stack}
            emptyLabel={emptyLabel}
            onActivate={onActivate}
            onIconLoad={onIconLoad}
          />
        )
      })}
      {sources.map((source, index) => {
        const latest = source.recent_items?.[0] ?? null
        const arrive = (inbox ? 1 : 0) + mixes.length + index
        return (
          <SiteCard
            key={source.id}
            id={source.id}
            arrive={arrive < 8 ? arrive : undefined}
            name={source.name}
            description={source.description?.trim() || ''}
            icon={getIconUrl(source.icon)}
            unread={source.unread_count}
            latestTitle={latest?.title}
            latestWhen={
              latest ? phantasiRelativeTime(latest.published_at, times, locale) : ''
            }
            styleTags={source.ai_style_tags}
            on={source.id === onId}
            editing={isEditMode}
            picked={selectedIds?.has(source.id)}
            ink={normalizeThemeColor(source.theme_color)}
            emptyLabel={isSiteSource(source) ? undefined : emptyLabel}
            editLabel={editLabel}
            onActivate={onActivate}
            onEdit={canEdit ? onEdit : undefined}
            onIconLoad={onIconLoad}
          />
        )
      })}
    </>
  )
})
