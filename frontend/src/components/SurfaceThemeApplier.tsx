/**
 * 表面主题应用器 —— 全站级挂载点（渲染 null）
 *
 * 作用：在 AppLayout 常驻挂载，触发 useWidgetTheme 的初始化，
 * 从后端读取保存的表面主题并写入 html[data-surface]，使**所有**页面
 * （含无小组件的报告页 / Tapp 页）的 .glass 组件都跟随主题。
 *
 * 自身渲染 null，主题变化引起的重渲染被隔离在此组件内，不波及应用树。
 */

import { useWidgetTheme } from '../hooks/useWidgetTheme'

export function SurfaceThemeApplier() {
  useWidgetTheme()
  return null
}

export default SurfaceThemeApplier
