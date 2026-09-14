import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('BrewPeekAir', () => {
  it('封面 peek 换全局背景，叠标题和站点，进出有过渡和渐变', () => {
    const air = readFileSync(join(dir, 'BrewPeekAir.tsx'), 'utf8')
    const tokens = readFileSync(join(dir, 'css/tokens.css'), 'utf8')
    const motion = readFileSync(join(dir, 'css/motion.css'), 'utf8')
    const cards = readFileSync(join(dir, 'css/cards.css'), 'utf8')
    const page = readFileSync(join(dir, '../../../views/Brew.tsx'), 'utf8')
    const feeds = readFileSync(join(dir, '../skin/BrewFeeds.tsx'), 'utf8')
    assert.match(air, /createPortal/)
    assert.match(air, /bg-container/)
    assert.match(air, /BREW_PEEK_EXIT_MS/)
    assert.match(air, /brew-peek-air__shot/)
    assert.match(air, /brew-peek-air__title/)
    assert.match(air, /brew-peek-air__site/)
    assert.match(air, /BREW_PEEK_COPY_ID/)
    assert.match(air, /toBrewPeekFace/)
    assert.match(page, /<BrewPeekAir face=\{peekFace\} \/>/)
    assert.match(page, /toBrewPeekFace\(item, storySourceFace\(item\)\)/)
    assert.match(page, /handlePeekEnd/)
    assert.match(page, /item\.selectedItem \|\| notes\.noteEditor/)
    assert.doesNotMatch(feeds, /cover=\{.*scene/)
    assert.doesNotMatch(feeds, /hoverStoryId/)
    assert.match(tokens, /\.brew-peek-air__shot\.is-on/)
    assert.match(tokens, /\.brew-peek-air::after/)
    assert.match(tokens, /html\.dark \.brew-peek-air::after/)
    assert.match(tokens, /\.brew-peek-air__lede\.is-on/)
    assert.match(tokens, /\.brew-peek-air__title/)
    assert.match(tokens, /--page-max-width/)
    assert.match(tokens, /--page-pad-x/)
    const frame = readFileSync(join(dir, '../../../styles/page-frame.css'), 'utf8')
    assert.match(frame, /#brew-peek-copy/)
    assert.match(motion, /prefers-reduced-motion: reduce[\s\S]*brew-peek-air/)
    assert.match(motion, /prefers-reduced-motion: reduce[\s\S]*brew-peek-air__lede/)
    assert.match(cards, /\.brew-story__peek/)
    assert.match(cards, /\.brew-story\.has-cover\.has-peek \.brew-story__peek \{[\s\S]*?position: absolute;/)
    assert.match(
      cards,
      /\.brew-story\.has-cover\.has-peek:is\(:hover, :focus-visible, \.is-peek\):not\(\.is-picking\) \.brew-story__peek/,
    )
    assert.match(cards, /\.brew-story\.has-cover\.has-peek \.brew-story__peek \{[\s\S]*?font-size: 0\.75rem;/)
    assert.match(cards, /height: var\(--brew-story-h\)/)
    assert.doesNotMatch(cards, /interpolate-size/)
    assert.doesNotMatch(cards, /:has\(\.brew-story__peek\)/)
    assert.doesNotMatch(
      cards,
      /\.brew-story(?:\.has-cover)?:is\(:hover[\s\S]{0,180}?height:\s*auto/,
    )
    assert.doesNotMatch(
      cards,
      /\.brew-story\.has-cover\.has-peek:is\(:hover[\s\S]{0,220}?max-height: 0/,
    )
    assert.doesNotMatch(
      cards,
      /\.brew-story\.has-cover\.has-peek:is\(:hover[\s\S]{0,280}?height: 0;/,
    )
    assert.match(air, /if \(!ready\) return/)
    assert.doesNotMatch(air, /setCopyOn/)
    assert.match(air, /setCopies/)
    assert.match(cards, /--brew-peek-fade/)
    const storyCard = readFileSync(join(dir, 'StoryCard.tsx'), 'utf8')
    const face = readFileSync(join(dir, '../skin/storyFace.ts'), 'utf8')
    assert.match(storyCard, /brew-story__peek/)
    assert.match(storyCard, /has-peek/)
    assert.match(face, /brew-story__peek/)
    assert.match(air, /requestAnimationFrame\(arm\)/)
    assert.doesNotMatch(
      cards,
      /\.brew-story:is\(:hover, :focus-visible, \.is-peek\):not\(\.is-picking, \.brew-story--slot\) \{\n {2}z-index: 8;/,
    )
    assert.doesNotMatch(
      cards,
      /\.brew-story__hit:is\(:hover, :focus-visible, \.is-peek\):not\(\.is-picking\) \.brew-story__summary/,
    )
    assert.match(storyCard, /markBrewStoryPeek/)
    assert.match(page, /clearBrewStoryPeeks/)
  })
})
