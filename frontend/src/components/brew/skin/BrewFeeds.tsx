import type { CSSProperties, MouseEvent, PointerEvent, ReactNode, RefObject } from 'react'
import type { BrewItemPreview, BrewSource } from '../../../types/brew'
import type { FeedStory } from '../logic/feedStories'
import type { TimeTranslations } from '../types'
import type { BrewRailApi } from './useBrewRailPan'

import { isValidElement, memo, startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { extractColorsFromLoadedImage } from '../../../utils/colorExtractor'
import {
  DEFAULT_THEME_COLOR,
  getIconUrl,
  normalizeThemeColor,
} from '../constants'
import {
  clipPaintedBatches,
  extendPaintedRange,
  firstStoryForRailGroup,
  isLatestFeedId,
  LATEST_FEED_ID,
  latestFeedStackFaces,
  sourceColumnStarts,
  sourceScrollStarts,
  storyColumnLeads,
  storyColumnShift,
  storyRailGroup,
  storyRailSlots,
  storySlotAtColumn,
  storySlotsByColumn,
} from '../logic/feedStories'
import { BrewRailTitle } from '../ui/BrewRailTitle'
import { BrewVacant } from '../ui/Empty'
import { SiteCard } from '../ui/SiteCard'
import { markBrewStoryPeek } from '../ui/StoryCard'
import { BrewStoryColumn } from './BrewStory'
import {
  brewFlipQuiet,
  clearRailExits,
  enterSites,
  enterStories,
  FLIP_INTRO_STORY_MS,
  seatSiteTrack,
  waitFlip,
} from './flipCards'
import {
  dropStoryDomShells,
  eagerStoryCovers,
  ensureStoryShells,
  followRailScroll,
  onStoryMediaError,
  paintStoryAway,
  paintStoryLiveCols,
  RAIL_MOUNT_BOOT_TO,
  RAIL_MOUNT_GROW_AHEAD,
  RAIL_MOUNT_LIVE_PAD,
  RAIL_MOUNT_RESERVE,
  RAIL_OVERFLOW_LEFT_PX,
  railLeadColumn,
  railLiveTo,
  railMountColumns,
  railMountColumnsCovered,
  railMountColumnsPan,
  railMountColumnsSettle,
  railSeatScroll,
  railTrackScroll,
  recycleStoryDomShellsOutside,
  sourceAtScroll,
  storyMountWindow,
  storyRailTrackSize,
} from './railPan'
import { warmStoryCovers, warmStoryFaces } from './storyFace'
import { brewRelativeTime, useBrewTimes } from './time'
import { useBrewRailPan } from './useBrewRailPan'

const ARTICLES_SETTLE_MS = 200
const FOCUS_FOLLOW_MS = 160

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

function paintSiteOn(
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
    next = track.querySelector<HTMLElement>(`.brew-site[data-rail-id="${id}"]`) ?? undefined
    if (next) byId.set(id, next)
  }
  next?.classList.add('is-on')
  painted.current = id
  paintedEl.current = next ?? null
}

const BrewFeedsSites = memo(({
  sources,
  inbox,
  onId,
  times,
  locale,
  isEditMode,
  selectedIds,
  emptyLabel,
  editLabel,
  canEdit,
  onActivate,
  onOpenLatest,
  onEdit,
  onIconLoad,
}: {
  sources: BrewSource[]
  inbox: {
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
  } | null
  onId: number | null | undefined
  times: TimeTranslations
  locale: string
  isEditMode: boolean
  selectedIds?: Set<number>
  emptyLabel: string
  editLabel: string
  canEdit: boolean
  onActivate: (id: number | string) => void
  onOpenLatest: (id: number | string) => void
  onEdit: (id: number | string) => void
  onIconLoad: (img: HTMLImageElement) => void
}) => {
  return (
    <>
      {inbox ? (
        <SiteCard
          key={LATEST_FEED_ID}
          id={LATEST_FEED_ID}
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
          onOpenLatest={inbox.latestTitle ? onOpenLatest : undefined}
          onIconLoad={onIconLoad}
        />
      ) : null}
      {sources.map((source) => {
        const latest = source.recent_items?.[0] ?? null
        return (
          <SiteCard
            key={source.id}
            id={source.id}
            name={source.name}
            description={source.description?.trim() || ''}
            icon={getIconUrl(source.icon)}
            unread={source.unread_count}
            latestTitle={latest?.title}
            latestWhen={
              latest ? brewRelativeTime(latest.published_at, times, locale) : ''
            }
            on={source.id === onId}
            editing={isEditMode}
            picked={selectedIds?.has(source.id)}
            ink={normalizeThemeColor(source.theme_color)}
            emptyLabel={emptyLabel}
            editLabel={editLabel}
            onActivate={onActivate}
            onOpenLatest={latest ? onOpenLatest : undefined}
            onEdit={canEdit ? onEdit : undefined}
            onIconLoad={onIconLoad}
          />
        )
      })}
    </>
  )
})

interface StorySlot { story: FeedStory; column: number; row: 1 | 2 }

function storyAtRailTarget(
  target: EventTarget | null,
  byId: ReadonlyMap<number, FeedStory>,
): FeedStory | undefined {
  if (!(target instanceof Element)) return
  const node = target.closest('.brew-story')
  if (
    !(node instanceof HTMLElement)
    || node.classList.contains('brew-story--slot')
  ) {
    return
  }
  const id = Number(node.dataset.railId)
  if (!Number.isFinite(id)) return
  return byId.get(id)
}

const PaintedRailHead = memo(({
  nodes,
}: {
  nodes: readonly ReactNode[]
}) => nodes)
PaintedRailHead.displayName = 'PaintedRailHead'

const BrewFeedsStories = memo(({
  storySlots,
  times,
  locale,
  labels,
  onOpen,
  onPeek,
  onPeekEnd,
  onToggleStar,
  trackRef,
  setMountRef,
  setLiveRef,
  mountCommittedRef,
  mountColsRef,
  liveToRef,
  pendingStoryAlignRef,
  itemsApiRef,
  eagerBandRef,
  lastEagerRef,
  warmRef,
  grabbingRef,
}: {
  storySlots: readonly StorySlot[]
  times: TimeTranslations
  locale: string
  labels: {
    unread: string
    starred: string
    unstar: string
  }
  onOpen: (item: FeedStory) => void
  onPeek: (item: FeedStory) => void
  onPeekEnd: () => void
  onToggleStar?: (item: FeedStory) => void | false | Promise<void | false>
  trackRef: RefObject<HTMLDivElement | null>
  setMountRef: RefObject<(next: { from: number; to: number }) => void>
  setLiveRef: RefObject<(next: number) => void>
  mountCommittedRef: RefObject<{ from: number; to: number }>
  mountColsRef: RefObject<{ from: number; to: number }>
  liveToRef: RefObject<number>
  pendingStoryAlignRef: RefObject<number | null>
  itemsApiRef: RefObject<BrewRailApi | null>
  eagerBandRef: RefObject<{ from: number; to: number }>
  lastEagerRef: RefObject<{ from: number; to: number }>
  warmRef: RefObject<() => void>
  grabbingRef: RefObject<boolean>
}) => {
  const [mountCols, setMountCols] = useState({
    from: 1,
    to: Math.min(RAIL_MOUNT_GROW_AHEAD, RAIL_MOUNT_BOOT_TO),
  })
  const [liveTo, setLiveTo] = useState(liveToRef.current)
  const setMount = useCallback((next: { from: number; to: number }) => {
    mountColsRef.current = next
    mountCommittedRef.current = next
    setMountCols((prev) =>
      prev.from === next.from && prev.to === next.to ? prev : next,
    )
  }, [mountColsRef, mountCommittedRef])
  const setLive = useCallback((next: number) => {
    liveToRef.current = next
    setLiveTo((prev) => (prev === next ? prev : next))
  }, [liveToRef])
  useLayoutEffect(() => {
    setMountRef.current = setMount
  }, [setMount, setMountRef])
  useLayoutEffect(() => {
    setLiveRef.current = setLive
  }, [setLive, setLiveRef])
  const alignId = pendingStoryAlignRef.current
  useLayoutEffect(() => {
    if (alignId == null) return
    pendingStoryAlignRef.current = null
    itemsApiRef.current?.alignColumn(alignId, true)
  }, [alignId, itemsApiRef, pendingStoryAlignRef])
  const storyCols = storySlots.at(-1)?.column ?? 1
  const grid = storyMountWindow(mountCols.from, mountCols.to, storyCols)
  const byColRef = useRef<Map<number, StorySlot[]> | undefined>(undefined)
  const byCol = useMemo(() => {
    const next = storySlotsByColumn(storySlots, byColRef.current)
    byColRef.current = next
    return next
  }, [storySlots])
  const paintedEagerRef = useRef<{ from: number; to: number } | undefined>(
    undefined,
  )
  const prebuiltColsRef = useRef<Map<number, ReactNode>>(new Map())
  const canStar = onToggleStar != null
  useEffect(() => {
    const band = eagerBandRef.current
    eagerStoryCovers(
      trackRef.current,
      band.from,
      band.to,
      paintedEagerRef.current,
    )
    paintStoryAway(
      trackRef.current,
      band.from,
      band.to,
      paintedEagerRef.current,
    )
    paintedEagerRef.current = band
    lastEagerRef.current = band
  }, [eagerBandRef, lastEagerRef, mountCols.from, mountCols.to, storySlots, trackRef])
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    track.addEventListener('error', onStoryMediaError, true)
    return () => track.removeEventListener('error', onStoryMediaError, true)
  }, [trackRef])
  const eagerBand = eagerBandRef.current
  const paintTo = grid.to
  useEffect(() => {
    const from = paintTo + 1
    const faceTo = Math.min(paintTo + RAIL_MOUNT_GROW_AHEAD * 2, storyCols)
    const bootTo = Math.min(RAIL_MOUNT_GROW_AHEAD, RAIL_MOUNT_BOOT_TO)
    const warm = () => {
      const holdAt = eagerBandRef.current.to
      const prebuilt = prebuiltColsRef.current
      const fill = (colFrom: number, colTo: number, covers: boolean) => {
        if (colFrom > colTo) return
        const pack: FeedStory[] = []
        for (let col = colFrom; col <= colTo; col++) {
          const slots = byCol.get(col)
          if (!slots) continue
          for (const slot of slots) pack.push(slot.story)
        }
        warmStoryFaces(pack, times, locale, labels, !covers)
        if (!covers) return
        for (let col = colFrom; col <= colTo; col++) {
          if (prebuilt.has(col)) continue
          prebuilt.set(
            col,
            <BrewStoryColumn
              key={col}
              col={col}
              slots={byCol.get(col)}
              times={times}
              locale={locale}
              labels={labels}
              holdCover={col > holdAt}
              canStar={canStar}
            />,
          )
        }
        warmStoryCovers(pack)
      }
      if (grabbingRef.current) {
        const liveNow = liveToRef.current
        fill(
          liveNow + 1,
          Math.min(
            liveNow + RAIL_MOUNT_LIVE_PAD + RAIL_MOUNT_RESERVE,
            mountColsRef.current.to,
            storyCols,
          ),
          false,
        )
      } else if (from <= faceTo) {
        fill(from, faceTo, true)
      }
      if (grabbingRef.current) return
      const mounted = mountColsRef.current
      if (mounted.to <= bootTo + RAIL_MOUNT_LIVE_PAD) {
        const padTo = Math.min(bootTo + RAIL_MOUNT_LIVE_PAD, storyCols)
        if (padTo <= mounted.to) return
        const next = { from: mounted.from, to: padTo }
        mountColsRef.current = next
        liveToRef.current = padTo
        startTransition(() => {
          setLive(padTo)
          setMount(next)
        })
        return
      }
      if (
        mounted.from > 1
        && mounted.to === eagerBandRef.current.to
      ) {
        return
      }
      const cap = Math.min(
        eagerBandRef.current.to + RAIL_MOUNT_GROW_AHEAD,
        storyCols,
      )
      if (cap <= mounted.to) return
      const next = { from: mounted.from, to: cap }
      mountColsRef.current = next
      liveToRef.current = cap
      startTransition(() => {
        setLive(cap)
        setMount(next)
      })
    }
    warmRef.current = warm
    if (typeof requestIdleCallback === 'function') {
      const idle = requestIdleCallback(warm)
      return () => cancelIdleCallback(idle)
    }
    const timer = window.setTimeout(warm, 0)
    return () => window.clearTimeout(timer)
  }, [
    byCol,
    canStar,
    eagerBandRef,
    grabbingRef,
    labels,
    locale,
    liveToRef,
    mountColsRef,
    paintTo,
    setLive,
    setMount,
    storyCols,
    times,
    warmRef,
  ])
  const trackStyle = useMemo(
    () => ({
      '--brew-story-cols': storyCols,
      width: storyRailTrackSize(storyCols),
      gridTemplateColumns: 'minmax(0, 100%)',
    }) as CSSProperties,
    [storyCols],
  )
  const paintedCacheRef = useRef<ReactNode[]>([])
  const paintedOutRef = useRef<ReactNode[]>([])
  const paintedHeadRef = useRef<ReactNode>(null)
  const paintedBatchesRef = useRef<{
    from: number
    to: number
    nodes: readonly ReactNode[]
    head: ReactNode
  }[]>([])
  const paintedRangeRef = useRef({ from: 0, to: 0 })
  const paintedLiveToRef = useRef(0)
  const paintedByColRef = useRef(byCol)
  const paintedFaceRef = useRef({
    times,
    locale,
    labels,
    canStar,
  })
  const painted = useMemo(() => {
    const face = paintedFaceRef.current
    const prevByCol = paintedByColRef.current
    const reset =
      face.times !== times
      || face.locale !== locale
      || face.labels !== labels
      || face.canStar !== canStar
    paintedByColRef.current = byCol
    paintedFaceRef.current = {
      times,
      locale,
      labels,
      canStar,
    }
    if (reset) prebuiltColsRef.current.clear()
    const prevRange = paintedRangeRef.current
    const prevLive = paintedLiveToRef.current
    const prev = paintedCacheRef.current
    const prebuilt = prebuiltColsRef.current
    const paintLive = Math.min(liveTo, paintTo)
    const eagerTo = paintedEagerRef.current?.to ?? eagerBand.to
    const makeFull = (col: number) => {
      const holdCover = col > eagerBand.to || col > eagerTo
      if (!holdCover) {
        const hit = prebuilt.get(col)
        if (hit) return hit
      } else {
        prebuilt.delete(col)
      }
      const node = (
        <BrewStoryColumn
          key={col}
          col={col}
          slots={byCol.get(col)}
          times={times}
          locale={locale}
          labels={labels}
          holdCover={holdCover}
          canStar={canStar}
        />
      )
      if (!holdCover) prebuilt.set(col, node)
      return node
    }
    const make = (col: number) => (
      col > paintLive
        ? (
            <BrewStoryColumn
              key={col}
              col={col}
              times={times}
              locale={locale}
              labels={labels}
              holdCover={col > eagerBand.to || col > eagerTo}
              canStar={canStar}
            />
          )
        : makeFull(col)
    )
    let next = extendPaintedRange(
      prev,
      prevRange.from,
      prevRange.to,
      grid.from,
      paintTo,
      make,
      reset,
    )
    const hydrate =
      !reset
      && paintLive > prevLive
      && prevRange.from === grid.from
      && prevRange.to === paintTo
      && prevRange.to >= prevRange.from
    const leftoverShells = paintedBatchesRef.current.some(
      (batch) => batch.from > prevLive || batch.to > prevLive,
    )
    if (
      !reset
      && paintLive > prevLive
      && prevRange.from === grid.from
      && prevRange.to >= prevRange.from
    ) {
      const copy = next.slice()
      for (
        let col = prevLive + 1;
        col <= paintLive && col <= paintTo;
        col++
      ) {
        copy[col - grid.from] = makeFull(col)
      }
      next = copy
    }
    if (!reset && prevByCol !== byCol) {
      const copy = next.slice()
      let patched = false
      const overlapFrom = Math.max(grid.from, prevRange.from)
      const overlapTo = Math.min(paintTo, prevRange.to)
      for (let col = overlapFrom; col <= overlapTo; col++) {
        if (prevByCol.get(col) !== byCol.get(col)) {
          prebuilt.delete(col)
          copy[col - grid.from] = make(col)
          patched = true
        }
      }
      if (patched) next = copy
      if (patched && paintedBatchesRef.current.length > 0) {
        const batches: {
          from: number
          to: number
          nodes: readonly ReactNode[]
          head: ReactNode
        }[] = []
        const heads: ReactNode[] = []
        for (const batch of paintedBatchesRef.current) {
          let hit = false
          for (let col = batch.from; col <= batch.to; col++) {
            if (prevByCol.get(col) !== byCol.get(col)) {
              hit = true
              break
            }
          }
          if (!hit) {
            batches.push(batch)
            heads.push(batch.head)
            continue
          }
          const from = Math.max(batch.from, grid.from)
          const to = Math.min(batch.to, paintTo)
          if (from > to) continue
          const nodes = next.slice(from - grid.from, to - grid.from + 1)
          const head = (
            <PaintedRailHead
              key={
                isValidElement(batch.head) && batch.head.key != null
                  ? batch.head.key
                  : `${from}:${to}`
              }
              nodes={nodes}
            />
          )
          batches.push({ from, to, nodes, head })
          heads.push(head)
        }
        paintedBatchesRef.current = batches
        paintedOutRef.current = heads
        paintedHeadRef.current = heads[0] ?? null
      }
    }
    paintedRangeRef.current = { from: grid.from, to: paintTo }
    paintedLiveToRef.current = paintLive
    paintedCacheRef.current = next
    if (next === prev && paintedOutRef.current.length > 0) {
      return paintedOutRef.current
    }
    const grew =
      !reset
      && paintedHeadRef.current
      && grid.from === prevRange.from
      && paintTo > prevRange.to
      && next.length > prev.length
      && next[0] === prev[0]
    if (grew && !leftoverShells) {
      const addFrom = prevRange.to + 1
      let out = paintedOutRef.current
      if (addFrom <= paintLive) {
        const liveNodes = next.slice(
          addFrom - grid.from,
          paintLive - grid.from + 1,
        )
        const head = (
          <PaintedRailHead
            key={`${prevRange.to}:${paintTo}`}
            nodes={liveNodes}
          />
        )
        paintedHeadRef.current = head
        out = out.concat(head)
        paintedBatchesRef.current.push({
          from: addFrom,
          to: paintLive,
          nodes: liveNodes,
          head,
        })
      }
      if (paintLive < paintTo) {
        const shellNodes = next.slice(paintLive - grid.from + 1)
        const head = (
          <PaintedRailHead
            key={`shell:${paintTo}`}
            nodes={shellNodes}
          />
        )
        if (addFrom > paintLive) paintedHeadRef.current = head
        out = out.concat(head)
        paintedBatchesRef.current.push({
          from: paintLive + 1,
          to: paintTo,
          nodes: shellNodes,
          head,
        })
      }
      paintedOutRef.current = out
      return out
    }
    if (
      (hydrate || (grew && leftoverShells))
      && paintedBatchesRef.current.length > 0
    ) {
      const tailAt = paintedBatchesRef.current.findIndex(
        (batch) => batch.to > prevLive,
      )
      if (tailAt >= 0) {
        const batches = paintedBatchesRef.current.slice()
        const heads = batches.map((batch) => batch.head)
        const batch = batches[tailAt]
        if (!batch) {
          paintedHeadRef.current = heads[0] ?? null
          paintedOutRef.current = heads
          paintedBatchesRef.current = batches
          return heads
        }
        const nodes = batch.nodes.slice()
        const hydFrom = Math.max(prevLive + 1, batch.from, grid.from)
        let tailTo = batch.to
        for (let col = hydFrom; col <= paintLive; col++) {
          const at = col - batch.from
          const node = next[col - grid.from]
          if (node == null) continue
          if (at >= 0 && at < nodes.length) {
            nodes[at] = node
          }
          else {
            nodes.push(node)
            if (col > tailTo) tailTo = col
          }
        }
        if (paintTo > tailTo) {
          for (let col = tailTo + 1; col <= paintTo; col++) {
            const node = next[col - grid.from]
            if (node != null) nodes.push(node)
          }
          tailTo = paintTo
        }
        const head = (
          <PaintedRailHead
            key={
              isValidElement(batch.head) && batch.head.key != null
                ? batch.head.key
                : `shell:${paintTo}`
            }
            nodes={nodes}
          />
        )
        batches[tailAt] = {
          from: batch.from,
          to: tailTo,
          nodes,
          head,
        }
        heads[tailAt] = head
        paintedHeadRef.current = heads[0] ?? null
        paintedOutRef.current = heads
        paintedBatchesRef.current = batches
        return heads
      }
      const kept = paintedBatchesRef.current.filter((batch) => batch.to <= prevLive)
      const heads: ReactNode[] = kept.map((batch) => batch.head)
      const batches = kept.slice()
      const hydFrom = Math.max(prevLive + 1, grid.from)
      if (hydFrom <= paintLive) {
        const nodes = next.slice(
          hydFrom - grid.from,
          paintLive - grid.from + 1,
        )
        const head = (
          <PaintedRailHead
            key={`${prevLive}:${paintLive}`}
            nodes={nodes}
          />
        )
        heads.push(head)
        batches.push({
          from: hydFrom,
          to: paintLive,
          nodes,
          head,
        })
      }
      if (paintLive < paintTo) {
        const nodes = next.slice(paintLive - grid.from + 1)
        const head = (
          <PaintedRailHead
            key={`shell:${paintTo}`}
            nodes={nodes}
          />
        )
        heads.push(head)
        batches.push({
          from: paintLive + 1,
          to: paintTo,
          nodes,
          head,
        })
      }
      paintedHeadRef.current = heads[0] ?? null
      paintedOutRef.current = heads
      paintedBatchesRef.current = batches
      return heads
    }
    if (reset || !paintedHeadRef.current || paintedBatchesRef.current.length === 0) {
      const head = <PaintedRailHead key={`${grid.from}:${paintTo}`} nodes={next} />
      paintedHeadRef.current = head
      paintedOutRef.current = [head]
      paintedBatchesRef.current = [{
        from: grid.from,
        to: paintTo,
        nodes: next,
        head,
      }]
      return paintedOutRef.current
    }
    const clipped = clipPaintedBatches(
      paintedBatchesRef.current,
      grid.from,
      paintTo,
      next,
    )
    const heads: ReactNode[] = []
    const batches: {
      from: number
      to: number
      nodes: readonly ReactNode[]
      head: ReactNode
    }[] = []
    for (const batch of clipped) {
      const head = batch.keep?.head ?? (
        <PaintedRailHead
          key={`${batch.from}:${batch.to}`}
          nodes={batch.nodes}
        />
      )
      heads.push(head)
      batches.push({
        from: batch.from,
        to: batch.to,
        nodes: batch.nodes,
        head,
      })
    }
    paintedHeadRef.current = heads[0] ?? null
    paintedOutRef.current = heads
    paintedBatchesRef.current = batches
    return heads
  }, [
    byCol,
    canStar,
    grid.from,
    labels,
    liveTo,
    locale,
    paintTo,
    times,
  ])
  const storyByIdRef = useRef<Map<number, FeedStory>>(new Map())
  const storySlotsSeenRef = useRef(storySlots)
  if (storySlotsSeenRef.current !== storySlots) {
    storySlotsSeenRef.current = storySlots
    const map = new Map<number, FeedStory>()
    for (const slot of storySlots) map.set(slot.story.id, slot.story)
    storyByIdRef.current = map
  }
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const onPeekRef = useRef(onPeek)
  onPeekRef.current = onPeek
  const onPeekEndRef = useRef(onPeekEnd)
  onPeekEndRef.current = onPeekEnd
  const onStarRef = useRef(onToggleStar)
  onStarRef.current = onToggleStar
  const onTrackClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const star = event.target instanceof Element
      ? event.target.closest('.brew-story__star')
      : null
    if (star) {
      const story = storyAtRailTarget(star, storyByIdRef.current)
      if (story) onStarRef.current?.(story)
      return
    }
    const hit = event.target instanceof Element
      ? event.target.closest('.brew-story__hit')
      : null
    if (!hit) return
    const story = storyAtRailTarget(hit, storyByIdRef.current)
    if (story) onOpenRef.current(story)
  }, [])
  const onTrackPointerOver = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') return
      const story = storyAtRailTarget(event.target, storyByIdRef.current)
      if (!story) return
      const node = event.target instanceof Element
        ? event.target.closest('.brew-story')
        : null
      const from = event.relatedTarget
      if (from instanceof Node && node?.contains(from)) return
      markBrewStoryPeek(node, true)
      onPeekRef.current(story)
    },
    [],
  )
  const onTrackPointerOut = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') return
      const node = event.target instanceof Element
        ? event.target.closest('.brew-story')
        : null
      const to = event.relatedTarget
      if (node && to instanceof Node && node.contains(to)) return
      if (storyAtRailTarget(event.relatedTarget, storyByIdRef.current)) return
      if (to instanceof Node && event.currentTarget.contains(to)) return
      onPeekEndRef.current()
    },
    [],
  )
  return (
    <div
      className="brew-feeds__items-track"
      ref={trackRef}
      data-brew-rail-track="items"
      style={trackStyle}
      onClick={onTrackClick}
      onPointerOver={onTrackPointerOver}
      onPointerOut={onTrackPointerOut}
    >
      {painted}
    </div>
  )
})

function paintSiteInk(img: HTMLImageElement, fallback: string | null): void {
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
    const card = img.closest('.brew-site')
    if (card instanceof HTMLElement) {
      card.style.setProperty('--site-ink', normalizeThemeColor(primary))
    }
  } catch {
    // 取色失败保持默认灰。
  }
}

interface BrewFeedsProps {
  sources: BrewSource[]
  focusSourceId?: number | null
  isEditMode?: boolean
  selectedIds?: Set<number>
  onToggleSelect?: (id: number) => void
  onSourceClick: (source: BrewSource) => void
  onOpenItem?: (item: BrewItemPreview, source: BrewSource) => void
  onPeekItem?: (item: BrewItemPreview) => void
  onPeekEnd?: () => void
  onToggleStar?: (item: BrewItemPreview) => void | false | Promise<void | false>
  onEditSource?: (source: BrewSource) => void
  toolbar?: ReactNode
  vacant?: ReactNode
  stories?: FeedStory[]
  onExpandStories?: (direction: 1 | -1) => void
  onJumpSource?: (sourceId: number) => void
  onHoldStories?: () => void
  onReleaseStories?: () => void
  railEpoch?: number | string
  onReadySource?: (id: number | null) => void
  sourceTags?: ReactNode
}

function BrewFeeds({
  sources,
  focusSourceId,
  isEditMode = false,
  selectedIds,
  onToggleSelect,
  onSourceClick: _onSourceClick,
  onOpenItem,
  onPeekItem,
  onPeekEnd,
  onToggleStar,
  onEditSource,
  toolbar,
  vacant,
  stories = [],
  onExpandStories,
  onJumpSource,
  onHoldStories,
  onReleaseStories,
  railEpoch = 0,
  onReadySource,
  sourceTags,
}: BrewFeedsProps) {
  const { t, locale, format } = useI18n()
  const sitesTitleId = useId()
  const itemsTitleId = useId()
  const feedsRef = useRef<HTMLDivElement>(null)
  const sitesViewRef = useRef<HTMLDivElement>(null)
  const sitesTrackRef = useRef<HTMLDivElement>(null)
  const sitesApiRef = useRef<BrewRailApi | null>(null)
  const itemsViewRef = useRef<HTMLDivElement>(null)
  const itemsTrackRef = useRef<HTMLDivElement>(null)
  const itemsApiRef = useRef<BrewRailApi | null>(null)
  const skipStoryAlignRef = useRef(false)
  const pendingStoryAlignRef = useRef<number | null>(null)
  const railDriverRef = useRef<'sites' | 'stories' | null>(null)
  const [focusId, setFocusId] = useState<number | null>(
    sources.length > 0 ? LATEST_FEED_ID : null,
  )
  const [readyId, setReadyId] = useState<number | null>(
    sources.length > 0 ? LATEST_FEED_ID : null,
  )
  const lastSourceRef = useRef<number | null>(
    sources.length > 0 ? LATEST_FEED_ID : null,
  )
  const paintedOnRef = useRef<number | null>(
    sources.length > 0 ? LATEST_FEED_ID : null,
  )
  const paintedElRef = useRef<HTMLElement | null>(null)
  const siteElsRef = useRef(new Map<number, HTMLElement>())
  const focusIdRef = useRef<number | null>(
    sources.length > 0 ? LATEST_FEED_ID : null,
  )
  focusIdRef.current = focusId
  const focusTimerRef = useRef(0)
  const growFrameRef = useRef(0)
  const reactMountStaleRef = useRef(false)
  const lastEagerRef = useRef<{ from: number; to: number }>({ from: 1, to: 8 })
  const storyWarmRef = useRef<() => void>(() => {})
  const pendingFlushRef = useRef(false)
  const pendingExpandRef = useRef<1 | -1 | null>(null)
  const grabbingRef = useRef(false)
  const [flipping, setFlipping] = useState(false)
  const [sitesBooted, setSitesBooted] = useState(() => brewFlipQuiet())
  const [storiesBooted, setStoriesBooted] = useState(() => brewFlipQuiet())
  const flipLock = useRef(false)
  const motionHolds = useRef(0)
  const introSites = useRef(false)
  const introStories = useRef(false)
  const appliedFocus = useRef<number | null>(null)
  const seatSitesRef = useRef<number | null>(null)
  const brewLabels = t.brew
  const times = useBrewTimes()
  const storyPaintRef = useRef({
    times,
    locale,
    labels: brewLabels,
    canStar: onToggleStar != null,
  })
  storyPaintRef.current = {
    times,
    locale,
    labels: brewLabels,
    canStar: onToggleStar != null,
  }

  const focus = useMemo(
    () => sources.find((s) => s.id === focusId) ?? null,
    [sources, focusId],
  )
  const ready = useMemo(
    () => sources.find((s) => s.id === readyId) ?? focus,
    [sources, readyId, focus],
  )

  useEffect(() => {
    if (!sources.length) {
      lastSourceRef.current = null
      paintedOnRef.current = null
      paintedElRef.current = null
      setFocusId(null)
      setReadyId(null)
      return
    }
    if (
      focusSourceId &&
      appliedFocus.current !== focusSourceId &&
      sources.some((s) => s.id === focusSourceId)
    ) {
      appliedFocus.current = focusSourceId
      railDriverRef.current = 'sites'
      lastSourceRef.current = focusSourceId
      paintedOnRef.current = focusSourceId
      paintedElRef.current = null
      setFocusId(focusSourceId)
      setReadyId(focusSourceId)
      onJumpSource?.(focusSourceId)
      seatSitesRef.current = focusSourceId
      return
    }
    if (
      focusId == null ||
      (!isLatestFeedId(focusId) && !sources.some((s) => s.id === focusId))
    ) {
      lastSourceRef.current = LATEST_FEED_ID
      paintedOnRef.current = LATEST_FEED_ID
      paintedElRef.current = null
      setFocusId(LATEST_FEED_ID)
      setReadyId(LATEST_FEED_ID)
    }
  }, [sources, focusId, focusSourceId, onJumpSource])

  useLayoutEffect(() => {
    const id = seatSitesRef.current
    if (id == null || id !== focusId) return
    seatSitesRef.current = null
    sitesApiRef.current?.align(id, true)
  }, [focusId])

  useEffect(() => {
    if (focusId == null || focusId === readyId) return
    const timer = window.setTimeout(setReadyId, ARTICLES_SETTLE_MS, focusId)
    return () => window.clearTimeout(timer)
  }, [focusId, readyId])

  useEffect(() => {
    onReadySource?.(readyId)
  }, [onReadySource, readyId])

  const siteKey = useMemo(
    () =>
      sources.length > 0
        ? `${LATEST_FEED_ID},${sources.map((source) => source.id).join(',')}`
        : '',
    [sources],
  )
  const inboxLead = useMemo(
    () => firstStoryForRailGroup(stories, LATEST_FEED_ID),
    [stories],
  )
  const inbox = useMemo(() => {
    if (sources.length === 0) return null
    return {
      name: brewLabels.latestFeed,
      description: format(brewLabels.topicSourceCount, { count: sources.length }),
      latestTitle: inboxLead?.title,
      latestWhen: inboxLead
        ? brewRelativeTime(inboxLead.published_at, times, locale)
        : '',
      stack: latestFeedStackFaces(sources, stories).map((face) => ({
        key: face.key,
        src: getIconUrl(face.src),
        mark: face.mark,
        ink: normalizeThemeColor(face.ink),
      })),
    }
  }, [brewLabels, format, inboxLead, locale, sources, stories, times])

  const onLeadChange = useCallback((id: number) => {
    lastSourceRef.current = id
    paintSiteOn(
      sitesTrackRef.current,
      id,
      paintedOnRef,
      paintedElRef,
      siteElsRef.current,
    )
    skipStoryAlignRef.current = true
    setFocusId(id)
  }, [])

  useEffect(() => {
    return () => {
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)
      if (growFrameRef.current) window.cancelAnimationFrame(growFrameRef.current)
    }
  }, [])
  const storiesRef = useRef(stories)
  const storyIndexRef = useRef<Map<number, number>>(new Map())
  if (storyIndexRef.current.size === 0 || storiesRef.current !== stories) {
    const map = new Map<number, number>()
    for (let i = 0; i < stories.length; i++) map.set(stories[i].id, i)
    storyIndexRef.current = map
  }
  storiesRef.current = stories
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const activateSiteRef = useRef<(id: number) => void>(() => {})
  const onEditSourceRef = useRef(onEditSource)
  onEditSourceRef.current = onEditSource
  const onActivateSite = useCallback((id: number | string) => {
    activateSiteRef.current(Number(id))
  }, [])
  const onOpenLatestSite = useCallback((id: number | string) => {
    const n = Number(id)
    if (isLatestFeedId(n)) {
      const latest = firstStoryForRailGroup(storiesRef.current, LATEST_FEED_ID)
      if (latest) openArticleRef.current(latest)
      return
    }
    const source = sourcesRef.current.find((entry) => entry.id === n)
    const latest = source?.recent_items?.[0]
    if (source && latest) openArticleRef.current(latest, source)
  }, [])
  const onEditSite = useCallback((id: number | string) => {
    const source = sourcesRef.current.find((entry) => entry.id === Number(id))
    if (source) onEditSourceRef.current?.(source)
  }, [])
  const onIconLoadSite = useCallback((img: HTMLImageElement) => {
    const id = Number(img.closest('.brew-site')?.getAttribute('data-rail-id'))
    const theme = sourcesRef.current.find((entry) => entry.id === id)?.theme_color
    const idle = window.requestIdleCallback
    if (idle) {
      idle(() => paintSiteInk(img, theme ?? null), { timeout: 800 })
      return
    }
    window.setTimeout(paintSiteInk, 0, img, theme ?? null)
  }, [])
  const slotCacheRef = useRef<StorySlot[]>([])
  const storySlots = useMemo(() => {
    const next = storyRailSlots(stories, slotCacheRef.current)
    slotCacheRef.current = next
    return next
  }, [stories])
  const colCacheRef = useRef<Array<{ id: number; column: number }>>([])
  const sourceCols = useMemo(() => {
    const next = sourceColumnStarts(storySlots, colCacheRef.current)
    colCacheRef.current = next
    return next
  }, [storySlots])
  const sourceColsRef = useRef(sourceCols)
  sourceColsRef.current = sourceCols
  const storySlotsRef = useRef(storySlots)
  storySlotsRef.current = storySlots
  const colLeadRef = useRef(new Map<number, number>())
  const colLeadSlotsRef = useRef<readonly StorySlot[] | null>(null)
  const storyByColRef = useRef(new Map<number, StorySlot[]>())
  if (colLeadSlotsRef.current !== storySlots) {
    colLeadSlotsRef.current = storySlots
    colLeadRef.current = storyColumnLeads(storySlots)
    storyByColRef.current = storySlotsByColumn(storySlots, storyByColRef.current)
  }
  const driveStopsRef = useRef<number[]>([])
  const followStopsRef = useRef<number[]>([])
  const sourceStartsRef = useRef<Array<{ id: number; start: number }>>([])
  const stopsColsRef = useRef(sourceCols)
  const stopsColWRef = useRef(0)
  const colWRef = useRef(276)
  const lastSeekRef = useRef(0)
  const followHintRef = useRef({ i: 0 })
  const siteFollowHintRef = useRef({ i: 0 })
  const lastScrollRef = useRef(0)
  const lastViewWRef = useRef(800)
  const siteCardsRef = useRef<Array<{ id: number; left: number }>>([])
  const siteIndexRef = useRef<Map<number, number>>(new Map())
  const siteIndexCardsRef = useRef(siteCardsRef.current)
  const lastSiteViewWRef = useRef(-1)
  const siteCardsMissRef = useRef(false)
  const eagerBandRef = useRef({ from: 1, to: 8 })
  const storyColRef = useRef(0)
  const lastWindowViewRef = useRef(-1)
  const lastWindowColWRef = useRef(-1)
  const siteKeyRef = useRef(siteKey)
  if (siteKeyRef.current !== siteKey) {
    siteKeyRef.current = siteKey
    siteCardsRef.current = []
    lastSiteViewWRef.current = -1
    siteCardsMissRef.current = false
    siteElsRef.current.clear()
  }
  const rebuildFollowStops = useCallback((colW: number, viewW?: number) => {
    const columns = sourceColsRef.current
    const sites = sitesApiRef.current
    const knownView = lastSiteViewWRef.current
    const viewChanged =
      viewW != null
      && knownView >= 0
      && Math.abs(knownView - viewW) > 8
    if (viewChanged) siteCardsMissRef.current = false
    if (
      sites
      && (
        siteCardsRef.current.length === 0
        || viewChanged
      )
      && !(siteCardsRef.current.length === 0 && siteCardsMissRef.current)
    ) {
      siteCardsRef.current = sites.cards(viewChanged)
      siteCardsMissRef.current = siteCardsRef.current.length === 0
      if (viewW != null) lastSiteViewWRef.current = viewW
    } else if (viewW != null && knownView < 0) {
      lastSiteViewWRef.current = viewW
    }
    const sameDrive =
      stopsColsRef.current === columns
      && Math.abs(stopsColWRef.current - colW) <= 0.5
      && sourceStartsRef.current.length === columns.length
      && driveStopsRef.current.length === columns.length
    stopsColsRef.current = columns
    stopsColWRef.current = colW
    if (!sameDrive) {
      const starts = sourceScrollStarts(columns, colW)
      driveStopsRef.current = starts.map((block) => block.start)
      sourceStartsRef.current = starts
    }
    const siteCards = siteCardsRef.current
    const cardsChanged = siteIndexCardsRef.current !== siteCards
    if (cardsChanged) {
      siteIndexCardsRef.current = siteCards
      const map = new Map<number, number>()
      for (let i = 0; i < siteCards.length; i++) {
        const id = siteCards[i]?.id
        if (id != null) map.set(id, i)
      }
      siteIndexRef.current = map
    }
    if (
      sameDrive
      && !cardsChanged
      && followStopsRef.current.length === columns.length
    ) {
      return
    }
    const siteIndex = siteIndexRef.current
    followStopsRef.current = columns.map((block) =>
      railSeatScroll(
        siteCards,
        siteIndex.get(block.id) ?? 0,
        RAIL_OVERFLOW_LEFT_PX,
      ),
    )
  }, [])
  useLayoutEffect(() => {
    rebuildFollowStops(colWRef.current)
  }, [rebuildFollowStops, sourceCols])
  const mountColsRef = useRef({
    from: 1,
    to: Math.min(RAIL_MOUNT_GROW_AHEAD, RAIL_MOUNT_BOOT_TO),
  })
  const storyMountCommittedRef = useRef(mountColsRef.current)
  const storySetMountRef = useRef<(next: { from: number; to: number }) => void>(
    () => {},
  )
  const liveToRef = useRef(Math.min(RAIL_MOUNT_GROW_AHEAD, RAIL_MOUNT_BOOT_TO))
  const storySetLiveRef = useRef<(next: number) => void>(() => {})
  const expandRef = useRef(onExpandStories)
  expandRef.current = onExpandStories
  const jumpRef = useRef(onJumpSource)
  jumpRef.current = onJumpSource
  const holdStoriesRef = useRef(onHoldStories)
  holdStoriesRef.current = onHoldStories
  const releaseStoriesRef = useRef(onReleaseStories)
  releaseStoriesRef.current = onReleaseStories
  const openArticleRef = useRef<
    (item: BrewItemPreview & { source_id?: number }, source?: BrewSource) => void
  >(() => {})
  const onOpenStory = useCallback((item: FeedStory) => {
    openArticleRef.current(item)
  }, [])
  const onPeekEndRef = useRef(onPeekEnd)
  onPeekEndRef.current = onPeekEnd
  const dropPeek = () => {
    onPeekEndRef.current?.()
  }
  const onPeekStory = useCallback((item: FeedStory) => {
    if (grabbingRef.current) return
    onPeekItem?.(item)
  }, [onPeekItem])
  const onPeekEndStory = useCallback(() => {
    if (grabbingRef.current) return
    onPeekEnd?.()
  }, [onPeekEnd])
  const onToggleStarRef = useRef(onToggleStar)
  onToggleStarRef.current = onToggleStar
  const onStarStory = useCallback((item: FeedStory) => {
    return onToggleStarRef.current?.(item)
  }, [])
  const flushStorySettle = useCallback(() => {
    focusTimerRef.current = 0
    if (grabbingRef.current) {
      pendingFlushRef.current = true
      return
    }
    pendingFlushRef.current = false
    dropStoryDomShells(itemsTrackRef.current)
    let settleId: number | null = null
    let expandDir: 1 | -1 | null = null
    if (railDriverRef.current !== 'sites') {
      const id = lastSourceRef.current
      if (id != null && id !== focusIdRef.current) {
        skipStoryAlignRef.current = true
        focusIdRef.current = id
        settleId = id
      }
      expandDir = pendingExpandRef.current
      pendingExpandRef.current = null
    }
    const columns = sourceColsRef.current
    const totalCols = Math.max(
      1,
      columns.at(-1)?.column ?? storySlotsRef.current.at(-1)?.column ?? 1,
    )
    const prev = storyMountCommittedRef.current
    const settled = railMountColumnsSettle(
      prev,
      lastScrollRef.current,
      lastViewWRef.current,
      colWRef.current,
      totalCols,
    )
    const ideal = railMountColumns(
      lastScrollRef.current,
      lastViewWRef.current,
      colWRef.current,
      totalCols,
    )
    const stale = reactMountStaleRef.current
    reactMountStaleRef.current = false
    const covered = prev.from <= ideal.from && prev.to >= ideal.to
    const next = stale && !covered
      ? { from: ideal.from, to: ideal.to }
      : settled
    const mountChanged = next.from !== prev.from || next.to !== prev.to
    if (mountChanged) {
      mountColsRef.current = next
      storyMountCommittedRef.current = next
      liveToRef.current = Math.min(liveToRef.current, next.to)
    } else {
      mountColsRef.current = prev
      liveToRef.current = Math.min(liveToRef.current, prev.to)
    }
    const syncMount = mountChanged
    const prevBand = eagerBandRef.current
    eagerBandRef.current = ideal
    paintStoryAway(itemsTrackRef.current, ideal.from, ideal.to, prevBand)
    if (!syncMount) {
      eagerStoryCovers(itemsTrackRef.current, ideal.from, ideal.to, prevBand)
      lastEagerRef.current = { from: ideal.from, to: ideal.to }
    }
    if (settleId == null && expandDir == null && !syncMount) {
      storySetLiveRef.current(liveToRef.current)
      return
    }
    startTransition(() => {
      if (settleId != null) {
        appliedFocus.current = settleId
        setFocusId(settleId)
        jumpRef.current?.(settleId)
      }
      if (expandDir) expandRef.current?.(expandDir)
      if (syncMount) storySetMountRef.current(mountColsRef.current)
      storySetLiveRef.current(liveToRef.current)
    })
  }, [])
  const onStoryScroll = useCallback(
    (state: { scroll: number; viewW: number; colW: number }) => {
      if (state.colW > 1) colWRef.current = state.colW
      lastScrollRef.current = state.scroll
      lastViewWRef.current = state.viewW
      const colW = colWRef.current
      const columns = sourceColsRef.current
      const sites = sitesApiRef.current
      let needStops =
        stopsColsRef.current !== columns
        || driveStopsRef.current.length !== columns.length
        || Math.abs(stopsColWRef.current - colW) > 0.5
      if (
        sites
        && (
          (
            siteCardsRef.current.length === 0
            && !siteCardsMissRef.current
          )
          || (
            lastSiteViewWRef.current >= 0
            && Math.abs(lastSiteViewWRef.current - state.viewW) > 8
          )
        )
      ) {
        needStops = true
      } else if (lastSiteViewWRef.current < 0) {
        lastSiteViewWRef.current = state.viewW
      }
      if (needStops) {
        rebuildFollowStops(colW, state.viewW)
        followHintRef.current.i = 0
      }
      if (railDriverRef.current !== 'sites') {
        const siteX = followRailScroll(
          state.scroll,
          driveStopsRef.current,
          followStopsRef.current,
          followHintRef.current,
        )
        if (Math.abs(siteX - lastSeekRef.current) > 0.5) {
          lastSeekRef.current = siteX
          sitesApiRef.current?.seek(siteX)
        }
      }
      const col = railLeadColumn(state.scroll, colW)
      if (
        col === storyColRef.current
        && Math.abs(state.viewW - lastWindowViewRef.current) <= 8
        && Math.abs(colW - lastWindowColWRef.current) <= 0.5
      ) {
        return
      }
      storyColRef.current = col
      lastWindowViewRef.current = state.viewW
      lastWindowColWRef.current = colW
      const lead = storySlotAtColumn(
        storySlotsRef.current,
        col,
        colLeadRef.current,
      )
      if (lead) {
        const index = storyIndexRef.current.get(lead.story.id)
        if (index != null) {
          const len = storiesRef.current.length
          const dir: 1 | -1 | null =
            index >= len - 4 ? 1 : index <= 3 ? -1 : null
          if (dir != null) {
            pendingExpandRef.current = dir
            if (!focusTimerRef.current) {
              focusTimerRef.current = window.setTimeout(
                flushStorySettle,
                FOCUS_FOLLOW_MS,
              )
            }
          }
        }
      }
      const totalCols = Math.max(
        1,
        columns.at(-1)?.column ?? storySlotsRef.current.at(-1)?.column ?? 1,
      )
      const ideal = railMountColumns(
        state.scroll,
        state.viewW,
        colW,
        totalCols,
      )
      const fillGrabLive = (from: number, to: number) => {
        if (from > to) return
        const paintTo = Math.min(to, eagerBandRef.current.to)
        if (from > paintTo) return
        const paint = storyPaintRef.current
        const ready = ensureStoryShells(
          itemsTrackRef.current,
          from,
          paintTo,
          storySlotsRef.current,
        )
        paintStoryLiveCols(
          itemsTrackRef.current,
          from,
          paintTo,
          storyByColRef.current,
          paint.times,
          paint.locale,
          paint.labels,
          eagerBandRef.current.to,
          paint.canStar,
          true,
          ready,
        )
      }
      if (
        ideal.from !== eagerBandRef.current.from
        || ideal.to !== eagerBandRef.current.to
      ) {
        const prevBand = eagerBandRef.current
        eagerBandRef.current = ideal
        const mounted = mountColsRef.current
        const eagerFrom = Math.max(ideal.from, mounted.from)
        const eagerTo = Math.min(ideal.to, mounted.to)
        paintStoryAway(
          itemsTrackRef.current,
          ideal.from,
          ideal.to,
          prevBand,
          !grabbingRef.current,
        )
        if (grabbingRef.current) {
          recycleStoryDomShellsOutside(
            itemsTrackRef.current,
            ideal.from,
            ideal.to,
          )
          if (ideal.to > prevBand.to) {
            fillGrabLive(prevBand.to + 1, ideal.to)
          }
          if (ideal.from < prevBand.from) {
            fillGrabLive(ideal.from, prevBand.from - 1)
          }
        }
        if (!grabbingRef.current) {
          eagerStoryCovers(
            itemsTrackRef.current,
            eagerFrom,
            eagerTo,
            prevBand,
          )
          lastEagerRef.current = { from: eagerFrom, to: eagerTo }
        }
      }
      let dirty = false
      let growReact = false
      const prevCols = mountColsRef.current
      const grown = railMountColumnsCovered(
        prevCols,
        ideal,
        totalCols,
        Number.POSITIVE_INFINITY,
        RAIL_MOUNT_RESERVE,
      )
        ? prevCols
        : railMountColumnsPan(
            prevCols,
            state.scroll,
            state.viewW,
            colW,
            totalCols,
          )
      if (grown.from !== prevCols.from || grown.to !== prevCols.to) {
        const prevLive = liveToRef.current
        if (grabbingRef.current) {
          mountColsRef.current = grown
          reactMountStaleRef.current = true
        }
        mountColsRef.current = grown
        liveToRef.current = railLiveTo(
          ideal.to,
          grown.to,
          liveToRef.current,
        )
        if (grabbingRef.current) {
          fillGrabLive(prevLive + 1, liveToRef.current)
        } else {
          growReact = true
        }
        dirty = true
      }
      if (ideal.to + RAIL_MOUNT_RESERVE > liveToRef.current) {
        const prevLive = liveToRef.current
        const nextLive = railLiveTo(
          ideal.to,
          mountColsRef.current.to,
          liveToRef.current,
        )
        if (nextLive > prevLive) {
          liveToRef.current = nextLive
          if (grabbingRef.current) {
            fillGrabLive(prevLive + 1, nextLive)
          } else {
            dirty = true
            growReact = true
          }
        }
      }
      if (growReact && !growFrameRef.current) {
        growFrameRef.current = window.requestAnimationFrame(() => {
          growFrameRef.current = 0
          startTransition(() => {
            storySetMountRef.current(mountColsRef.current)
            storySetLiveRef.current(liveToRef.current)
          })
        })
      }
      if (railDriverRef.current === 'sites') return
      const sourceId =
        (lead ? storyRailGroup(lead.story) : undefined)
        ?? sourceAtScroll(state.scroll, sourceStartsRef.current)
      if (sourceId != null && sourceId !== lastSourceRef.current) {
        lastSourceRef.current = sourceId
        paintSiteOn(
          sitesTrackRef.current,
          sourceId,
          paintedOnRef,
          paintedElRef,
          siteElsRef.current,
        )
        skipStoryAlignRef.current = true
        dirty = true
      }
      if (!dirty) return
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)
      focusTimerRef.current = window.setTimeout(flushStorySettle, FOCUS_FOLLOW_MS)
    },
    [flushStorySettle, rebuildFollowStops],
  )
  const onSiteScroll = useCallback(
    (state: { scroll: number; viewW: number; colW: number }) => {
      if (railDriverRef.current !== 'sites') return
      const colW = colWRef.current
      if (
        driveStopsRef.current.length === 0
        || followStopsRef.current.length === 0
      ) {
        rebuildFollowStops(colW, state.viewW)
      }
      const storyX = followRailScroll(
        state.scroll,
        followStopsRef.current,
        driveStopsRef.current,
        siteFollowHintRef.current,
      )
      if (Math.abs(storyX - lastScrollRef.current) > 0.5) {
        itemsApiRef.current?.seek(storyX)
      }
      onStoryScroll({
        scroll: storyX,
        viewW:
          lastViewWRef.current
          || itemsViewRef.current?.clientWidth
          || state.viewW,
        colW,
      })
    },
    [onStoryScroll, rebuildFollowStops],
  )
  const paintGrabbing = (on: boolean) => {
    grabbingRef.current = on
    feedsRef.current?.classList.toggle('is-rail-grabbing', on)
  }
  const paintFollowLayer = (on: boolean) => {
    const track = sitesTrackRef.current
    if (track) track.style.willChange = on ? 'transform' : ''
  }
  useLayoutEffect(() => {
    feedsRef.current?.classList.toggle('is-rail-grabbing', grabbingRef.current)
  })
  const onSiteGrab = useCallback(() => {
    railDriverRef.current = 'sites'
    paintGrabbing(true)
    holdStoriesRef.current?.()
    dropPeek()
  }, [])
  const onStoryGrab = useCallback(() => {
    railDriverRef.current = 'stories'
    paintGrabbing(true)
    paintFollowLayer(true)
    holdStoriesRef.current?.()
    dropPeek()
  }, [])
  const onSiteIdle = useCallback(() => {
    paintGrabbing(false)
    const id = lastSourceRef.current
    if (id != null) {
      appliedFocus.current = id
      skipStoryAlignRef.current = true
      jumpRef.current?.(id)
    }
    if (pendingFlushRef.current) flushStorySettle()
    releaseStoriesRef.current?.()
  }, [flushStorySettle])
  const onStoryIdle = useCallback(() => {
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)
    paintGrabbing(false)
    paintFollowLayer(false)
    flushStorySettle()
    const releaseAndWarm = () => {
      releaseStoriesRef.current?.()
      storyWarmRef.current()
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(releaseAndWarm)
    } else {
      window.setTimeout(releaseAndWarm, 0)
    }
  }, [flushStorySettle])

  const railsReady =
    brewFlipQuiet() ||
    (introSites.current && (stories.length === 0 || introStories.current))

  useBrewRailPan(
    sitesViewRef,
    sitesTrackRef,
    !flipping && railsReady && sources.length > 0,
    siteKey,
    '.brew-site',
    onLeadChange,
    sitesApiRef,
    true,
    onSiteScroll,
    onSiteGrab,
    onSiteIdle,
  )

  useBrewRailPan(
    itemsViewRef,
    itemsTrackRef,
    !flipping && railsReady && stories.length > 0,
    railEpoch,
    '.brew-story',
    undefined,
    itemsApiRef,
    true,
    onStoryScroll,
    onStoryGrab,
    onStoryIdle,
  )

  const alignStoryGroup = (groupId: number | null) => {
    if (groupId == null) return
    const start = sourceColsRef.current.find((block) => block.id === groupId)
    if (!start) return
    const column = start.column
    const mounted = mountColsRef.current
    const leadCol =
      storyColRef.current ||
      railLeadColumn(lastScrollRef.current, colWRef.current)
    const far = Math.abs(column - leadCol) > 1
    if (column < mounted.from || column > mounted.to || far) {
      const colW = colWRef.current
      const totalCols =
        sourceColsRef.current.at(-1)?.column ??
        storySlotsRef.current.at(-1)?.column ??
        column
      const ideal = railMountColumns(
        (column - 1) * colW,
        itemsViewRef.current?.clientWidth || 800,
        colW,
        totalCols,
      )
      const next = {
        from: ideal.from,
        to: Math.min(totalCols, ideal.to + RAIL_MOUNT_GROW_AHEAD),
      }
      eagerBandRef.current = ideal
      pendingStoryAlignRef.current = column
      dropStoryDomShells(itemsTrackRef.current)
      mountColsRef.current = next
      liveToRef.current = railLiveTo(ideal.to, next.to)
      storySetMountRef.current(next)
      storySetLiveRef.current(liveToRef.current)
    }
    itemsApiRef.current?.alignColumn(column, true)
  }

  const prevStorySlotsRef = useRef(storySlots)
  useLayoutEffect(() => {
    const prev = prevStorySlotsRef.current
    prevStorySlotsRef.current = storySlots
    if (prev === storySlots) return
    const colW = colWRef.current
    if (colW <= 1) return
    const scroll = railTrackScroll(itemsTrackRef.current, lastScrollRef.current)
    lastScrollRef.current = scroll
    const leadCol = railLeadColumn(scroll, colW)
    const shift = storyColumnShift(prev, storySlots, leadCol)
    if (shift) itemsApiRef.current?.nudge(shift * colW)
  }, [storySlots])

  useLayoutEffect(() => {
    if (skipStoryAlignRef.current) {
      skipStoryAlignRef.current = false
      return
    }
    alignStoryGroup(focusId)
  }, [focusId])

  const holdMotion = () => {
    motionHolds.current += 1
    flipLock.current = true
    setFlipping(true)
  }

  const releaseMotion = () => {
    motionHolds.current = Math.max(0, motionHolds.current - 1)
    if (motionHolds.current > 0) return
    flipLock.current = false
    setFlipping(false)
  }

  const cancelOwn = (anims: readonly Animation[]) => {
    for (const anim of anims) {
      try {
        anim.cancel()
      } catch {
      }
    }
  }

  useLayoutEffect(() => {
    if (brewFlipQuiet()) {
      introSites.current = true
      setSitesBooted(true)
      return
    }
    if (flipLock.current || introSites.current || sources.length === 0) return
    const root = feedsRef.current
    const track = sitesTrackRef.current
    if (!root) return
    introSites.current = true
    holdMotion()
    setSitesBooted(true)
    const lead = focusId != null ? String(focusId) : null
    if (track && focusId != null) seatSiteTrack(track, focusId)
    clearRailExits(root, '.brew-site')
    const anims = enterSites(root, 0, lead)
    let alive = true
    let released = false
    const finish = () => {
      if (released) return
      released = true
      cancelOwn(anims)
      releaseMotion()
    }
    void waitFlip(anims).then(() => {
      if (!alive) return
      finish()
    })
    return () => {
      alive = false
      finish()
    }
  }, [sources.length])

  useLayoutEffect(() => {
    if (brewFlipQuiet()) {
      introStories.current = true
      setStoriesBooted(true)
      return
    }
    if (introStories.current || stories.length === 0) return
    if (sources.length > 0 && !introSites.current) return
    if (flipLock.current && !introSites.current) return
    const root = feedsRef.current
    if (!root) return
    introStories.current = true
    holdMotion()
    setStoriesBooted(true)
    clearRailExits(root, '.brew-story')
    const extra = motionHolds.current > 1 ? FLIP_INTRO_STORY_MS : 0
    const anims = enterStories(root, '.brew-story:not(.brew-story--slot)', extra)
    let alive = true
    let released = false
    const finish = () => {
      if (released) return
      released = true
      cancelOwn(anims)
      releaseMotion()
    }
    void waitFlip(anims).then(() => {
      if (!alive) return
      finish()
    })
    return () => {
      alive = false
      finish()
    }
  }, [stories.length, sources.length])

  const activateSite = (id: number) => {
    if (!isLatestFeedId(id) && isEditMode) {
      onToggleSelect?.(id)
      return
    }
    if (isLatestFeedId(id) && isEditMode) return
    railDriverRef.current = 'sites'
    lastSourceRef.current = id
    paintedOnRef.current = id
    paintedElRef.current = null
    if (focusTimerRef.current) {
      window.clearTimeout(focusTimerRef.current)
      focusTimerRef.current = 0
    }
    pendingFlushRef.current = false
    setFocusId(id)
    setReadyId(id)
    onJumpSource?.(id)
    sitesApiRef.current?.align(id)
    alignStoryGroup(id)
  }
  activateSiteRef.current = activateSite

  const openArticle = (
    item: BrewItemPreview & { source_id?: number },
    source?: BrewSource,
  ) => {
    const target =
      source ??
      (item.source_id != null
        ? sources.find((entry) => entry.id === item.source_id)
        : undefined) ??
      ready ??
      focus
    if (!target) return
    if (isEditMode) {
      onToggleSelect?.(target.id)
      return
    }
    lastSourceRef.current = target.id
    paintedOnRef.current = target.id
    paintedElRef.current = null
    setFocusId(target.id)
    setReadyId(target.id)
    sitesApiRef.current?.align(target.id)
    onOpenItem?.(item, target)
  }
  openArticleRef.current = openArticle

  return (
    <div
      ref={feedsRef}
      className={`brew-skin brew-feeds${flipping ? ' is-sites-flipping' : ''}${sitesBooted ? ' is-sites-booted' : ''}${storiesBooted ? ' is-stories-booted' : ''}`}
    >
      <div className="brew-feeds__air" aria-hidden />
      <div className="brew-feeds__stage">
        <div className="brew-feeds__bar">{toolbar}</div>
        <section
          className="brew-feeds__sites"
          ref={sitesViewRef}
          aria-labelledby={sitesTitleId}
        >
          <div className="brew-feeds__source-chrome">
          <BrewRailTitle
            id={sitesTitleId}
            action={sourceTags}
            pinned={isEditMode}
          >
            {t.brew.sources}
          </BrewRailTitle>
          </div>
          {vacant || null}
          <div
            className="brew-feeds__sites-track"
            ref={sitesTrackRef}
            data-brew-rail-track="sites"
            hidden={!!vacant}
          >
          <BrewFeedsSites
            sources={sources}
            inbox={inbox}
            onId={lastSourceRef.current ?? focusId}
            times={times}
            locale={locale}
            isEditMode={isEditMode}
            selectedIds={selectedIds}
            emptyLabel={t.brew.noArticles}
            editLabel={t.brew.editSource}
            canEdit={!!onEditSource}
            onActivate={onActivateSite}
            onOpenLatest={onOpenLatestSite}
            onEdit={onEditSite}
            onIconLoad={onIconLoadSite}
          />
          </div>
        </section>

        <section
          className="brew-feeds__items"
          ref={itemsViewRef}
          hidden={!!vacant}
          aria-labelledby={itemsTitleId}
        >
          <BrewRailTitle id={itemsTitleId}>
            {t.brew.latestArticles}
          </BrewRailTitle>
          {stories.length === 0 ? (
            <BrewVacant title={t.brew.noArticles} />
          ) : (
            <BrewFeedsStories
              storySlots={storySlots}
              times={times}
              locale={locale}
              labels={brewLabels}
              onOpen={onOpenStory}
              onPeek={onPeekStory}
              onPeekEnd={onPeekEndStory}
              onToggleStar={onToggleStar ? onStarStory : undefined}
              trackRef={itemsTrackRef}
              setMountRef={storySetMountRef}
              setLiveRef={storySetLiveRef}
              mountCommittedRef={storyMountCommittedRef}
              mountColsRef={mountColsRef}
              liveToRef={liveToRef}
              pendingStoryAlignRef={pendingStoryAlignRef}
              itemsApiRef={itemsApiRef}
              eagerBandRef={eagerBandRef}
              lastEagerRef={lastEagerRef}
              warmRef={storyWarmRef}
              grabbingRef={grabbingRef}
            />
          )}
        </section>
      </div>
    </div>
  )
}

export default memo(BrewFeeds)
