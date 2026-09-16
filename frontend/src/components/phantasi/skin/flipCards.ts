/** 换树揭回活卡。入场走 CSS arrive，不再走 Web Animations。 */

/** 与 `.phantasi-site` 默认透明度对齐。 */
export const SITE_RAIL_OP = 0.64

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

function liveCards(root: ParentNode, selector: string): HTMLElement[] {
  return Iterator.from(root.querySelectorAll<HTMLElement>(selector))
    .filter((el) => !el.dataset.phantasiGhost)
    .toArray()
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
