/**
 * 配置区块组件统一导出
 */

export { default as AboutConfigSection } from './AboutConfigSection'
export { AdvancedConfigSection } from './AdvancedConfigSection'
export { default as AiConfigSection } from './AiConfigSection'
export {
  areFederationPoliciesEqual,
  DEFAULT_FEDERATION_POLICY,
  default as FederationConfigSection,
  federationPolicyFromApi,
  federationPolicyToUpdateRequest,
} from './FederationConfigSection'
export type { FederationPolicyDraft } from './FederationConfigSection'
export {
  areLibrarySourcePreferencesEqual,
  DEFAULT_LIBRARY_SOURCE_PREFERENCES,
  default as ModuleConfigSection,
  normalizeLibraryPreferences,
} from './ModuleConfigSection'
export type { LibrarySourcePreferences } from './ModuleConfigSection'
export { default as NotificationConfigSection } from './NotificationConfigSection'
export { default as OAuthConfigSection } from './OAuthConfigSection'
export { default as PermissionsConfigSection } from './PermissionsConfigSection'
export { default as PlatformAutoRefreshSettings } from './PlatformAutoRefreshSettings'
export type { PlatformAutoFetchConfig } from './PlatformAutoRefreshSettings'
export { default as PlatformDataManagement } from './PlatformDataManagement'
export type { PlatformDataManagementProps } from './PlatformDataManagement'
export {
  default as PlatformsConfigSection,
  hasBangumiCredential,
  isBangumiPlatform,
  isPlatformConfigured,
  sanitizeMaskedFieldValue,
} from './PlatformsConfigSection'
export type {
  PlatformConfig,
  PlatformConfigField,
  PlatformsConfigSectionProps,
} from './PlatformsConfigSection'
export { default as UiConfigSection } from './UiConfigSection'
export { UpdaterInlinePanel } from './UpdaterConfigSection'
export { default as UsersConfigSection } from './UsersConfigSection'
