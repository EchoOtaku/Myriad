/**
 * Tapp 模块主入口
 */

// 组件导出
export { TappIcon } from './components/TappIcon'
export { TappWindowManager } from './components/TappWindowManager'

// 示例 Tapp 导出
export { EXAMPLE_TAPPS, helloWorldTapp } from './examples'

// 页面导出
export {
  TappDetailPage,
  TappListPage,
  TappRunPage,
} from './pages'
// 运行时导出
export {
  createPermissionController,
  createTappBridge,
  getResourceLoader,
  getTappRuntime,
  getTappScheduler,
  loadWidgetResources,
  TappBridge,
  TappPermissionController,
  TappRuntime,
  TappSandbox,
  TappScheduler,
  TappWidgetSandbox,
} from './runtime'

export type {
  BackendAction,
  ExecutionTarget,
  MissedPolicy,
  RegisteredTask,
  RetryConfig,
  ScheduleConfig,
  ScheduleType,
  TaskCallback,
  TaskExecutionEvent,
  TaskExecutionStatus,
  TaskRegistrationOptions,
} from './runtime'

// 服务导出
export { cleanupTemporaryTapps, getRecentTapps, listTapps, OFFICIAL_STORE, RemoteStoreService } from './services'

export type {
  RecentTappItem,
  RemoteApp,
  RemoteCategory,
  RemoteStoreIndex,
  RemoteStoreSource,
  TappListItem,
} from './services'
// 类型导出
export * from './types'
