/**
 * Tapp 权限展示元数据
 *
 * 权限 → 图标 / i18n 键的映射，供详情页与商店详情视图共用。
 * 权限级别定义见 runtime/permissionConfig.ts 的 PERMISSION_LEVELS。
 */

import type { TappPermission } from '../types'
import {
  FaBell,
  FaChartBar,
  FaChevronUp,
  FaCog,
  FaDatabase,
  FaDownload,
  FaGamepad,
  FaHdd,
  FaLock,
  FaMicrophone,
  FaRobot,
} from '@lib/icons'

/** 权限展示配置 - 使用 i18n 键名（对应 t.tapp 中的扁平键） */
export const PERMISSION_CONFIG: Record<
  TappPermission,
  {
    icon: typeof FaGamepad
    labelKey: string
    descriptionKey: string
  }
> = {
  'widget:register': {
    icon: FaGamepad,
    labelKey: 'permRegisterWidget',
    descriptionKey: 'permRegisterWidgetDesc',
  },
  'platform:read': {
    icon: FaDatabase,
    labelKey: 'permReadPlatform',
    descriptionKey: 'permReadPlatformDesc',
  },
  'platform:write': {
    icon: FaDatabase,
    labelKey: 'permWritePlatform',
    descriptionKey: 'permWritePlatformDesc',
  },
  'platform:register': {
    icon: FaDatabase,
    labelKey: 'permRegisterPlatform',
    descriptionKey: 'permRegisterPlatformDesc',
  },
  'ai:generate': {
    icon: FaRobot,
    labelKey: 'permAiGenerate',
    descriptionKey: 'permAiGenerateDesc',
  },
  'ai:analyze': {
    icon: FaRobot,
    labelKey: 'permAiAnalyze',
    descriptionKey: 'permAiAnalyzeDesc',
  },
  'ai:chat': {
    icon: FaRobot,
    labelKey: 'permAiChat',
    descriptionKey: 'permAiChatDesc',
  },
  'ai:image': {
    icon: FaRobot,
    labelKey: 'permAiImage',
    descriptionKey: 'permAiImageDesc',
  },
  'report:read': {
    icon: FaChartBar,
    labelKey: 'permReadReport',
    descriptionKey: 'permReadReportDesc',
  },
  'report:write': {
    icon: FaChartBar,
    labelKey: 'permWriteReport',
    descriptionKey: 'permWriteReportDesc',
  },
  storage: {
    icon: FaHdd,
    labelKey: 'permStorage',
    descriptionKey: 'permStorageDesc',
  },
  'ui:notification': {
    icon: FaBell,
    labelKey: 'permNotification',
    descriptionKey: 'permNotificationDesc',
  },
  'ui:fullscreen': {
    icon: FaChevronUp,
    labelKey: 'permFullscreen',
    descriptionKey: 'permFullscreenDesc',
  },
  'ui:theme': {
    icon: FaChevronUp,
    labelKey: 'permReadTheme',
    descriptionKey: 'permReadThemeDesc',
  },
  'ui:confirm': {
    icon: FaChevronUp,
    labelKey: 'permConfirm',
    descriptionKey: 'permConfirmDesc',
  },
  'network:fetch': {
    icon: FaDatabase,
    labelKey: 'permNetworkFetch',
    descriptionKey: 'permNetworkFetchDesc',
  },
  'media:control': {
    icon: FaGamepad,
    labelKey: 'permMediaControl',
    descriptionKey: 'permMediaControlDesc',
  },
  'media:read': {
    icon: FaGamepad,
    labelKey: 'permMediaRead',
    descriptionKey: 'permMediaReadDesc',
  },
  'media:audio': {
    icon: FaGamepad,
    labelKey: 'permMediaAudio',
    descriptionKey: 'permMediaAudioDesc',
  },
  'component:theme': {
    icon: FaChevronUp,
    labelKey: 'permRegisterTheme',
    descriptionKey: 'permRegisterThemeDesc',
  },
  'component:agent': {
    icon: FaRobot,
    labelKey: 'permRegisterAgent',
    descriptionKey: 'permRegisterAgentDesc',
  },
  'shortcut:register': {
    icon: FaGamepad,
    labelKey: 'permRegisterShortcut',
    descriptionKey: 'permRegisterShortcutDesc',
  },
  'event:publish': {
    icon: FaBell,
    labelKey: 'permPublishEvent',
    descriptionKey: 'permPublishEventDesc',
  },
  'event:subscribe': {
    icon: FaBell,
    labelKey: 'permSubscribeEvent',
    descriptionKey: 'permSubscribeEventDesc',
  },
  'scheduler:register': {
    icon: FaCog,
    labelKey: 'permSchedulerRegister',
    descriptionKey: 'permSchedulerRegisterDesc',
  },
  'speech:tts': {
    icon: FaMicrophone,
    labelKey: 'permSpeechTts',
    descriptionKey: 'permSpeechTtsDesc',
  },
  'speech:asr': {
    icon: FaMicrophone,
    labelKey: 'permSpeechAsr',
    descriptionKey: 'permSpeechAsrDesc',
  },
  'tappList:read': {
    icon: FaDatabase,
    labelKey: 'permReadTappList',
    descriptionKey: 'permReadTappListDesc',
  },
  'tappList:manage': {
    icon: FaDatabase,
    labelKey: 'permManageTappList',
    descriptionKey: 'permManageTappListDesc',
  },
  'brew:read': {
    icon: FaDatabase,
    labelKey: 'permReadBrew',
    descriptionKey: 'permReadBrewDesc',
  },
  'brew:write': {
    icon: FaDatabase,
    labelKey: 'permWriteBrew',
    descriptionKey: 'permWriteBrewDesc',
  },
  'brew:comment': {
    icon: FaBell,
    labelKey: 'permCommentBrew',
    descriptionKey: 'permCommentBrewDesc',
  },
  'brew:manage': {
    icon: FaCog,
    labelKey: 'permManageBrew',
    descriptionKey: 'permManageBrewDesc',
  },
  'federation:read': {
    icon: FaDatabase,
    labelKey: 'permReadFederation',
    descriptionKey: 'permReadFederationDesc',
  },
  'federation:write': {
    icon: FaDatabase,
    labelKey: 'permWriteFederation',
    descriptionKey: 'permWriteFederationDesc',
  },
  'federation:message': {
    icon: FaBell,
    labelKey: 'permMessageFederation',
    descriptionKey: 'permMessageFederationDesc',
  },
  'federation:trust': {
    icon: FaLock,
    labelKey: 'permTrustFederation',
    descriptionKey: 'permTrustFederationDesc',
  },
  'federation:files': {
    icon: FaDownload,
    labelKey: 'permFederationFiles',
    descriptionKey: 'permFederationFilesDesc',
  },
}
