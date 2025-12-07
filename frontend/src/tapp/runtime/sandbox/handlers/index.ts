/**
 * 处理器模块索引
 */

export {
  registerLifecycleHandlers,
  registerUIHandlers,
  registerStorageHandlers,
  registerUserHandlers,
} from './baseHandlers'

export {
  registerWidgetHandlers,
  registerPlatformHandlers,
} from './platformHandlers'

export {
  registerAIHandlers,
  registerReportHandlers,
} from './aiHandlers'

export {
  registerMediaHandlers,
  registerBackgroundHandlers,
  registerAnimationHandlers,
  registerDynamicContentHandlers,
  registerAdvancedHandlers,
  registerContextHandlers,
} from './advancedHandlers'
