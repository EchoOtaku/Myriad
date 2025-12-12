/**
 * Tapp Runtime 模块导出
 */

export { TappBridge, createTappBridge } from './TappBridge'
export { TappPermissionController, createPermissionController } from './TappPermission'
export { TappScheduler, getTappScheduler } from './TappScheduler'
export type {
  ScheduleType,
  ExecutionTarget,
  MissedPolicy,
  TaskExecutionStatus,
  ScheduleConfig,
  RetryConfig,
  BackendAction,
  TaskRegistrationOptions,
  RegisteredTask,
  TaskExecutionEvent,
  TaskCallback,
} from './TappScheduler'

// 沙箱组件
export { TappPageSandbox } from './TappPageSandbox'
export type { TappPageSandboxProps } from './TappPageSandbox'
export { TappWidgetSandbox } from './TappWidgetSandbox'
export type { TappWidgetSandboxProps } from './TappWidgetSandbox'

// 兼容性导出（保持向后兼容，TappSandbox 作为 TappPageSandbox 的别名）
export { TappPageSandbox as TappSandbox } from './TappPageSandbox'

// 类型导出
export type { 
  SandboxMode as TappSandboxMode, 
  WidgetRenderProps, 
  TappNotificationOptions,
  SafeInsets,
} from './sandbox'

export { TappRuntime, getTappRuntime } from './TappRuntime'

