/**
 * SettingTitleGuideEntry 纯逻辑（无 React / DOM）。
 * 固定、拖动夹紧、关闭策略、锚点定位可单测。
 */

export const GUIDE_VIEWPORT_PAD = 10
export const GUIDE_GAP = 8
/** 触发器在视口内至少保留的可见边长（px），低于则视为不可见 */
export const GUIDE_MIN_VISIBLE_EDGE = 10

export type GuidePlacement = 'top' | 'left' | 'right' | 'bottom'

export interface GuideCoords {
  top: number
  left: number
  placement: GuidePlacement
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max))
}

/**
 * 固定 / 拖动时把浮窗夹在视口内。
 * 面板比视口还大时，贴齐 pad 边（max 塌缩到 min）。
 */
export function clampPanelToViewport(
  top: number,
  left: number,
  panelW: number,
  panelH: number,
  viewportW: number,
  viewportH: number,
  pad: number = GUIDE_VIEWPORT_PAD,
): { top: number; left: number } {
  return {
    left: clamp(
      left,
      pad,
      Math.max(pad, viewportW - panelW - pad),
    ),
    top: clamp(
      top,
      pad,
      Math.max(pad, viewportH - panelH - pad),
    ),
  }
}

/**
 * 拖动位移后的目标坐标（先加 delta，再夹紧视口）。
 */
export function applyGuideDragDelta(
  origTop: number,
  origLeft: number,
  deltaX: number,
  deltaY: number,
  panelW: number,
  panelH: number,
  viewportW: number,
  viewportH: number,
  pad: number = GUIDE_VIEWPORT_PAD,
): { top: number; left: number } {
  return clampPanelToViewport(
    origTop + deltaY,
    origLeft + deltaX,
    panelW,
    panelH,
    viewportW,
    viewportH,
    pad,
  )
}

/**
 * 固定态下是否允许关闭浮窗。
 * - 未固定：允许（点外 / Esc / 滚出 等）
 * - 已固定：仅 force（关闭按钮）可关
 */
export function shouldAllowGuideClose(
  pinned: boolean,
  force = false,
): boolean {
  if (pinned && !force) return false
  return true
}

/**
 * 固定态下点入口 toggle 是否应关闭（始终否；只能用关闭钮）。
 * 未固定且已打开时，toggle 应关闭。
 */
export function shouldToggleCloseGuide(
  isOpen: boolean,
  pinned: boolean,
): boolean {
  if (!isOpen) return false
  if (pinned) return false
  return true
}

export interface GuideRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * 相对触发器定位浮窗（与组件内策略一致）。
 * 视口尺寸显式传入，便于单测。
 */
export function computeGuidePosition(
  trigger: GuideRect,
  panelW: number,
  panelH: number,
  viewportW: number,
  viewportH: number,
  pad: number = GUIDE_VIEWPORT_PAD,
  gap: number = GUIDE_GAP,
): GuideCoords {
  const spaceAbove = trigger.top - pad
  const spaceBelow = viewportH - trigger.bottom - pad
  const spaceLeft = trigger.left - pad
  const spaceRight = viewportW - trigger.right - pad

  const needH = panelH + gap
  const needW = panelW + gap

  let placement: GuidePlacement = 'top'
  if (needH <= spaceAbove) {
    placement = 'top'
  } else if (needW <= spaceLeft) {
    placement = 'left'
  } else if (needW <= spaceRight) {
    placement = 'right'
  } else if (needH <= spaceBelow) {
    placement = 'bottom'
  } else {
    const scores: Array<{ p: GuidePlacement; s: number }> = [
      { p: 'top', s: spaceAbove },
      { p: 'left', s: spaceLeft },
      { p: 'right', s: spaceRight },
      { p: 'bottom', s: spaceBelow },
    ]
    scores.sort((a, b) => b.s - a.s)
    placement = scores[0]!.p
  }

  let top = 0
  let left = 0

  switch (placement) {
    case 'top':
      top = trigger.top - gap - panelH
      left = trigger.left
      break
    case 'left':
      top = trigger.top
      left = trigger.left - gap - panelW
      break
    case 'right':
      top = trigger.top
      left = trigger.right + gap
      break
    case 'bottom':
      top = trigger.bottom + gap
      left = trigger.left
      break
  }

  left = clamp(left, pad, viewportW - panelW - pad)
  top = clamp(top, pad, viewportH - panelH - pad)

  return { top, left, placement }
}

/**
 * 元素相对视口是否仍有足够可见边（用于未固定时自动关闭）。
 */
export function isGuideAnchorVisible(
  rect: GuideRect,
  viewportW: number,
  viewportH: number,
  minEdge: number = GUIDE_MIN_VISIBLE_EDGE,
): boolean {
  const visibleH = Math.min(rect.bottom, viewportH) - Math.max(rect.top, 0)
  const visibleW = Math.min(rect.right, viewportW) - Math.max(rect.left, 0)
  return visibleH >= minEdge && visibleW >= minEdge
}
