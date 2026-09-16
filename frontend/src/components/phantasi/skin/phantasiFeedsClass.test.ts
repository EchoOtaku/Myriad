import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(dir, name), 'utf8')
const feedsSrc = () =>
  [read('PhantasiFeeds.tsx'), read('PhantasiFeedsStories.tsx'), read('PhantasiFeedsSites.tsx')].join('\n')

describe('phantasi feeds 入场 class 链', () => {
  it('订阅页不再展开宫格', () => {
    const src = feedsSrc()
    const css = read('../ui/css/cards.css')
    const feedsCss = read('../ui/css/feeds.css')
    const motionCss = read('../ui/css/motion.css')
    for (const value of [src, css, feedsCss, motionCss]) {
      assert.doesNotMatch(value, /is-sites-open|is-sites-morphing|is-sites-flipping|is-sites-booted|is-stories-booted/)
    }
    assert.match(src, /arrive=\{arrive < 8 \? arrive : undefined\}/)
  })

  it('滚网站卡 / 文章卡松手就停，不 jump、不补跟、不补源', () => {
    const src = feedsSrc()
    assert.match(src, /function paintSiteOn/)
    assert.match(src, /siteFollowHintRef/)
    assert.match(src, /followStopsRef\.current,\n {8}driveStopsRef\.current/)
    assert.match(src, /grabbingRef\.current && railDriverRef\.current === 'stories'/)
    assert.match(src, /if \(!grabbingRef\.current\) return/)
    assert.match(src, /railMountColumnsPan/)
    assert.match(src, /railMountColumnsCovered/)
    assert.match(src, /clearStorySettleTimers/)
    assert.match(src, /paintFollowLayer\(false\)/)
    assert.doesNotMatch(src, /flushStorySettle|pendingFlushRef|settleId|FOCUS_FOLLOW_MS/)
    assert.doesNotMatch(src, /itemsApiRef\.current\?\.refresh\(\)/)
    assert.doesNotMatch(src, /startTransition/)
  })

  it('文章轨虚拟化样式不依赖展开宫格', () => {
    const css = read('../ui/css/cards.css')
    const feedsCss = read('../ui/css/feeds.css')
    assert.match(css, /\.phantasi-story\.is-hold/)
    assert.match(css, /\.phantasi-story\.is-away/)
    assert.match(css, /grid-template:/)
    assert.doesNotMatch(css, /\.phantasi-story__foot/)
    assert.match(feedsCss, /is-rail-grabbing/)
    assert.match(feedsCss, /overscroll-behavior: none/)
  })

  it('最新聚合卡用 mix 语气，叠卡跟源走，不铺渐变底', () => {
    const src = feedsSrc()
    const card = read('../ui/SiteCard.tsx')
    const css = read('../ui/css/cards.css')
    assert.match(src, /tone="mix"/)
    assert.match(src, /stack=\{inbox\.stack\}/)
    assert.match(src, /latestFeedStackFaces/)
    assert.doesNotMatch(src, /unread=\{inbox\.unread\}/)
    assert.match(css, /\.phantasi-site\.is-mix \.phantasi-site__article/)
    assert.match(card, /tone === 'mix' && 'is-mix'/)
    assert.match(card, /phantasi-site__stack-face/)
    assert.doesNotMatch(card, /setInterval/)
    assert.doesNotMatch(css, /@keyframes phantasi-site-stack-live/)
    assert.doesNotMatch(css, /@keyframes phantasi-site-stack-swap/)
  })
})
