/** 全局栏 tag 进出场：按 id 差分，整栏替换先退后进。 */
import {
  BREW_TAG_ENTER_MS,
  BREW_TAG_EXIT_MS,
  brewTagDelay,
  brewTagQuiet,
} from './brewTag'

export const BREW_TAG_EXIT_TRANSFORM =
  'translate3d(0, var(--sm-shift-sm, 6px), 0) scale(0.96)'

export const BREW_CARD_EXIT_TRANSFORM = 'translate3d(0, var(--sm-shift-sm, 6px), 0)'

/** 卡片退场最多错开前 8 张，避免长轨把换页拖住。 */
export const BREW_SURFACE_CARD_CAP = 8

/** 标题、站点卡、文章卡、空占位共用这一套，换页同退。 */
export const BREW_SURFACE_CARD_SELECTOR = [
  '[data-brew-surface]',
  '[data-brew-card]',
  '.brew-rail-title',
  '.brew-story',
  '.brew-vacant',
  '.brew-site',
].join(',')

export function chipExitFrames(
  opacity: string,
  transform: string,
  toTransform = BREW_TAG_EXIT_TRANSFORM,
): Keyframe[] {
  return [
    {
      opacity,
      transform: transform === 'none' ? 'none' : transform,
    },
    {
      opacity: 0,
      transform: toTransform,
    },
  ]
}

function motionTargets(root: HTMLElement | null, selector: string): HTMLElement[] {
  if (!root) return []
  return Iterator.from(root.querySelectorAll<HTMLElement>(selector))
    .filter(
      (el) => !el.dataset.brewGhost && !el.classList.contains('is-ghosted'),
    )
    .toArray()
}

/** 空占位里的标题跟着整块走，不单独再退一次。 */
export function collectBrewSurfaceNodes(root: HTMLElement | null): HTMLElement[] {
  return motionTargets(root, BREW_SURFACE_CARD_SELECTOR).filter((el) => {
    const parent = el.parentElement
    return !parent?.closest(BREW_SURFACE_CARD_SELECTOR)
  })
}

function playMotionExit(
  nodes: HTMLElement[],
  toTransform: string,
  cap = Infinity,
): Promise<void>[] {
  const pending: Promise<void>[] = []
  nodes.forEach((el, index) => {
    if (typeof el.animate !== 'function') return
    const { opacity, transform } = getComputedStyle(el)
    for (const anim of el.getAnimations()) anim.cancel()
    const anim = el.animate(
      chipExitFrames(opacity, transform, toTransform),
      {
        duration: BREW_TAG_EXIT_MS,
        delay: brewTagDelay(Math.min(index, Math.max(cap - 1, 0))),
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
        fill: 'both',
      },
    )
    pending.push(anim.finished.then(() => undefined, () => undefined))
  })
  return pending
}

/** 栏 + 卡片一起退，给板块 / 筛选换树用。 */
export function playBrewSurfaceExit(root: HTMLElement | null): {
  wait: number
  waapi: boolean
  done: Promise<void>
} {
  const quiet = brewTagQuiet()
  const cards = collectBrewSurfaceNodes(root)
  const wait = brewSurfaceSwapWait(cards.length, quiet)
  if (quiet || cards.length === 0) {
    return { wait, waapi: false, done: Promise.resolve() }
  }
  const pending = playMotionExit(cards, BREW_CARD_EXIT_TRANSFORM, BREW_SURFACE_CARD_CAP)
  return {
    wait,
    waapi: pending.length > 0,
    done: pending.length
      ? Promise.all(pending).then(() => undefined)
      : Promise.resolve(),
  }
}

/** 舞台完成交接后重播入场，含 A → B → A 留在原树的情况。 */
export function playBrewSurfaceEnter(root: HTMLElement | null): void {
  const nodes = collectBrewSurfaceNodes(root)
  for (const [index, el] of nodes.entries()) {
    // 订阅轨的卡片已由 FLIP 接管；舞台只负责标题等外围元素。
    if (el.matches('.brew-site, .brew-story') && el.closest('.brew-feeds.is-sites-flipping')) continue
    for (const animation of el.getAnimations()) animation.cancel()
    const { opacity, transform, visibility, display } = getComputedStyle(el)
    if (visibility === 'hidden' || display === 'none' || Number(opacity) === 0 || el.getClientRects().length === 0) continue
    if (brewTagQuiet() || typeof el.animate !== 'function') continue
    const animation = el.animate([
      { opacity: 0, transform: BREW_CARD_EXIT_TRANSFORM },
      { opacity, transform },
    ], {
      duration: BREW_TAG_ENTER_MS,
      delay: brewTagDelay(Math.min(index, BREW_SURFACE_CARD_CAP - 1)),
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
    })
    // 交还 hover / FLIP 对 transform 的控制权。
    void animation.finished.then(() => animation.cancel(), () => {})
  }
}

/** 退场结束后再换树，给最后一枚一点收尾余量。 */
export const BREW_TAG_SWAP_PAD_MS = 32

type ChipLanePlan = 'hold' | 'start-exit' | 'retarget'

/** 退场进行中只改目的地，不重开节拍。 */
export function planChipLaneSwap(
  displayedWave: string,
  nextWave: string,
  exiting: boolean,
): ChipLanePlan {
  if (exiting) return 'retarget'
  if (nextWave === displayedWave) return 'hold'
  return 'start-exit'
}

export function brewTagSwapWait(count: number, quiet = false): number {
  if (quiet || count <= 0) return 0
  return brewTagDelay(count - 1) + BREW_TAG_EXIT_MS + BREW_TAG_SWAP_PAD_MS
}

export function brewSurfaceSwapWait(cardCount: number, quiet = false): number {
  return brewTagSwapWait(Math.min(cardCount, BREW_SURFACE_CARD_CAP), quiet)
}

/** 按退场时长满拍再换树。不听 WAAPI finished：加速时间轴会立刻 finished。 */
export function awaitLaneSwap(
  _done: Promise<void>,
  wait: number,
): Promise<void> {
  if (wait <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, wait)
  })
}
