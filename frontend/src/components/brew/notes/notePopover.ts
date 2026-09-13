/**
 * 「+」菜单这类小弹层的定位：和设置页的悬浮提示同一套规则——
 * 优先在触发器下面，下面不够就翻上去，左右夹在视口里；间距和边距也用它的常量。
 * 区别只有一处：菜单和触发器左边对齐，不居中。
 */

import {
  computeHoverTooltipPosition,
  HOVER_TOOLTIP_VIEWPORT_PAD,
} from '../../settings/settingHoverTooltip'

export interface PopoverCoords {
  top: number
  left: number
  placement: 'top' | 'bottom'
}

export function placePopover(
  trigger: { top: number; left: number; bottom: number; width: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): PopoverCoords {
  const centered = computeHoverTooltipPosition(
    trigger,
    size.width,
    size.height,
    'bottom',
    viewport,
  )
  const pad = HOVER_TOOLTIP_VIEWPORT_PAD
  const left = Math.max(pad, Math.min(trigger.left, viewport.width - size.width - pad))
  return { top: centered.top, left, placement: centered.placement }
}
