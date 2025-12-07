/**
 * Tapp 模块主入口
 */

// 类型导出
export * from './types'

// 运行时导出
export {
  TappBridge,
  createTappBridge,
  TappPermissionController,
  createPermissionController,
  TappSandbox,
  TappRuntime,
  getTappRuntime,
} from './runtime'

// 页面导出
export {
  TappListPage,
  TappRunPage,
  TappDetailPage,
} from './pages'

// 示例 Tapp 导出
export { EXAMPLE_TAPPS, helloWorldTapp } from './examples'

// 服务导出
export { RemoteStoreService, OFFICIAL_STORE } from './services/RemoteStoreService'
export type { 
  RemoteStoreSource, 
  RemoteStoreIndex, 
  RemoteApp, 
  RemoteCategory 
} from './services/RemoteStoreService'
