import type { CSSProperties, FocusEvent, MouseEvent, PointerEvent, ReactNode, RefObject } from 'react'
import type { FeedStory } from '../logic/feedStories'
import type { TimeTranslations } from '../types'
import type { PhantasiRailApi } from './usePhantasiRailPan'

import { isValidElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  notePeekPointer,
  peekLaneKeepsAir,
  peekStoryNode,
  peekSwapHoldsAir,
} from '../ui/peekLane'
import { markPhantasiStoryPeek } from '../ui/StoryCard'
import { PhantasiStoryColumn } from './PhantasiStory'
import {
  clipPaintedBatches,
  extendPaintedRange,
  storySlotsByColumn,
} from '../logic/feedStories'
import {
  eagerStoryCovers,
  onStoryMediaError,
  paintStoryAway,
  RAIL_MOUNT_BOOT_TO,
  RAIL_MOUNT_GROW_AHEAD,
  RAIL_MOUNT_LIVE_PAD,
  RAIL_MOUNT_RESERVE,
  recycleStoryDomShellsOutside,
  storyMountWindow,
  storyRailTrackSize,
} from './railPan'
import { warmStoryCovers, warmStoryFaces } from './storyFace'

export interface StorySlot { story: FeedStory; column: number; row: 1 | 2 }

function storyAtRailTarget(
  target: EventTarget | null,
  byId: ReadonlyMap<number, FeedStory>,
): FeedStory | undefined {
  const node = peekStoryNode(target)
  if (!node) return
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

export const PhantasiFeedsStories = memo(({
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
  itemsApiRef: RefObject<PhantasiRailApi | null>
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
    setLiveTo((prev) => {
      if (prev === next) {
        if (!grabbingRef.current) {
          recycleStoryDomShellsOutside(
            trackRef.current,
            prev + 1,
            Number.POSITIVE_INFINITY,
          )
        }
        return prev
      }
      return next
    })
  }, [grabbingRef, liveToRef, trackRef])
  useLayoutEffect(() => {
    setMountRef.current = setMount
  }, [setMount, setMountRef])
  useLayoutEffect(() => {
    setLiveRef.current = setLive
  }, [setLive, setLiveRef])
  useLayoutEffect(() => {
    if (grabbingRef.current) return
    recycleStoryDomShellsOutside(
      trackRef.current,
      liveTo + 1,
      Number.POSITIVE_INFINITY,
    )
  }, [grabbingRef, liveTo, mountCols.from, mountCols.to, trackRef])
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
      false,
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
            <PhantasiStoryColumn
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
      if (mounted.to > bootTo + RAIL_MOUNT_LIVE_PAD) return
      const padTo = Math.min(bootTo + RAIL_MOUNT_LIVE_PAD, storyCols)
      if (padTo <= mounted.to) return
      const next = { from: mounted.from, to: padTo }
      mountColsRef.current = next
      liveToRef.current = padTo
      setLive(padTo)
      setMount(next)
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
      '--phantasi-story-cols': storyCols,
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
    const jumped =
      prevRange.from > 0
      && prevRange.to >= prevRange.from
      && (grid.from > prevRange.to || grid.to < prevRange.from)
    if (jumped) {
      prebuiltColsRef.current.clear()
      paintedBatchesRef.current = []
      paintedHeadRef.current = null
      paintedOutRef.current = []
      paintedLiveToRef.current = 0
      paintedRangeRef.current = { from: 0, to: 0 }
    }
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
        <PhantasiStoryColumn
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
            <PhantasiStoryColumn
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
      jumped ? 0 : prevRange.from,
      jumped ? 0 : prevRange.to,
      grid.from,
      paintTo,
      make,
      reset || jumped,
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
      ? event.target.closest('.phantasi-story__star')
      : null
    if (star) {
      const story = storyAtRailTarget(star, storyByIdRef.current)
      if (story) onStarRef.current?.(story)
      return
    }
    const hit = event.target instanceof Element
      ? event.target.closest('.phantasi-story__hit')
      : null
    if (!hit) return
    const story = storyAtRailTarget(hit, storyByIdRef.current)
    if (story) onOpenRef.current(story)
  }, [])
  const onTrackPointerOver = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch' || grabbingRef.current) return
      const story = storyAtRailTarget(event.target, storyByIdRef.current)
      if (!story) return
      const node = peekStoryNode(event.target)
      const from = event.relatedTarget
      if (from instanceof Node && node?.contains(from)) return
      notePeekPointer(event)
      markPhantasiStoryPeek(node, true)
      onPeekRef.current(story)
    },
    [grabbingRef],
  )
  const onTrackPointerOut = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch' || grabbingRef.current) return
      const node = peekStoryNode(event.target)
      const to = event.relatedTarget
      if (node && to instanceof Node && node.contains(to)) return
      markPhantasiStoryPeek(node, false)
      if (peekLaneKeepsAir(node ?? event.target, to)) return
      if (peekSwapHoldsAir(node ?? event.target)) return
      onPeekEndRef.current()
    },
    [grabbingRef],
  )
  const onTrackPointerCancel = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (grabbingRef.current) return
      markPhantasiStoryPeek(event.target, false)
      if (peekSwapHoldsAir(event.target)) return
      onPeekEndRef.current()
    },
    [grabbingRef],
  )
  const onTrackFocusIn = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (grabbingRef.current) return
    const story = storyAtRailTarget(event.target, storyByIdRef.current)
    if (!story) return
    markPhantasiStoryPeek(event.target, true)
    onPeekRef.current(story)
  }, [grabbingRef])
  const onTrackFocusOut = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (grabbingRef.current) return
    markPhantasiStoryPeek(event.target, false)
    if (peekLaneKeepsAir(event.target, event.relatedTarget)) return
    if (peekSwapHoldsAir(event.target)) return
    onPeekEndRef.current()
  }, [grabbingRef])
  return (
    <div
      className="phantasi-feeds__items-track"
      ref={trackRef}
      data-phantasi-rail-track="items"
      style={trackStyle}
      onClick={onTrackClick}
      onPointerOver={onTrackPointerOver}
      onPointerOut={onTrackPointerOut}
      onPointerCancel={onTrackPointerCancel}
      onFocus={onTrackFocusIn}
      onBlur={onTrackFocusOut}
    >
      {painted}
    </div>
  )
})
