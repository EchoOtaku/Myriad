/** 朋友们：两行网站卡，一行文章卡。左右挪轨不裁切。 */

import type { CSSProperties } from 'react'
import type { PhantasiItemPreview, PhantasiSource } from '../../../types/phantasi'
import type { FeedStory } from '../logic/feedStories'
import type { PeekStoryPreview } from '../ui/peekLane'
import type { PhantasiRailApi } from './usePhantasiRailPan'

import { useId, useMemo, useRef } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import {
  getIconUrl,
  normalizeThemeColor,
} from '../constants'
import { isSiteSource, visitFriendHref } from '../logic/board'
import { PhantasiRailTitle } from '../ui/PhantasiRailTitle'
import { SiteCard } from '../ui/SiteCard'
import { clearPhantasiStoryPeeks, usePhantasiPeekLane } from '../ui/StoryCard'
import { PhantasiStory } from './PhantasiStory'
import { friendsSiteAutoOn, friendsStoryAutoOn } from './railCruise'
import { phantasiRelativeTime, usePhantasiTimes } from './time'
import { usePhantasiRailCruise } from './usePhantasiRailCruise'
import { usePhantasiRailPan } from './usePhantasiRailPan'

function visitFriend(source: PhantasiSource) {
  const href = visitFriendHref(source)
  if (!href) return
  window.open(href, '_blank', 'noopener,noreferrer')
}

export default function PhantasiFriends({
  sources,
  stories,
  isEditMode = false,
  selectedIds,
  onToggleSelect,
  onOpenItem,
  onPeekItem,
  onPeekEnd,
  onToggleStar,
  onEditSource,
}: {
  sources: PhantasiSource[]
  stories: FeedStory[]
  isEditMode?: boolean
  selectedIds?: Set<number>
  onToggleSelect?: (id: number) => void
  onOpenItem?: (item: PhantasiItemPreview, source: PhantasiSource) => void
  onPeekItem?: (item: PeekStoryPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: PhantasiItemPreview) => void
  onEditSource?: (source: PhantasiSource) => void
}) {
  const { t, locale } = useI18n()
  const itemsTitleId = useId()
  const times = usePhantasiTimes()
  const sitesViewRef = useRef<HTMLDivElement>(null)
  const sitesTrackRef = useRef<HTMLDivElement>(null)
  const sitesApiRef = useRef<PhantasiRailApi | null>(null)
  const itemsViewRef = useRef<HTMLDivElement>(null)
  const itemsTrackRef = useRef<HTMLDivElement>(null)
  const itemsApiRef = useRef<PhantasiRailApi | null>(null)
  const siteKey = useMemo(
    () => sources.map((source) => source.id).join(','),
    [sources],
  )
  const itemKey = useMemo(
    () => stories.map((item) => item.id).join(','),
    [stories],
  )
  const loopCols = Math.max(1, Math.ceil(sources.length / 2))
  const loopOn = friendsSiteAutoOn(sources.length) && !isEditMode
  const siteCols = loopOn ? loopCols * 2 : loopCols
  const storyLoopCols = stories.length
  const storyLoopOn = friendsStoryAutoOn(stories.length) && !isEditMode
  const storyCols = storyLoopOn ? storyLoopCols * 2 : Math.max(1, storyLoopCols)
  const byId = new Map(sources.map((source) => [source.id, source]))
  const painted = useMemo(() => {
    const one = sources.map((source, index) => ({
      source,
      copy: 0,
      index,
      railCol: Math.floor(index / 2) + 1,
    }))
    if (!loopOn) return one
    return [
      ...one,
      ...sources.map((source, index) => ({
        source,
        copy: 1,
        index,
        railCol: loopCols + Math.floor(index / 2) + 1,
      })),
    ]
  }, [loopCols, loopOn, sources])
  const paintedStories = useMemo(() => {
    const one = stories.map((item, index) => ({
      item,
      copy: 0,
      index,
      railCol: index + 1,
    }))
    if (!storyLoopOn) return one
    return [
      ...one,
      ...stories.map((item, index) => ({
        item,
        copy: 1,
        index,
        railCol: storyLoopCols + index + 1,
      })),
    ]
  }, [stories, storyLoopCols, storyLoopOn])
  const siteCruise = usePhantasiRailCruise(
    sitesApiRef,
    sitesViewRef,
    loopOn,
    loopCols,
  )
  const storyCruise = usePhantasiRailCruise(
    itemsApiRef,
    itemsViewRef,
    storyLoopOn,
    storyLoopCols,
  )

  usePhantasiRailPan(
    sitesViewRef,
    sitesTrackRef,
    sources.length > 0,
    `${siteKey}:${loopOn ? 'loop' : 'once'}`,
    '.phantasi-site',
    undefined,
    sitesApiRef,
    true,
    undefined,
    siteCruise.onGrab,
    siteCruise.onIdle,
    loopOn ? loopCols : 0,
  )
  const storiesById = useMemo(
    () => new Map(stories.map((item) => [item.id, item])),
    [stories],
  )
  const peekLane = usePhantasiPeekLane({
    onPeek: (preview) => {
      const item = storiesById.get(preview.id)
      if (item) onPeekItem?.(item)
    },
    onPeekEnd,
    blocked: () => isEditMode || !onPeekItem,
  })
  usePhantasiRailPan(
    itemsViewRef,
    itemsTrackRef,
    stories.length > 0,
    `${itemKey}:${storyLoopOn ? 'loop' : 'once'}`,
    '.phantasi-story',
    undefined,
    itemsApiRef,
    true,
    undefined,
    () => {
      clearPhantasiStoryPeeks(itemsTrackRef.current)
      onPeekEnd?.()
      storyCruise.onGrab()
    },
    storyCruise.onIdle,
    storyLoopOn ? storyLoopCols : 0,
  )

  const activate = (source: PhantasiSource) => {
    if (isEditMode) {
      onToggleSelect?.(source.id)
      return
    }
    visitFriend(source)
  }

  const openArticle = (item: FeedStory, sourceId?: number) => {
    const sid = sourceId ?? item.source_id
    const source = sid != null ? byId.get(sid) : undefined
    if (!source || isEditMode) {
      if (isEditMode && sid != null) onToggleSelect?.(sid)
      return
    }
    onOpenItem?.(item, source)
  }

  return (
    <div className="phantasi-skin phantasi-friends">
      <div data-tour="journal-sources" className="phantasi-friends__sites" ref={sitesViewRef}>
        <div
          className="phantasi-friends__sites-track"
          ref={sitesTrackRef}
          data-phantasi-rail-track="sites"
          style={
            {
              '--phantasi-story-cols': siteCols,
            } as CSSProperties
          }
        >
        {painted.map(({ source, copy, index, railCol }) => {
          const latest = source.recent_items?.[0] ?? null
          return (
            <SiteCard
              key={`${source.id}:${copy}`}
              id={source.id}
              railCol={railCol}
              arrive={copy === 0 && index < 8 ? index : undefined}
              name={source.name}
              description={source.description?.trim() || ''}
              icon={getIconUrl(source.icon)}
              unread={source.unread_count}
              latestTitle={latest?.title}
              latestWhen={
                latest
                  ? phantasiRelativeTime(latest.published_at, times, locale)
                  : ''
              }
              styleTags={source.ai_style_tags}
              editing={isEditMode}
              picked={selectedIds?.has(source.id)}
              ink={normalizeThemeColor(source.theme_color)}
              emptyLabel={isSiteSource(source) ? undefined : t.phantasi.noArticles}
              editLabel={t.phantasi.editSource}
              onActivate={() => activate(source)}
              onEdit={
                onEditSource ? () => onEditSource(source) : undefined
              }
            />
          )
        })}
        </div>
      </div>
      {stories.length > 0 ? (
        <>
          <PhantasiRailTitle id={itemsTitleId}>{t.phantasi.friendArticles}</PhantasiRailTitle>
          <div
            data-tour="journal-articles"
            className="phantasi-friends__items"
            ref={itemsViewRef}
            data-phantasi-peek-lane
            aria-labelledby={itemsTitleId}
            {...peekLane}
          >
            <div
              className="phantasi-friends__items-track"
              ref={itemsTrackRef}
              data-phantasi-rail-track="items"
              style={
                {
                  '--phantasi-story-cols': storyCols,
                } as CSSProperties
              }
            >
              {paintedStories.map(({ item, copy, index, railCol }) => (
                <PhantasiStory
                  key={`${item.id}:${copy}`}
                  item={item}
                  times={times}
                  locale={locale}
                  labels={t.phantasi}
                  railCol={railCol}
                  arrive={copy === 0 && index < 8 ? index : undefined}
                  onOpen={() => openArticle(item)}
                  onToggleStar={
                    onToggleStar && !isEditMode
                      ? (story) => onToggleStar(story)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
