/**
 * 处理器模块索引
 */

export {
  registerAdvancedHandlers,
  registerAnimationHandlers,
  registerBackgroundHandlers,
  registerContextHandlers,
  registerDynamicContentHandlers,
  registerMediaHandlers,
  registerSpeechHandlers,
} from './advancedHandlers'

export {
  registerAIHandlers,
  registerReportHandlers,
} from './aiHandlers'

export {
  registerFileHandlers,
  registerLifecycleHandlers,
  registerStorageHandlers,
  registerUIHandlers,
  registerUserHandlers,
} from './baseHandlers'

export {
  registerPlatformHandlers,
  registerWidgetHandlers,
} from './platformHandlers'

export {
  registerBrewListHandlers,
  registerTappListHandlers,
} from './contentHandlers'

export {
  registerFederationHandlers,
} from '../../FederationBridge'
