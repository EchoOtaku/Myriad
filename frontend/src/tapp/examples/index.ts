/**
 * Tapp 示例应用集合
 * 仅包含 Hello World 教学示例
 * 其他应用已迁移到远程商店：https://github.com/Myriad-You/tapp-store
 *
 * 更新日期：2025-12
 */

// 导出类型
// 导入用于聚合
import type { ExampleTapp } from './tapps/types'
import { aroTapp } from './tapps/aro'
import { helloWorldTapp } from './tapps/helloWorld'

export { aroTapp } from './tapps/aro'
// 导出示例
export { helloWorldTapp } from './tapps/helloWorld'

export type { ExampleTapp } from './tapps/types'

/**
 * 内置示例 Tapp（仅 Hello World）
 * 其他应用请从远程商店安装
 */
export const EXAMPLE_TAPPS: ExampleTapp[] = [helloWorldTapp, aroTapp]

export default EXAMPLE_TAPPS
