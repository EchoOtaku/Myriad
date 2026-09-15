import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

function feedsSrc(): string {
  return [
    readFileSync(join(dir, 'PhantasiFeeds.tsx'), 'utf8'),
    readFileSync(join(dir, 'PhantasiFeedsStories.tsx'), 'utf8'),
    readFileSync(join(dir, 'PhantasiFeedsSites.tsx'), 'utf8'),
  ].join('\n')
}

describe('phantasi feeds 入场 class 链', () => {
  it('订阅页不再展开宫格', () => {
    const src = feedsSrc()
    assert.doesNotMatch(src, /spreadSites/)
    assert.doesNotMatch(src, /setSitesMode/)
    assert.doesNotMatch(src, /foldSites/)
    assert.doesNotMatch(src, /is-sites-open/)
    assert.doesNotMatch(src, /is-sites-morphing/)
    const css = readFileSync(join(dir, '../ui/css/cards.css'), 'utf8')
    const feedsCss = readFileSync(join(dir, '../ui/css/feeds.css'), 'utf8')
    const motionCss = readFileSync(join(dir, '../ui/css/motion.css'), 'utf8')
    assert.doesNotMatch(css, /is-sites-open/)
    assert.doesNotMatch(feedsCss, /is-sites-open/)
    assert.doesNotMatch(feedsCss, /is-sites-morphing/)
    assert.doesNotMatch(motionCss, /is-sites-open/)
  })

    it('滚网站卡 / 文章卡松手就停，不 jump、不补跟、不补源', () => {
    const src = feedsSrc()
    assert.match(src, /function paintSiteOn/)
    assert.match(src, /function indexSiteOnEls/)
    assert.match(src, /siteElsRef/)
    assert.doesNotMatch(src, /FOCUS_FOLLOW_MS/)
    assert.match(src, /paintSiteOn\(\n {10}sitesTrackRef.current/)
    assert.doesNotMatch(
      src,
      /useLayoutEffect\(\(\) => \{\s*paintSiteOn/,
    )
    assert.match(src, /siteFollowHintRef/)
    assert.match(src, /followStopsRef\.current,\n {8}driveStopsRef\.current/)
    assert.doesNotMatch(src, /pendingJumpRef/)
    assert.doesNotMatch(src, /flushPendingJump/)
    assert.doesNotMatch(src, /flushPendingExpand/)
    assert.doesNotMatch(
      src.slice(src.indexOf('const onSiteIdle'), src.indexOf('const onStoryIdle')),
      /jumpRef|setFocusId|flushStorySettle|releaseStories/,
    )
    assert.doesNotMatch(
      src.slice(src.indexOf('if (settleId == null) return'), src.indexOf('const onStoryScroll')),
      /jumpRef/,
    )
    assert.match(
      src,
      /grabbingRef.current && railDriverRef.current === 'stories'/,
    )
    assert.match(
      src.slice(src.indexOf('const onSiteScroll'), src.indexOf('const onSiteGrab')),
      /if \(!grabbingRef.current\) return/,
    )
    assert.match(src, /railCardOffset/)
    assert.doesNotMatch(
      src.slice(src.indexOf('const rebuildFollowStops'), src.indexOf('const flushStorySettle')),
      /railSeatScroll/,
    )
    assert.match(src, /railMountColumnsPan/)
    assert.match(src, /railMountColumnsCovered/)
    assert.doesNotMatch(src, /railMountColumnsGrab/)
    assert.doesNotMatch(src, /grabPumpRef/)
    assert.doesNotMatch(src, /grabWantRef/)
    const storyGrab = src.slice(
      src.indexOf('const onStoryGrab'),
      src.indexOf('const onSiteIdle'),
    )
    assert.doesNotMatch(storyGrab, /startTransition/)
    assert.doesNotMatch(storyGrab, /storySetMount/)
    assert.match(src, /storyRailGroup\(lead\.story\)/)
    assert.match(src, /Math\.max\(ideal\.from, mounted\.from\)/)
    assert.match(src, /RAIL_MOUNT_RESERVE/)
    assert.match(src, /const paintTo = grid\.to/)
    assert.match(src, /mountColsRef\.current = grown/)
    assert.match(src, /Math\.min\(RAIL_MOUNT_GROW_AHEAD, RAIL_MOUNT_BOOT_TO\)/)
    assert.match(src, /Number\.POSITIVE_INFINITY/)
    assert.match(src, /ideal\.to \+ RAIL_MOUNT_GROW_AHEAD/)
    const pan = readFileSync(join(dir, 'railPan.ts'), 'utf8')
    assert.match(pan, /RAIL_MOUNT_GROW_AHEAD/)
    assert.match(pan, /to \+ RAIL_MOUNT_GROW_AHEAD/)
    assert.match(pan, /keepExtra - slack/)
    assert.match(pan, /RAIL_MOUNT_BOOT_TO/)
    assert.match(pan, /RAIL_MOUNT_GRAB_AHEAD/)
    assert.match(pan, /RAIL_MOUNT_SETTLE_EXTRA/)
    assert.match(
      pan,
      /export function railMountColumnsPan\([\s\S]*?return railMountColumnsGrow\(/,
    )
    assert.match(src, /RAIL_MOUNT_BOOT_TO/)
    assert.match(pan, /style\.transform/)
    assert.match(pan, /raw !== 'none'/)
    assert.match(pan, /const kids =/)
    assert.doesNotMatch(pan, /if \(!prev && kids\)/)
    assert.match(pan, /eagerStoryCover/)
    assert.match(src, /storyColRef/)
    assert.match(src, /flushStorySettle/)
    assert.doesNotMatch(
      src,
      /pendingFlushRef.current = false\n {4}dropStoryDomShells\(itemsTrackRef.current\)/,
    )
    assert.match(
      src,
      /recycleStoryDomShellsOutside\(\n {6}trackRef.current,\n {6}liveTo \+ 1,\n {6}Number.POSITIVE_INFINITY,/,
    )
    assert.match(src, /pendingFlushRef/)
    assert.match(src, /pendingFlushRef\.current = true/)
    assert.doesNotMatch(src, /if \(pendingFlushRef\.current\) flushStorySettle/)
    assert.match(src, /id !== focusIdRef\.current/)
    assert.doesNotMatch(
      src.slice(src.indexOf('const onStoryIdle'), src.indexOf('const railsReady')),
      /flushStorySettle|releaseStories|storyWarmRef/,
    )
    assert.match(src, /settleId/)
    assert.match(src, /railMountColumnsSettle/)
    assert.match(src, /true,\n {4}onStoryScroll,\n {4}onStoryGrab,\n {4}onStoryIdle,\n {2}\)/)
    assert.match(src, /true,\n {4}onSiteScroll,\n {4}onSiteGrab,\n {4}onSiteIdle,\n {2}\)/)
    assert.doesNotMatch(src, /snapSlots/)
    assert.match(src, /seatSitesRef/)
    assert.match(src, /appliedFocus\.current = settleId/)
    assert.doesNotMatch(src, /\[focusSourceId, focusId\]/)
    assert.match(src, /alignStoryGroup\(focusId\)\n  }, \[focusId\]\)/)
    assert.match(src, /skipStoryAlignRef.current = true\n    setFocusId\(id\)/)
    assert.match(src, /sitesApiRef.current\?\.align\(id, true\)/)
    assert.match(src, /dropStoryDomShells\(itemsTrackRef.current\)/)
    assert.match(src, /clearPhantasiStoryPeeks\(itemsTrackRef.current\)/)
    assert.match(src, /const jumped =/)
    assert.match(src, /reset \|\| jumped/)
    assert.match(src, /grabbingRef/)
    assert.match(src, /if \(grabbingRef\.current\) return/)
    assert.match(src, /dropPeek/)
    assert.match(src, /is-rail-grabbing/)
    assert.match(src, /paintGrabbing/)
    assert.match(src, /paintFollowLayer/)
    assert.match(src, /on \? 'transform'/)
    assert.match(src, /willChange = value/)
    assert.match(src, /primeStoryMount/)
    assert.match(src, /RAIL_MOUNT_GRAB_AHEAD/)
    assert.match(src, /grabFillRef/)
    assert.match(src, /requestAnimationFrame/)
    assert.match(
      src.slice(src.indexOf('const onSiteGrab'), src.indexOf('const onStoryGrab')),
      /paintFollowLayer\(true\)/,
    )
    assert.match(
      src.slice(src.indexOf('const onSiteIdle'), src.indexOf('const onStoryIdle')),
      /paintFollowLayer\(false\)/,
    )
    assert.doesNotMatch(src, /setRailGrabbing/)
    assert.match(
      src,
      /useLayoutEffect\(\(\) => \{\s*feedsRef\.current\?\.classList\.toggle\('is-rail-grabbing'/,
    )
    assert.match(src, /onHoldStories/)
    assert.match(src, /onReleaseStories/)
    assert.match(src, /onStoryIdle/)
    assert.match(
      src,
      /const onStoryIdle = useCallback\(\(\) => \{\n {4}clearStorySettleTimers\(\)\n {4}paintGrabbing\(false\)\n {4}paintFollowLayer\(false\)/,
    )
    assert.doesNotMatch(src, /const releaseAndWarm =/)
    assert.match(src, /reactMountStaleRef/)
    assert.match(src, /const prev = storyMountCommittedRef.current/)
    assert.match(src, /const settled = railMountColumnsSettle/)
    assert.match(src, /const stale = reactMountStaleRef.current/)
    assert.doesNotMatch(src, /const covered = prev.from <= ideal.from && prev.to >= ideal.to/)
    assert.doesNotMatch(src, /stale && !covered/)
    assert.match(src, /stale \|\| keepLive < ideal.to/)
    assert.match(src, /const next = settled/)
    assert.match(src, /const syncMount = mountChanged/)
    assert.doesNotMatch(src, /const syncMount = mountChanged \|\| stale/)
    assert.match(src, /if \(syncMount\) storySetMountRef.current\(mountColsRef.current\)/)
    assert.match(
      src,
      /if \(syncMount\) storySetMountRef.current\(mountColsRef.current\)\n    storySetLiveRef.current\(liveToRef.current\)\n    if \(settleId == null\) return/,
    )
    assert.match(src, /onSiteIdle/)
    assert.match(src, /const onSiteIdle = useCallback\(\(\) => \{\n {4}clearStorySettleTimers\(\)/)
    assert.match(src, /const clearStorySettleTimers =/)
    assert.match(src, /growFrameRef\.current = 0/)
    assert.match(src, /holdStoriesRef\.current/)
    assert.match(src, /releaseStoriesRef\.current/)
    assert.doesNotMatch(src, /itemsApiRef\.current\?\.refresh\(\)/)
    assert.match(src, /growFrameRef/)
    assert.doesNotMatch(
      src,
      /growFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?startTransition/,
    )
    assert.match(src, /storyColumnShift/)
    assert.match(src, /railTrackScroll/)
    assert.match(src, /railLeadColumn/)
    assert.match(src, /nudge\(/)
    assert.doesNotMatch(src, /pendingExpandRef\.current = dir/)
    assert.doesNotMatch(src, /const flushPendingExpand =/)
    assert.doesNotMatch(src, /if \(expandDir\) expandRef/)
    assert.doesNotMatch(src, /let expandDir:/)
    assert.match(
      src,
      /paintStoryAway\(itemsTrackRef.current, ideal.from, ideal.to, prevBand, false\)/,
    )
    assert.match(src, /liveToRef.current = padTo\n      setLive\(padTo\)\n      setMount\(next\)/)
    assert.doesNotMatch(src, /liveToRef.current = cap/)
    assert.match(src, /storySlotAtColumn/)
    assert.match(src, /storyColumnLeads/)
    assert.match(src, /colLeadSlotsRef\.current !== storySlots/)
    assert.doesNotMatch(src, /storySlotsRef\.current\.find/)
    assert.match(src, /'.phantasi-story',\n {4}undefined/)
    assert.doesNotMatch(src, /onStoryLead/)
    assert.doesNotMatch(
      src,
      /onStoryLead = useCallback\(\(id: number\) => \{[\s\S]*?expandRef\.current/,
    )
    assert.match(src, /lastSiteViewWRef/)
    assert.match(src, /siteCardsRef\.current\.length === 0/)
    assert.match(src, /siteCardsMissRef/)
    assert.match(src, /sites\.cards\(viewChanged\)/)
    assert.match(src, /const PhantasiFeedsSites = memo\(/)
    assert.match(src, /const PhantasiFeedsStories = memo\(/)
    assert.match(src, /storySetMountRef/)
    assert.match(src, /slotCacheRef/)
    assert.match(src, /colCacheRef/)
    assert.doesNotMatch(src, /reusePaintedSlots/)
    assert.doesNotMatch(src, /extendPaintedSlots/)
    assert.match(src, /extendPaintedRange/)
    assert.match(src, /clipPaintedBatches/)
    assert.match(src, /paintedBatchesRef/)
    assert.match(src, /warmStoryFaces\(pack, times, locale, labels, !covers\)/)
    assert.match(src, /warmStoryCovers/)
    assert.match(pan, /createDocumentFragment/)
    assert.match(src, /prevByCol\.get\(col\) !== byCol\.get\(col\)/)
    assert.doesNotMatch(
      src,
      /paintedByColRef\.current !== byCol\n {6}\|\| face\.times/,
    )
    assert.match(src, /closest\('\.phantasi-story__hit'\)/)
    assert.match(src, /closest\('\.phantasi-story__star'\)/)
    assert.match(src, /storyAtRailTarget/)
    assert.match(src, /canStar=\{canStar\}/)
    assert.match(src, /ideal\.to \+ RAIL_MOUNT_GROW_AHEAD/)
    assert.match(src, /grabbingRef=\{grabbingRef\}/)
    assert.match(src, /if \(grabbingRef\.current\) return\n {6}const mounted/)
    assert.match(src, /mounted.to > bootTo \+ RAIL_MOUNT_LIVE_PAD/)
    assert.doesNotMatch(src, /mounted.to === eagerBandRef.current.to/)
    assert.match(src, /prebuiltColsRef/)
    assert.match(src, /if \(reset\) prebuiltColsRef\.current\.clear\(\)/)
    assert.match(src, /prebuilt\.delete\(col\)/)
    assert.match(src, /RAIL_MOUNT_LIVE_PAD \+ RAIL_MOUNT_RESERVE/)
    assert.match(src, /railLiveTo/)
    assert.match(src, /setLiveRef/)
    assert.match(src, /liveToRef/)
    assert.match(src, /paintLive/)
    assert.match(pan, /RAIL_MOUNT_LIVE_PAD/)
    assert.match(pan, /export function railLiveTo/)
    assert.match(pan, /indexStoryCols/)
    assert.match(pan, /wantStoryCols/)
    assert.match(pan, /for \(let i = kids\.length - 1; i >= 0; i--\)/)
    assert.match(pan, /for \(let i = kids\.length - 1; i >= 0; i--\)/)
    assert.match(src, /ideal.to \+ RAIL_MOUNT_RESERVE > liveToRef/)
    assert.doesNotMatch(src, /liveToRef\.current \+ 1/)
    assert.match(src, /paintStoryLiveCols/)
    assert.match(src, /const fillGrabLive =/)
    assert.match(src, /Math.min\(to, eagerBandRef.current.to\)/)
    assert.match(src, /if \(from > paintTo\) return/)
    assert.match(
      src,
      /ensureStoryShells\(\n {6}itemsTrackRef.current,\n {6}from,\n {6}paintTo,/,
    )
    assert.match(src, /fillGrabLive\(prevBand.to \+ 1, ideal.to\)/)
    assert.match(src, /recycleStoryDomShellsOutside/)
    assert.match(
      src,
      /recycleStoryDomShellsOutside\(\n {12}itemsTrackRef.current,\n {12}ideal.from,\n {12}ideal.to,\n {10}\)\n {10}if \(ideal.to > prevBand.to\)/,
    )
    assert.match(
      readFileSync(join(dir, 'storyFace.ts'), 'utf8'),
      /primeStoryCardTemplate/,
    )
    assert.match(pan, /cloneStoryCardInner/)
    assert.match(pan, /export function recycleStoryDomShellsOutside/)
    assert.match(pan, /shellPool/)
    assert.match(pan, /grabShellsByTrack/)
    assert.match(src, /if \(grabbingRef.current\) \{\n {10}fillGrabLive/)
    assert.match(pan, /export function paintStoryLiveCols/)
    assert.match(pan, /forceDefer \|\| hold/)
    assert.match(
      src,
      /railLiveTo\(\n {10}ideal.to,\n {10}mountColsRef.current.to,\n {10}liveToRef.current/,
    )
    assert.match(src, /storySlotsByColumn/)
    assert.match(src, /const alignId = pendingStoryAlignRef/)
    assert.doesNotMatch(
      src,
      /mountCols\.from, mountCols\.to, pendingStoryAlignRef/,
    )
    assert.match(src, /paintedCacheRef/)
    assert.match(src, /PaintedRailHead/)
    assert.match(src, /paintedOutRef/)
    assert.match(src, /key=\{`\$\{prevRange\.to\}:\$\{paintTo\}`\}/)
    assert.match(src, /key=\{`shell:\$\{paintTo\}`\}/)
    assert.match(src, /batch\.from > prevLive/)
    assert.match(src, /batch\.to > prevLive/)
    assert.match(src, /grew && leftoverShells/)
    assert.doesNotMatch(src, /splitGrowLiveRef/)
    assert.doesNotMatch(src, /grabFillFromRef/)
    assert.doesNotMatch(src, /if \(growReact && !growFrameRef.current\)/)
    assert.doesNotMatch(
      src.slice(
        src.indexOf('const onStoryScroll'),
        src.indexOf('const onSiteScroll'),
      ),
      /startTransition/,
    )
    assert.match(src, /ensureStoryShells/)
    assert.match(src, /paintStoryLiveCols/)
    assert.match(
      src,
      /paint.canStar,\n {6}true,/,
    )
    assert.match(pan, /export function ensureStoryShells/)
    assert.match(pan, /export function railCardOffset/)
    assert.match(pan, /if \(to - from <= 0.5\) return followStops\[i\] \?\? 0/)
    assert.doesNotMatch(
      pan.slice(
        pan.indexOf('function followRailAt'),
        pan.indexOf('export function followRailScroll'),
      ),
      /followStops\[i \+ 1\] \?\? followStops\[i\]/,
    )
    assert.match(pan, /export function dropStoryDomShells/)
    assert.match(src, /if \(!covers\) return/)
    assert.doesNotMatch(src, /pendingAwayRef/)
    assert.doesNotMatch(src, /coverFrameRef/)
    assert.doesNotMatch(src, /pendingEagerRef/)
    assert.doesNotMatch(src, /const armCovers =/)
    assert.doesNotMatch(src, /const flushAway =/)
    assert.match(
      src,
      /paintStoryAway\(\n {10}itemsTrackRef.current,\n {10}ideal.from,\n {10}ideal.to,\n {10}prevBand,\n {10}!grabbingRef.current/,
    )
    assert.match(pan, /awayDeltaCols/)
    assert.match(pan, /eagerDeltaCols/)
    assert.match(
      src,
      /if \(!syncMount\) \{\n {6}eagerStoryCovers\(itemsTrackRef\.current, ideal\.from, ideal\.to, prevBand\)/,
    )
    assert.match(src, /paintedByColRef/)
    assert.match(src, /paintedFaceRef/)
    assert.match(src, /paintedElRef/)
    assert.match(src, /storyMountWindow/)
    assert.match(src, /storyRailTrackSize/)
    assert.doesNotMatch(src, /storyMountGridColumn/)
    assert.match(src, /col=\{col\}/)
    assert.doesNotMatch(src, /phantasi-feeds__story-pad/)
    assert.match(src, /onStoryMediaError/)
    assert.match(src, /eagerStoryCovers/)
    assert.match(src, /paintStoryAway/)
    assert.match(src, /lastEagerRef/)
    assert.match(src, /storyWarmRef/)
    assert.match(src, /warmRef=\{storyWarmRef\}/)
    assert.match(src, /if \(grabbingRef\.current\) \{\n {10}mountColsRef\.current = grown\n {10}reactMountStaleRef.current = true/)
    assert.match(src, /fillGrabLive\(prevLive \+ 1, liveToRef\.current\)/)
    assert.match(src, /fillGrabLive\(prevLive \+ 1, nextLive\)/)
    assert.doesNotMatch(
      src,
      /fillGrabLive\(prevLive \+ 1, liveToRef\.current\)\n {10}storyWarmRef/,
    )
    assert.doesNotMatch(
      src,
      /fillGrabLive\(prevLive \+ 1, nextLive\)\n {12}storyWarmRef/,
    )
    assert.match(src, /storyByColRef/)
    assert.match(src, /storySlotsByColumn\(storySlots, storyByColRef\.current\)/)
    assert.match(src, /reactMountStaleRef.current = true/)
    assert.match(src, /eagerBandRef/)
    assert.match(src, /prevBand/)
    assert.match(src, /paintedEagerRef/)
    assert.match(src, /rebuildFollowStops/)
    assert.match(src, /followHintRef/)
    assert.match(src, /siteIndexRef/)
    assert.match(src, /siteIndexCardsRef\.current !== siteCards/)
    assert.match(src, /useEffect\(\(\) => \{\s*const band = eagerBandRef/)
    assert.doesNotMatch(
      src,
      /useLayoutEffect\(\(\) => \{\s*const band = eagerBandRef/,
    )
    assert.doesNotMatch(src, /\beagerCover\b/)
    assert.match(src, /holdCover = col > eagerBand\.to \|\| col > eagerTo/)
    assert.match(src, /holdCover=\{col > eagerBand\.to \|\| col > eagerTo\}/)
    assert.doesNotMatch(src, /col < eagerBand\.from/)
    assert.match(src, /<PhantasiStoryColumn/)
    assert.doesNotMatch(src, /<PhantasiStory[\s>]/)
    assert.match(src, /eagerBandRef\.current = ideal/)
    assert.match(src, /export default memo\(PhantasiFeeds\)/)
    const story = readFileSync(join(dir, 'PhantasiStory.tsx'), 'utf8')
    assert.match(story, /storyCardFace/)
    assert.match(story, /storyCardInnerHtml/)
    assert.match(story, /holdCover=\{holdCover\}/)
    assert.doesNotMatch(story, /watchStoryCover/)
    assert.match(story, /if \(slots.length === 0\) return null/)
    assert.doesNotMatch(story, /\bshell\b/)
    assert.match(story, /export const PhantasiStoryColumn/)
    assert.match(story, /prev\.col === next\.col/)
    const columnMemo = story.slice(story.lastIndexOf('prev.col === next.col'))
    assert.doesNotMatch(columnMemo, /holdCover/)
    assert.match(story, /railCol=\{slot\.column\}/)
    assert.doesNotMatch(story, /railCol=\{col\}/)
    assert.match(story, /key=\{`\$\{col\}:\$\{slot.row\}`\}/)
    assert.doesNotMatch(story, /key=\{`\$\{col\}:1`\}/)
    assert.doesNotMatch(story, /key=\{`\$\{col\}:2`\}/)
    const card = readFileSync(join(dir, '../ui/StoryCard.tsx'), 'utf8')
    assert.match(card, /loading=\{eagerCover \? 'eager' : 'lazy'\}/)
    assert.match(card, /position: 'absolute'/)
    assert.match(card, /height: 'var\(--phantasi-story-h\)'/)
    assert.match(card, /holdCover/)
    assert.match(card, /data-src/)
    assert.match(card, /deferCover \? null/)
    assert.match(card, /is-hold/)
    assert.match(card, /phantasi-story--slot/)
    assert.match(card, /dangerouslySetInnerHTML/)
    assert.match(card, /phantasi-float phantasi-story__hit phantasi-story__shell/)
    assert.match(card, /<button\n {6}ref=\{ref\}\n {6}type="button"/)
    assert.doesNotMatch(card, /phantasi-story__foot/)
    assert.doesNotMatch(card, /phantasi-story__body/)
    assert.match(card, /hideBrokenStoryCover/)
    assert.match(card, /storyCardClass/)
    assert.doesNotMatch(card, /LuStar/)
    assert.match(pan, /eagerStorySrc/)
    assert.match(pan, /mountHeldStoryImg/)
    assert.match(pan, /data-src/)
    assert.match(pan, /classList\?\.contains\('phantasi-story--slot'\)/)
    assert.match(pan, /const eagerStories = new WeakSet/)
    assert.match(pan, /export function onStoryMediaError/)
    assert.match(pan, /classList\?\.remove\('is-hold'\)/)
    assert.match(pan, /if \(!away\) story\.classList\?\.remove\('is-hold'\)/)
    assert.match(pan, /watchStoryCover/)
    assert.match(pan, /wakeStoryCovers/)
  })

  it('文章轨虚拟化样式不依赖展开宫格', () => {
    const css = readFileSync(join(dir, '../ui/css/cards.css'), 'utf8')
    assert.match(css, /\.phantasi-story--slot \{\n {2}pointer-events: none;\n {2}contain: strict;/)
    assert.match(css, /\.phantasi-skin button\.phantasi-story--slot/)
    assert.match(
      css,
      /\.phantasi-story\.is-hold \{\n {2}content-visibility: hidden;\n {2}contain-intrinsic-size: auto var\(--phantasi-story-h\);\n {2}contain: strict;/,
    )
    assert.match(
      css,
      /\.phantasi-story\.is-away \{\n {2}content-visibility: hidden;\n {2}contain-intrinsic-size: auto var\(--phantasi-story-h\);\n {2}contain: strict;/,
    )
    assert.match(css, /grid-template:/)
    assert.doesNotMatch(css, /\.phantasi-story__foot/)
    assert.doesNotMatch(css, /is-sites-open/)
    const feedsCss = readFileSync(join(dir, '../ui/css/feeds.css'), 'utf8')
    assert.match(
      feedsCss,
      /\.phantasi-feeds\.is-rail-grabbing \.phantasi-story/,
    )
    assert.match(
      feedsCss,
      /\.phantasi-feeds\.is-rail-grabbing \.phantasi-site/,
    )
    assert.match(
      feedsCss,
      /\.phantasi-feeds\.is-rail-grabbing \.phantasi-story,\n\.phantasi-feeds\.is-rail-grabbing \.phantasi-site \{\n {2}pointer-events: none;\n {2}transition: none;/,
    )
    assert.match(
      feedsCss,
      /\.phantasi-feeds\.is-rail-grabbing \.phantasi-feeds__items-track,\n\.phantasi-feeds\.is-rail-grabbing \.phantasi-feeds__sites-track \{\n {2}contain: layout style;\n {2}will-change: transform;/,
    )
    assert.doesNotMatch(
      feedsCss,
      /\.phantasi-feeds\.is-rail-grabbing \.phantasi-story \{\n {2}transform: none;/,
    )
    assert.match(feedsCss, /is-rail-panning/)
    assert.match(feedsCss, /overscroll-behavior: none/)
    assert.match(css, /is-rail-panning/)
    assert.match(css, /overscroll-behavior: none/)
  })

  it('最新聚合卡用 mix 语气，叠卡跟源走，不铺渐变底', () => {
    const src = feedsSrc()
    const card = readFileSync(join(dir, '../ui/SiteCard.tsx'), 'utf8')
    const css = readFileSync(join(dir, '../ui/css/cards.css'), 'utf8')
    assert.match(src, /tone="mix"/)
    assert.match(src, /stack=\{inbox\.stack\}/)
    assert.match(src, /latestFeedStackFaces/)
    assert.doesNotMatch(src, /unread=\{inbox\.unread\}/)
    assert.match(css, /\.phantasi-site\.is-mix \.phantasi-site__article/)
    assert.match(css, /\.phantasi-site\.is-mix \.phantasi-site__when/)
    assert.match(card, /tone === 'mix' && 'is-mix'/)
    assert.match(card, /phantasi-site__stack-face/)
    assert.match(card, /phantasi-site__stack-deck/)
    assert.match(css, /\.phantasi-site__stack \{[\s\S]*?align-items: center/)
    assert.match(
      css,
      /\.phantasi-site__stack-face img \{[\s\S]*?object-fit: cover/,
    )
    assert.match(card, /turnStackSlot/)
    assert.match(card, /live=\{\!\!on\}/)
    assert.match(card, /roster/)
    assert.doesNotMatch(src, /cover=\{/)
    assert.match(card, /slot: 'tuck'/)
    assert.match(css, /\.phantasi-site__stack-face\.is-tuck/)
    assert.match(css, /--stack-scale/)
    assert.doesNotMatch(card, /setInterval/)
    assert.doesNotMatch(css, /\.phantasi-site\.is-mix \{[\s\S]*?linear-gradient/)
    assert.doesNotMatch(css, /@keyframes phantasi-site-stack-live/)
    assert.doesNotMatch(css, /@keyframes phantasi-site-stack-swap/)
    assert.match(css, /\.phantasi-site__stack-face\.is-front/)
    assert.match(
      css,
      /\.phantasi-site__stack-face \{[\s\S]*?transition:/,
    )
    assert.match(
      css,
      /prefers-reduced-motion: reduce[\s\S]*phantasi-site__stack-face/,
    )
  })
})
