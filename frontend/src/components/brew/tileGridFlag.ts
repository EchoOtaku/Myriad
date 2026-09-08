/**
 * 磁贴墙的开关。默认开。
 *
 * 仓库没有 feature flag 框架，这个功能也不值得为它引入远程配置 —— 一个
 * localStorage 键就够了。
 *
 * 回旧网格：控制台 `localStorage.setItem('brew_tile_grid','0')` 后刷新。
 * 清掉这个键或写成 `'1'` 都走新墙。
 *
 * **这个模块和它在 `BrewSourceGrid` 顶部的分支是要被删掉的**：确认不回退后，
 * 连同旧网格一起清退。最容易忘的就是它，忘了就变成永久债。
 */

const KEY = 'brew_tile_grid'

export function isBrewTileGridEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== '0'
  } catch {
    // 隐私模式 / 站点数据被禁用时读 localStorage 会抛；缺省走新墙
    return true
  }
}
