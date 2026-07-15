import type { TappCodeStructure } from '../types'

/** 按沙箱模式组合需要执行的代码。 */
export function getCodeForMode(
  code: TappCodeStructure,
  mode: 'widget' | 'page' | 'background',
): string {
  switch (mode) {
    case 'widget':
      return code.widget
        ? `${code.core}\n\n// ========== Widget Code ==========\n${code.widget}`
        : code.core
    case 'page':
      return code.page
        ? `${code.core}\n\n// ========== Page Code ==========\n${code.page}`
        : code.core
    case 'background':
      return code.core
  }
}
