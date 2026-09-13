import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('brew feeds 开合 class 链', () => {
  it('morphing 必须在 React className 里，重绘才能保住藏活卡', () => {
    const src = readFileSync(join(dir, 'BrewFeeds.tsx'), 'utf8')
    assert.match(src, /morphing \? ' is-sites-morphing'/)
  })

  it('滚文章过源先点网站卡，停稳再写 focus / jump，避免整轨重绘', () => {
    const src = readFileSync(join(dir, 'BrewFeeds.tsx'), 'utf8')
    assert.match(src, /function paintSiteOn/)
    assert.match(src, /function indexSiteOnEls/)
    assert.match(src, /siteElsRef/)
    assert.match(src, /FOCUS_FOLLOW_MS/)
    assert.match(src, /paintSiteOn\(\n {10}sitesTrackRef.current/)
    assert.doesNotMatch(
      src,
      /useLayoutEffect\(\(\) => \{\s*paintSiteOn/,
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
    assert.match(src, /lead\?\.story\.source_id/)
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
    assert.match(
      src,
      /pendingFlushRef.current = false\n {4}dropStoryDomShells\(itemsTrackRef.current\)/,
    )
    assert.match(src, /pendingFlushRef/)
    assert.match(src, /pendingFlushRef\.current = true/)
    assert.match(src, /if \(pendingFlushRef\.current\) flushStorySettle/)
    assert.match(src, /id !== focusIdRef\.current/)
    assert.match(src, /startTransition/)
    assert.match(src, /settleId/)
    assert.match(src, /railMountColumnsSettle/)
    assert.match(src, /true,\n {4}onStoryScroll/)
    assert.match(src, /true,\n {4}undefined,\n {4}onSiteGrab/)
    assert.match(src, /grabbingRef/)
    assert.match(src, /if \(grabbingRef\.current\) return/)
    assert.match(src, /dropPeek/)
    assert.match(src, /is-rail-grabbing/)
    assert.match(src, /paintGrabbing/)
    assert.match(src, /paintFollowLayer/)
    assert.match(src, /willChange = on \? 'transform'/)
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
      /const onStoryIdle = useCallback\(\(\) => \{\n {4}if \(focusTimerRef.current\) window.clearTimeout\(focusTimerRef.current\)\n {4}paintGrabbing\(false\)\n {4}paintFollowLayer\(false\)\n {4}flushStorySettle\(\)/,
    )
    assert.match(src, /const releaseAndWarm =/)
    assert.match(src, /requestIdleCallback\(releaseAndWarm\)/)
    assert.match(src, /reactMountStaleRef/)
    assert.match(src, /const syncMount = mountChanged \|\| stale/)
    assert.match(src, /if \(syncMount\) storySetMountRef.current\(mountColsRef.current\)/)
    assert.match(src, /onSiteIdle/)
    assert.match(src, /holdStoriesRef\.current/)
    assert.match(src, /releaseStoriesRef\.current/)
    assert.doesNotMatch(src, /itemsApiRef\.current\?\.refresh\(\)/)
    assert.match(src, /growFrameRef/)
    assert.match(
      src,
      /growFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?startTransition/,
    )
    assert.match(src, /storyColumnShift/)
    assert.match(src, /railTrackScroll/)
    assert.match(src, /railLeadColumn/)
    assert.match(src, /nudge\(/)
    assert.match(src, /pendingExpandRef\.current = dir/)
    assert.match(src, /storySlotAtColumn/)
    assert.match(src, /storyColumnLeads/)
    assert.match(src, /colLeadSlotsRef\.current !== storySlots/)
    assert.doesNotMatch(src, /storySlotsRef\.current\.find/)
    assert.match(src, /'.brew-story',\n {4}undefined/)
    assert.doesNotMatch(src, /onStoryLead/)
    assert.doesNotMatch(
      src,
      /onStoryLead = useCallback\(\(id: number\) => \{[\s\S]*?expandRef\.current/,
    )
    assert.match(src, /lastSiteViewWRef/)
    assert.match(src, /siteCardsRef\.current\.length === 0/)
    assert.match(src, /siteCardsMissRef/)
    assert.match(src, /sites\.cards\(viewChanged\)/)
    assert.match(src, /const BrewFeedsSites = memo\(/)
    assert.match(src, /const BrewFeedsStories = memo\(/)
    assert.match(src, /storySetMountRef/)
    assert.match(src, /slotCacheRef/)
    assert.match(src, /colCacheRef/)
    assert.doesNotMatch(src, /reusePaintedSlots/)
    assert.doesNotMatch(src, /extendPaintedSlots/)
    assert.match(src, /extendPaintedRange/)
    assert.match(src, /clipPaintedBatches/)
    assert.match(src, /paintedBatchesRef/)
    assert.match(src, /warmStoryFaces/)
    assert.match(src, /warmStoryCovers/)
    assert.match(src, /prevByCol\.get\(col\) !== byCol\.get\(col\)/)
    assert.doesNotMatch(
      src,
      /paintedByColRef\.current !== byCol\n {6}\|\| face\.times/,
    )
    assert.match(src, /closest\('\.brew-story__hit'\)/)
    assert.match(src, /closest\('\.brew-story__star'\)/)
    assert.match(src, /storyAtRailTarget/)
    assert.match(src, /canStar=\{canStar\}/)
    assert.match(src, /eagerBandRef\.current\.to \+ RAIL_MOUNT_GROW_AHEAD/)
    assert.match(src, /grabbingRef=\{grabbingRef\}/)
    assert.match(src, /if \(grabbingRef\.current\) return\n {6}const mounted/)
    assert.match(src, /mounted.to <= bootTo \+ RAIL_MOUNT_LIVE_PAD/)
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
    const growArm = src.slice(
      src.indexOf('const armCovers ='),
      src.indexOf('if (railDriverRef.current === \'sites\')'),
    )
    assert.match(growArm, /startTransition/)
    assert.match(src, /if \(growReact && !growFrameRef.current\)/)
    assert.match(src, /ensureStoryShells/)
    assert.match(src, /paintStoryLiveCols/)
    assert.match(
      src,
      /paint.canStar,\n {10}true,/,
    )
    assert.match(pan, /export function ensureStoryShells/)
    assert.match(pan, /export function dropStoryDomShells/)
    assert.doesNotMatch(
      growArm.slice(
        growArm.indexOf('growFrameRef.current = window.requestAnimationFrame'),
        growArm.indexOf('startTransition'),
      ),
      /eagerStoryCovers/,
    )
    assert.match(growArm, /if \(!next \|\| grabbingRef.current\) return/)
    assert.match(growArm, /coverFrameRef.current \|\| !pendingEagerRef.current/)
    assert.match(growArm, /flushAway\(\)/)
    assert.match(src, /const flushAway =/)
    assert.match(src, /if \(!covers\) return/)
    assert.match(src, /pendingAwayRef/)
    assert.match(
      src,
      /paintStoryAway\(\n {10}itemsTrackRef.current,\n {10}ideal.from,\n {10}ideal.to,\n {10}prevBand,\n {10}!grabbingRef.current/,
    )
    assert.match(pan, /awayDeltaCols/)
    assert.match(pan, /eagerDeltaCols/)
    assert.match(
      src,
      /eagerStoryCovers\(itemsTrackRef\.current, ideal\.from, ideal\.to, prevBand\)/,
    )
    assert.match(src, /paintedByColRef/)
    assert.match(src, /paintedFaceRef/)
    assert.match(src, /paintedElRef/)
    assert.match(src, /storyMountWindow/)
    assert.match(src, /storyRailTrackSize/)
    assert.doesNotMatch(src, /storyMountGridColumn/)
    assert.match(src, /col=\{col\}/)
    assert.doesNotMatch(src, /brew-feeds__story-pad/)
    assert.match(src, /onStoryMediaError/)
    assert.match(src, /eagerStoryCovers/)
    assert.match(src, /paintStoryAway/)
    assert.match(src, /coverFrameRef/)
    assert.match(src, /cancelAnimationFrame\(coverFrameRef/)
    assert.match(src, /pendingEagerRef/)
    assert.match(src, /lastEagerRef/)
    assert.match(src, /storyWarmRef/)
    assert.match(src, /warmRef=\{storyWarmRef\}/)
    assert.match(src, /if \(grabbingRef\.current\) \{\n {10}mountColsRef\.current = grown\n {10}storyWarmRef\.current\(\)/)
    assert.match(src, /if \(grabbingRef\.current\) storyWarmRef\.current\(\)/)
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
    assert.match(src, /holdCover=\{col > eagerBand\.to\}/)
    assert.doesNotMatch(src, /col < eagerBand\.from/)
    assert.match(src, /<BrewStoryColumn/)
    assert.doesNotMatch(src, /<BrewStory[\s>]/)
    assert.match(src, /eagerBandRef\.current = ideal/)
    assert.match(src, /export default memo\(BrewFeeds\)/)
    const story = readFileSync(join(dir, 'BrewStory.tsx'), 'utf8')
    assert.match(story, /storyCardFace/)
    assert.match(story, /storyCardInnerHtml/)
    assert.match(story, /holdCover=\{holdCover\}/)
    assert.doesNotMatch(story, /watchStoryCover/)
    assert.match(story, /\bshell\b/)
    assert.match(story, /export const BrewStoryColumn/)
    assert.match(story, /prev\.col === next\.col/)
    const columnMemo = story.slice(story.lastIndexOf('prev.col === next.col'))
    assert.doesNotMatch(columnMemo, /holdCover/)
    assert.match(story, /railCol=\{slot\.column\}/)
    assert.match(story, /railCol=\{col\}/)
    assert.match(story, /key=\{`\$\{col\}:\$\{slot.row\}`\}/)
    assert.match(story, /key=\{`\$\{col\}:1`\}/)
    assert.match(story, /key=\{`\$\{col\}:2`\}/)
    const card = readFileSync(join(dir, '../ui/StoryCard.tsx'), 'utf8')
    assert.match(card, /loading=\{eagerCover \? 'eager' : 'lazy'\}/)
    assert.match(card, /position: 'absolute'/)
    assert.match(card, /holdCover/)
    assert.match(card, /data-src/)
    assert.match(card, /deferCover \? null/)
    assert.match(card, /is-hold/)
    assert.match(card, /brew-story--slot/)
    assert.match(card, /dangerouslySetInnerHTML/)
    assert.match(card, /brew-float brew-story__hit brew-story__shell/)
    assert.match(card, /<button\n {6}ref=\{ref\}\n {6}type="button"/)
    assert.doesNotMatch(card, /brew-story__foot/)
    assert.doesNotMatch(card, /brew-story__body/)
    assert.match(card, /hideBrokenStoryCover/)
    assert.match(card, /storyCardClass/)
    assert.doesNotMatch(card, /LuStar/)
    assert.match(pan, /eagerStorySrc/)
    assert.match(pan, /mountHeldStoryImg/)
    assert.match(pan, /data-src/)
    assert.match(pan, /classList\?\.contains\('brew-story--slot'\)/)
    assert.match(pan, /const eagerStories = new WeakSet/)
    assert.match(pan, /export function onStoryMediaError/)
    assert.match(pan, /classList\?\.remove\('is-hold'\)/)
    assert.match(pan, /if \(!away\) story\.classList\?\.remove\('is-hold'\)/)
    assert.match(pan, /watchStoryCover/)
    assert.match(pan, /wakeStoryCovers/)
  })

  it('文章区收拢只在开合落定后，morphing 时不 !important 压死 chrome', () => {
    const css = readFileSync(join(dir, '../ui/css/cards.css'), 'utf8')
    assert.match(css, /\.brew-story--slot \{\n {2}pointer-events: none;\n {2}contain: strict;/)
    assert.match(css, /\.brew-skin button\.brew-story--slot/)
    assert.match(
      css,
      /\.brew-story\.is-hold \{\n {2}content-visibility: hidden;\n {2}contain-intrinsic-size: auto var\(--brew-story-h\);\n {2}contain: strict;/,
    )
    assert.match(
      css,
      /\.brew-story\.is-away \{\n {2}content-visibility: hidden;\n {2}contain-intrinsic-size: auto var\(--brew-story-h\);\n {2}contain: strict;/,
    )
    assert.match(css, /grid-template:/)
    assert.doesNotMatch(css, /\.brew-story__foot/)
    assert.match(
      css,
      /\.brew-feeds\.is-sites-open:not\(\.is-sites-morphing\) \.brew-feeds__items/,
    )
    const feedsCss = readFileSync(join(dir, '../ui/css/feeds.css'), 'utf8')
    assert.match(
      feedsCss,
      /\.brew-feeds\.is-rail-grabbing \.brew-story/,
    )
    assert.match(
      feedsCss,
      /\.brew-feeds\.is-rail-grabbing \.brew-site/,
    )
    assert.match(
      feedsCss,
      /\.brew-feeds\.is-rail-grabbing \.brew-story,\n\.brew-feeds\.is-rail-grabbing \.brew-site \{\n {2}pointer-events: none;\n {2}transition: none;/,
    )
    assert.match(
      feedsCss,
      /\.brew-feeds\.is-rail-grabbing \.brew-feeds__items-track \{\n {2}contain: layout style paint;/,
    )
  })
})
