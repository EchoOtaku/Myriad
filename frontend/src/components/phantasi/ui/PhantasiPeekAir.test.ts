import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('PhantasiPeekAir', () => {
  it('封面 peek 换全局背景，叠标题和站点，进出有过渡和渐变', () => {
    const air = readFileSync(join(dir, 'PhantasiPeekAir.tsx'), 'utf8')
    const tokens = readFileSync(join(dir, 'css/tokens.css'), 'utf8')
    const motion = readFileSync(join(dir, 'css/motion.css'), 'utf8')
    const cards = readFileSync(join(dir, 'css/cards.css'), 'utf8')
    const page = readFileSync(join(dir, '../../../views/Phantasi.tsx'), 'utf8')
    const feeds =
      readFileSync(join(dir, '../skin/PhantasiFeeds.tsx'), 'utf8') +
      readFileSync(join(dir, '../skin/PhantasiFeedsStories.tsx'), 'utf8')
    assert.match(air, /createPortal/)
    assert.match(air, /bg-container/)
    assert.match(air, /PHANTASI_PEEK_EXIT_MS/)
    assert.match(air, /phantasi-peek-air__shot/)
    assert.match(air, /phantasi-peek-air__title/)
    assert.match(air, /phantasi-peek-air__site/)
    assert.match(air, /PHANTASI_PEEK_COPY_ID/)
    assert.match(air, /toPhantasiPeekFace/)
    assert.match(page, /<PhantasiPeekAir face=\{peekFace\} \/>/)
    assert.match(page, /toPhantasiPeekFace\(item, storySourceFace\(item\)\)/)
    assert.match(page, /handlePeekEnd/)
    assert.match(page, /<PhantasiFilterLane[\s\S]*onPeekItem=\{handlePeekItem\}/)
    assert.match(page, /<PhantasiFilterLane[\s\S]*onPeekEnd=\{handlePeekEnd\}/)
    const filter = readFileSync(join(dir, '../PhantasiFilterLane.tsx'), 'utf8')
    const list = readFileSync(join(dir, '../skin/PhantasiList.tsx'), 'utf8')
    assert.match(filter, /onPeekItem=\{starredMode\?\.isEditMode \? undefined : onPeekItem\}/)
    assert.match(list, /usePhantasiPeekLane/)
    assert.match(page, /item\.selectedItem \|\| notes\.noteEditor/)
    assert.doesNotMatch(feeds, /cover=\{.*scene/)
    assert.doesNotMatch(feeds, /hoverStoryId/)
    assert.match(tokens, /\.phantasi-peek-air__shot\.is-on/)
    assert.match(tokens, /\.phantasi-peek-air::after/)
    assert.match(tokens, /html\.dark \.phantasi-peek-air::after/)
    assert.match(tokens, /\.phantasi-peek-air__lede\.is-on/)
    assert.match(tokens, /\.phantasi-peek-air__title/)
    assert.match(tokens, /--page-max-width/)
    assert.match(tokens, /--page-pad-x/)
    const frame = readFileSync(join(dir, '../../../styles/page-frame.css'), 'utf8')
    assert.match(frame, /#phantasi-peek-copy/)
    assert.match(motion, /prefers-reduced-motion: reduce[\s\S]*phantasi-peek-air/)
    assert.match(motion, /prefers-reduced-motion: reduce[\s\S]*phantasi-peek-air__lede/)
    assert.match(cards, /\.phantasi-story__peek/)
    assert.match(cards, /\.phantasi-story\.has-cover\.has-peek \.phantasi-story__peek \{[\s\S]*?position: absolute;/)
    assert.match(
      cards,
      /\.phantasi-story\.has-cover\.has-peek\.is-peek:not\(\.is-picking\) \.phantasi-story__peek/,
    )
    assert.match(cards, /@media \(hover: hover\) and \(pointer: fine\)/)
    assert.doesNotMatch(
      cards,
      /\.phantasi-story\.has-cover\.has-peek:is\(:hover, :focus-visible, \.is-peek\)/,
    )
    assert.match(cards, /\.phantasi-story\.has-cover\.has-peek \.phantasi-story__peek \{[\s\S]*?font-size: 0\.75rem;/)
    assert.match(cards, /height: var\(--phantasi-story-h\)/)
    assert.doesNotMatch(cards, /interpolate-size/)
    assert.doesNotMatch(cards, /:has\(\.phantasi-story__peek\)/)
    assert.doesNotMatch(
      cards,
      /\.phantasi-story(?:\.has-cover)?:is\(:hover[\s\S]{0,180}?height:\s*auto/,
    )
    assert.doesNotMatch(
      cards,
      /\.phantasi-story\.has-cover\.has-peek:is\(:hover[\s\S]{0,220}?max-height: 0/,
    )
    assert.doesNotMatch(
      cards,
      /\.phantasi-story\.has-cover\.has-peek:is\(:hover[\s\S]{0,280}?height: 0;/,
    )
    assert.doesNotMatch(air, /if \(!ready\) return/)
    assert.doesNotMatch(air, /setCopyOn/)
    assert.match(air, /setLayers/)
    assert.match(air, /is-swap/)
    assert.match(air, /PHANTASI_PEEK_HANDOFF_MS/)
    assert.match(tokens, /scale\(1\.03\)/)
    assert.match(tokens, /\.phantasi-peek-air\.is-swap/)
    assert.match(page, /setPeekFace\(\(prev\) => \(samePeekFace\(prev, next\) \? prev : next\)\)/)
    assert.match(page, /dropPeekSession/)
    assert.match(page, /schedulePhantasiPeekResume/)
    assert.match(page, /onDisplayed=\{resumePeekAfterLane\}/)
    assert.match(page, /peekLaneIsSwapping/)
    assert.match(page, /settlePeekSession/)
    assert.match(page, /peekPointerWantsAir/)
    assert.match(page, /peekGoesToNav/)
    assert.match(page, /pointerdown/)
    assert.doesNotMatch(air, /if \(quiet \|\| phantasiMotionBusy\(\)\)/)
    assert.match(air, /samePeekFace/)
    assert.match(page, /onPhantasiMotion/)
    assert.match(page, /holdPhantasiPeekSwap/)
    assert.match(page, /phantasiPeekHeldForSwap/)
    const chip = readFileSync(join(dir, 'Chip.tsx'), 'utf8')
    assert.match(chip, /holdPhantasiPeekSwap\(wait \+ 240\)/)
    assert.match(page, /scheduleIdleTask/)
    assert.match(page, /cancelIdleTask/)
    assert.match(page, /phantasiMotionBusy/)
    assert.match(page, /visibilitychange/)
    assert.match(page, /pagehide/)
    assert.doesNotMatch(page, /documentElement\.addEventListener\('pointerleave'/)
    assert.doesNotMatch(
      page,
      /dropPeekSession\(\)\n  \}, \[dropPeekSession, route\.board, route\.viewMode\]/,
    )
    assert.doesNotMatch(feeds, /event\.currentTarget\.contains\(to\)/)
    assert.match(feeds, /usePhantasiPeekLane/)
    assert.match(feeds, /clearPhantasiStoryPeeks\(itemsTrackRef\.current\)/)
    assert.match(cards, /--phantasi-peek-fade/)
    const storyCard = readFileSync(join(dir, 'StoryCard.tsx'), 'utf8')
    const face = readFileSync(join(dir, '../skin/storyFace.ts'), 'utf8')
    assert.match(storyCard, /phantasi-story__peek/)
    assert.match(storyCard, /has-peek/)
    assert.match(face, /phantasi-story__peek/)
    assert.match(air, /phantasiMotionClaim\('peek'\)/)
    assert.match(air, /whenPhantasiPeekReady/)
    assert.match(air, /whenPhantasiMotionIdle/)
    assert.match(air, /onPhantasiMotion/)
    assert.match(air, /scheduleTask/)
    assert.match(air, /batchWrite/)
    assert.match(air, /from ['"]\.\.\/\.\.\/\.\.\/hooks\/animation['"]/)
    assert.match(air, /afterPaint/)
    assert.doesNotMatch(
      cards,
      /\.phantasi-story:is\(:hover, :focus-visible, \.is-peek\):not\(\.is-picking, \.phantasi-story--slot\) \{\n {2}z-index: 8;/,
    )
    assert.doesNotMatch(
      cards,
      /\.phantasi-story__hit:is\(:hover, :focus-visible, \.is-peek\):not\(\.is-picking\) \.phantasi-story__summary/,
    )
    assert.match(storyCard, /usePhantasiPeekLane/)
    assert.match(storyCard, /dropPhantasiPeekLane/)
    assert.match(storyCard, /peekLaneIsLive/)
    assert.match(storyCard, /peekGoesToNav/)
    assert.match(storyCard, /onPointerLeave/)
    assert.match(storyCard, /markPhantasiStoryPeek/)
    assert.match(storyCard, /releasePhantasiStoryPeek/)
    assert.match(storyCard, /resumePhantasiStoryPeek/)
    assert.match(storyCard, /schedulePhantasiPeekResume/)
    assert.match(storyCard, /whenPhantasiMotionIdle/)
    assert.match(storyCard, /from ['"]\.\.\/\.\.\/\.\.\/hooks\/animation['"]/)
    assert.match(storyCard, /scheduleTask/)
    assert.match(storyCard, /peekSwapHoldsAir/)
    assert.match(storyCard, /onPointerCancel/)
    assert.match(storyCard, /peekLaneKeepsAir/)
    assert.doesNotMatch(storyCard, /onPointerEnter=/)
    assert.doesNotMatch(storyCard, /onPointerLeave=/)
    assert.match(list, /data-phantasi-peek-lane/)
    assert.match(page, /clearPhantasiStoryPeeks/)
  })
})
