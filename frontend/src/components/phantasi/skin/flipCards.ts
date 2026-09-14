/** 入场：网站卡沿轨道，文章晚半拍跟上。 */

import { phantasiMotionQuiet } from '../../../hooks/animation/pages/phantasiMotion'
import { RAIL_OVERFLOW_LEFT_PX, railSeatScroll } from './railPan'

const FLIP_EASE = 'cubic-bezier(0.4, 0.0, 0.2, 1)'
export const FLIP_SITE_MS = 560
export const FLIP_STORY_MS = 400
export const FLIP_STAGGER_MS = 24
export const FLIP_STAGGER_CAP_MS = 192
/** 首次入场：网站卡已经在走，文章晚半拍跟上。 */
export const FLIP_STORY_FOLLOW_MS = 64
export const FLIP_INTRO_STORY_MS = 32
const FLIP_WAIT_PAD_MS = 80
const STORY_LIFT = 'translate3d(0, 16px, 0) scale(0.97)'
/** 网站卡沿轨道入场：前一张从左溢出，其余从右边进来。 */
export const SITE_ENTER = 'translate3d(24px, 0, 0)'
export const SITE_ENTER_LEFT = 'translate3d(-24px, 0, 0)'
/** 与 `.phantasi-site` 默认透明度对齐。 */
export const SITE_RAIL_OP = 0.64

export function phantasiFlipQuiet(): boolean {
  return phantasiMotionQuiet()
}

export function flipDelay(index: number, lead = false): number {
  if (lead) return 0
  return Math.min(index * FLIP_STAGGER_MS, FLIP_STAGGER_CAP_MS)
}

export function flipDelayFromLead(
  index: number,
  leadIndex: number | null,
): number {
  if (leadIndex == null || leadIndex < 0) return flipDelay(index)
  return flipDelay(Math.abs(index - leadIndex), index === leadIndex)
}

/** 同一列一起走。 */
export function storyColumn(index: number): number {
  return Math.floor(index / 2)
}

export function storyDelay(index: number, extra = 0): number {
  return extra + flipDelay(storyColumn(index))
}

export function siteRestOpacity(on: boolean): number {
  return on ? 1 : SITE_RAIL_OP
}

const CHROME_STYLE = [
  'transition',
  'flex',
  'height',
  'min-height',
  'opacity',
  'visibility',
  'overflow',
] as const

function releaseFeedsChrome(root: HTMLElement): void {
  for (const sel of [
    '.phantasi-feeds__air',
    '.phantasi-feeds__sites',
    '.phantasi-feeds__items',
  ]) {
    const el = root.querySelector<HTMLElement>(sel)
    if (!el) continue
    for (const anim of el.getAnimations()) anim.cancel()
    for (const prop of CHROME_STYLE) el.style.removeProperty(prop)
  }
}

export function flipWaitMs(): number {
  return (
    Math.max(FLIP_SITE_MS, FLIP_STORY_FOLLOW_MS + FLIP_STORY_MS)
    + FLIP_STAGGER_CAP_MS
    + FLIP_WAIT_PAD_MS
  )
}

function liveCards(root: ParentNode, selector: string): HTMLElement[] {
  return Iterator.from(root.querySelectorAll<HTMLElement>(selector))
    .filter((el) => !el.dataset.phantasiGhost)
    .toArray()
}

function clearRailExit(el: HTMLElement): void {
  delete el.dataset.leaving
  el.style.visibility = ''
  el.style.pointerEvents = ''
  el.style.removeProperty('--exit')
  el.style.removeProperty('--exit-x')
}

export function clearRailExits(root: ParentNode, selector: string): void {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    clearRailExit(el)
  }
}

export function seatSiteTrack(track: HTMLElement, id: number): void {
  const cards = Iterator.from(
    track.querySelectorAll<HTMLElement>('.phantasi-site'),
  )
    .map((el) => ({ el, left: el.offsetLeft }))
    .toArray()
  const index = cards.findIndex((card) => Number(card.el.dataset.railId) === id)
  const x = railSeatScroll(cards, index, RAIL_OVERFLOW_LEFT_PX)
  track.style.transform = x > 0.5 ? `translate3d(${-x}px, 0, 0)` : ''
}

function play(
  el: HTMLElement,
  keyframes: Keyframe[],
  delay: number,
  duration: number,
): Animation {
  return el.animate(keyframes, {
    duration,
    delay,
    easing: FLIP_EASE,
    fill: 'both',
    composite: 'replace',
  })
}

function clearStoryLifts(root: ParentNode): void {
  const feeds =
    root instanceof HTMLElement && root.classList.contains('phantasi-feeds')
      ? root
      : root instanceof Element
        ? root.closest('.phantasi-feeds')
        : null
  for (const el of root.querySelectorAll<HTMLElement>(
    '.is-ghosted, .phantasi-site, .phantasi-story',
  )) {
    if (el.dataset.phantasiGhost) continue
    for (const anim of el.getAnimations()) anim.cancel()
    el.classList.remove('is-ghosted')
    el.style.transition = 'none'
    el.style.removeProperty('visibility')
    el.style.removeProperty('transform')
    if (el.classList.contains('phantasi-site')) {
      const on =
        el.classList.contains('is-on') || el.classList.contains('is-cover')
      el.style.opacity = String(siteRestOpacity(on))
    } else {
      el.style.removeProperty('opacity')
    }
  }
  for (const ghost of root.querySelectorAll('[data-phantasi-ghost]')) {
    ghost.remove()
  }
  if (feeds instanceof HTMLElement) {
    feeds.classList.add('is-sites-settling')
    requestAnimationFrame(() => {
      for (const el of liveCards(feeds, '.phantasi-site')) {
        el.style.removeProperty('opacity')
        el.style.removeProperty('transition')
      }
      for (const el of liveCards(feeds, '.phantasi-story')) {
        el.style.removeProperty('transition')
      }
      feeds.classList.remove('is-sites-settling')
    })
  }
}

function enterCards(
  root: ParentNode,
  selector: string,
  extraDelay = 0,
  duration = FLIP_STORY_MS,
  toOp = 1,
): Animation[] {
  return liveCards(root, selector).map((el, index) => {
    return play(
      el,
      [
        { opacity: 0, transform: STORY_LIFT },
        { opacity: toOp, transform: 'translate3d(0, 0, 0) scale(1)' },
      ],
      storyDelay(index, extraDelay),
      duration,
    )
  })
}

export function enterStories(
  root: ParentNode,
  selector: string,
  extraDelay = FLIP_STORY_FOLLOW_MS,
): Animation[] {
  return enterCards(root, selector, extraDelay, FLIP_STORY_MS)
}

export function enterSites(
  root: ParentNode,
  extraDelay = 0,
  leadId?: string | null,
): Animation[] {
  const cards = liveCards(root, '.phantasi-site')
  const leadIndex = leadId
    ? cards.findIndex((el) => el.dataset.railId === leadId)
    : 0
  return cards.map((el, index) => {
    const on =
      el.classList.contains('is-on') || el.classList.contains('is-cover')
    const op = siteRestOpacity(on)
    const from = index < leadIndex ? SITE_ENTER_LEFT : SITE_ENTER
    return play(
      el,
      [
        { opacity: 0, transform: from },
        { opacity: op, transform: 'translate3d(0, 0, 0)' },
      ],
      extraDelay + flipDelayFromLead(index, leadIndex < 0 ? 0 : leadIndex),
      FLIP_SITE_MS,
    )
  })
}

export function waitFlip(_anims: readonly Animation[]): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, flipWaitMs())
  })
}

/** 换树前揭回活卡，避免入场动画留在退场里。 */
export function revealFeedsTree(root?: ParentNode | null): void {
  if (!root) return
  const feeds =
    root instanceof HTMLElement && root.classList.contains('phantasi-feeds')
      ? root
      : root instanceof Element
        ? root.querySelector('.phantasi-feeds')
        : null
  if (!(feeds instanceof HTMLElement)) return
  clearStoryLifts(feeds)
  releaseFeedsChrome(feeds)
}
