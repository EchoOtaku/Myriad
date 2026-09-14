/** 全局栏 tag 进出场：按 id 差分，整栏替换先退后进。 */
import {
  PHANTASI_TAG_ENTER_MS,
  PHANTASI_TAG_EXIT_MS,
  phantasiTagDelay,
  phantasiTagQuiet,
} from './phantasiTag'

export const PHANTASI_TAG_EXIT_TRANSFORM =
  'translate3d(0, var(--sm-shift-sm, 6px), 0) scale(0.96)'

export const PHANTASI_CARD_EXIT_TRANSFORM = 'translate3d(0, var(--sm-shift-sm, 6px), 0)'

/** 卡片退场最多错开前 8 张，避免长轨把换页拖住。 */
export const PHANTASI_SURFACE_CARD_CAP = 8

/** 标题、站点卡、文章卡、空占位共用这一套，换页同退。 */
export const PHANTASI_SURFACE_CARD_SELECTOR = [
  '[data-phantasi-surface]',
  '[data-phantasi-card]',
  '.phantasi-rail-title',
  '.phantasi-story',
  '.phantasi-vacant',
  '.phantasi-site',
].join(',')

export function chipExitFrames(
  opacity: string,
  transform: string,
  toTransform = PHANTASI_TAG_EXIT_TRANSFORM,
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
      (el) => !el.dataset.phantasiGhost && !el.classList.contains('is-ghosted'),
    )
    .toArray()
}

/** 空占位里的标题跟着整块走，不单独再退一次。 */
export function collectPhantasiSurfaceNodes(root: HTMLElement | null): HTMLElement[] {
  return motionTargets(root, PHANTASI_SURFACE_CARD_SELECTOR).filter((el) => {
    const parent = el.parentElement
    return !parent?.closest(PHANTASI_SURFACE_CARD_SELECTOR)
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
        duration: PHANTASI_TAG_EXIT_MS,
        delay: phantasiTagDelay(Math.min(index, Math.max(cap - 1, 0))),
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
        fill: 'both',
      },
    )
    pending.push(anim.finished.then(() => undefined, () => undefined))
  })
  return pending
}

/** 栏 + 卡片一起退，给板块 / 筛选换树用。 */
export function playPhantasiSurfaceExit(root: HTMLElement | null): {
  wait: number
  waapi: boolean
  done: Promise<void>
} {
  const quiet = phantasiTagQuiet()
  const cards = collectPhantasiSurfaceNodes(root)
  const wait = phantasiSurfaceSwapWait(cards.length, quiet)
  if (quiet || cards.length === 0) {
    return { wait, waapi: false, done: Promise.resolve() }
  }
  const pending = playMotionExit(cards, PHANTASI_CARD_EXIT_TRANSFORM, PHANTASI_SURFACE_CARD_CAP)
  return {
    wait,
    waapi: pending.length > 0,
    done: pending.length
      ? Promise.all(pending).then(() => undefined)
      : Promise.resolve(),
  }
}

/** 舞台完成交接后重播入场，含 A → B → A 留在原树的情况。 */
export function playPhantasiSurfaceEnter(root: HTMLElement | null): void {
  const nodes = collectPhantasiSurfaceNodes(root)
  for (const [index, el] of nodes.entries()) {
    // 订阅轨的卡片已由 FLIP 接管；舞台只负责标题等外围元素。
    if (el.matches('.phantasi-site, .phantasi-story') && el.closest('.phantasi-feeds.is-sites-flipping')) continue
    for (const animation of el.getAnimations()) animation.cancel()
    const { opacity, transform, visibility, display } = getComputedStyle(el)
    if (visibility === 'hidden' || display === 'none' || Number(opacity) === 0 || el.getClientRects().length === 0) continue
    if (phantasiTagQuiet() || typeof el.animate !== 'function') continue
    const animation = el.animate([
      { opacity: 0, transform: PHANTASI_CARD_EXIT_TRANSFORM },
      { opacity, transform },
    ], {
      duration: PHANTASI_TAG_ENTER_MS,
      delay: phantasiTagDelay(Math.min(index, PHANTASI_SURFACE_CARD_CAP - 1)),
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
    })
    // 交还 hover / FLIP 对 transform 的控制权。
    void animation.finished.then(() => animation.cancel(), () => {})
  }
}

/** 退场结束后再换树，给最后一枚一点收尾余量。 */
export const PHANTASI_TAG_SWAP_PAD_MS = 32

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

export function phantasiTagSwapWait(count: number, quiet = false): number {
  if (quiet || count <= 0) return 0
  return phantasiTagDelay(count - 1) + PHANTASI_TAG_EXIT_MS + PHANTASI_TAG_SWAP_PAD_MS
}

export function phantasiSurfaceSwapWait(cardCount: number, quiet = false): number {
  return phantasiTagSwapWait(Math.min(cardCount, PHANTASI_SURFACE_CARD_CAP), quiet)
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
