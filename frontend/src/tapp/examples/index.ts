/**
 * Tapp 示例应用集合
 * 内置教学 / 能力演示示例；更多应用见远程商店。
 *
 * 更新日期：2026-07
 */

// 导出类型
// 导入用于聚合
import type { ExampleTapp } from './tapps/types'
import { aroTapp } from './tapps/aro'
import { helloWorldTapp } from './tapps/helloWorld'
import { miniGameTapp } from './tapps/miniGame'

export { aroTapp } from './tapps/aro'
// 导出示例
export { helloWorldTapp } from './tapps/helloWorld'
export { miniGameTapp } from './tapps/miniGame'

export type { ExampleTapp } from './tapps/types'

/**
 * 内置示例 Tapp
 * 其他应用请从远程商店安装
 */
export const EXAMPLE_TAPPS: ExampleTapp[] = [
  helloWorldTapp,
  miniGameTapp,
  aroTapp,
]

export default EXAMPLE_TAPPS
