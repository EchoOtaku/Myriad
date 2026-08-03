/**
 * 背景滚动锁 —— 全站唯一实现。
 *
 * ## 为什么不能只锁 body
 *
 * 本站在 `styles/theme.css` 与 `styles/page-transitions.css` 里都声明了
 * `html { overflow: hidden auto }`。html 一旦有非 visible 的 overflow，
 * 就**由它自己充当滚动容器**，body 的 overflow 不再向视口传播 ——
 * 于是 `document.body.style.overflow = 'hidden'` 只是给 body 建了个 BFC，
 * body 高度照样撑开，页面照样滚。弹窗背景滚不住的原因就在这里。
 *
 * ## 计数
 *
 * 允许嵌套（用户弹窗上再开灯箱）：只有最外层那次负责保存与还原原始样式，
 * 内层加减计数。否则内层解锁会把外层也一起放开。
 */

interface SavedStyles {
  htmlOverflow: string
  bodyOverflow: string
  bodyPaddingRight: string
}

let lockCount = 0
let saved: SavedStyles | null = null

/**
 * 锁住背景滚动，返回解锁函数（重复调用只生效一次）。
 */
export function lockScroll(): () => void {
  if (typeof document === 'undefined') return () => {}

  const html = document.documentElement
  const body = document.body

  if (lockCount === 0) {
    saved = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    }

    // 滚动条占位：直接隐藏会让内容横向跳一下。用等宽 padding 补回来。
    // 覆盖式滚动条（macOS 默认）算出来是 0，自然不补。
    const scrollbarWidth = window.innerWidth - html.clientWidth
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
  }

  lockCount += 1

  let released = false
  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0 && saved) {
      html.style.overflow = saved.htmlOverflow
      body.style.overflow = saved.bodyOverflow
      body.style.paddingRight = saved.bodyPaddingRight
      saved = null
    }
  }
}
