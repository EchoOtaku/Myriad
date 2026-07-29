import type {
  NotificationEventDefinition,
  NotificationPreferences,
  NotificationSourceKey,
} from '../services/notificationPreferencesApi'
import type { ModuleVisibilityPreferences } from '../utils/moduleVisibility'
import type { OAuthSettings } from '../utils/oauthSettings'
import type { HitokotoConfig } from '../utils/quote'
import type { ReportSettings } from '../utils/reportSettings'
import type {
  LibrarySourcePreferences,
  PlatformAutoFetchConfig,
} from './config'
import type { PermissionConfigValues } from './config/PermissionsConfigSection'
import type { SectionSwitchDirection } from './settings'
import type { ToastType } from './Toast'

import {
  FaExclamationTriangle,
  FaSearch,
  FaStar,
  FaTimes,
  LuChevronLeft,
  LuChevronRight,
  LuRefreshCw,
} from '@lib/icons'
import { motionShim as motion } from '@lib/motionShim'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { API_URL } from '../config'

import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../contexts/I18nContext'
import { useDebounce } from '../hooks/useDebounce'
import {
  checkSpeechStatus,
  fetchConfig,
  fetchPermissionsConfig,
  reloadSystemConfig,
  updateConfig,
  updatePermissionsConfig,
} from '../lib/api'
import apiService from '../services/api'
import notificationPreferencesApi, {
  areNotificationPreferencesEqual,
  cloneNotificationPreferences,
  DEFAULT_NOTIFICATION_CATALOG,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '../services/notificationPreferencesApi'
import { getCSRFToken } from '../utils/csrf'
import {
  areModuleVisibilityPreferencesEqual,
  DEFAULT_MODULE_VISIBILITY_PREFERENCES,
  dispatchModuleVisibilityPreferencesUpdated,
  fetchModuleVisibilityPreferences,
  normalizeModuleVisibilityPreferences,
  updateModuleVisibilityPreferences,
} from '../utils/moduleVisibility'
import {
  areOAuthSettingsEqual,
  cloneOAuthSettings,
  DEFAULT_OAUTH_SETTINGS,
  fetchOAuthSettings,
  updateOAuthSettings,
} from '../utils/oauthSettings'
import {
  areHitokotoConfigsEqual,
  DEFAULT_HITOKOTO_CONFIG,
  fetchHitokotoConfig,
  updateHitokotoConfig,
} from '../utils/quote'
import {
  areReportSettingsEqual,
  DEFAULT_REPORT_SETTINGS,
  fetchReportSettings,
  updateReportSettings,
} from '../utils/reportSettings'
import { deepEqual } from '../utils/deepEqual'
import { clearDedupCache } from '../utils/requestDedup'
import {
  AboutConfigSection,
  AdvancedConfigSection,
  AiConfigSection,
  areFederationPoliciesEqual,
  areLibrarySourcePreferencesEqual,
  DEFAULT_FEDERATION_POLICY,
  DEFAULT_LIBRARY_SOURCE_PREFERENCES,
  FederationConfigSection,
  federationPolicyFromApi,
  federationPolicyToUpdateRequest,
  hasBangumiCredential,
  isBangumiPlatform,
  ModuleConfigSection,
  normalizeLibraryPreferences,
  NotificationConfigSection,
  OAuthConfigSection,
  PermissionsConfigSection,
  PlatformsConfigSection,
  sanitizeMaskedFieldValue,
  UiConfigSection,
  UsersConfigSection,
} from './config'
import type { FederationPolicyDraft } from './config'
import { federationApi } from '../services/federationApi'
import MyriadConfigIcon from './config/MyriadConfigIcon'
import {
  SectionSwitch,
  SETTINGS_PAGE_MOTION,
  SETTINGS_SIDEBAR_MOTION,
  SettingsButton,
  SettingsPageActionsProvider,
} from './settings'
import { Spinner } from './Spinner'
import Toast from './Toast'
import './ConfigForm.css'

// 导入迁移后的配置区块组件

interface ConfigField {
  key: string
  label: string
  field_type: string
  value: string
  placeholder: string
  required: boolean
}

interface PlatformConfig {
  name: string
  enabled: boolean
  has_token: boolean
  config_fields: ConfigField[]
  description: string
  icon: string
}

interface AiConfig {
  provider: string
  model: string
  api_key: string
  enabled: boolean
  // AI 图片生成配置
  image_provider: string
  config_fields: ConfigField[]
}

interface ReportConfig {
  topic_style: string
  config_fields: ConfigField[]
}

interface UiConfig {
  wallpaper_url: string
  wallpaper_blur: number
  theme: string
  primary_color: string
  secondary_color: string
  config_fields: ConfigField[]
}

interface Config {
  platforms: PlatformConfig[]
  auto_fetch: PlatformAutoFetchConfig
  ai_config: AiConfig
  report_config: ReportConfig
  ui_config: UiConfig
}

interface QuickAccessItem {
  id: string
  label: string
  /** Page header description (source of truth; not from search aliases). */
  description: string
  icon: React.ReactNode
  section: string
  subsection?: string
}

interface SaveLibrarySourcePreferencesResponse {
  success: boolean
  preferences?: LibrarySourcePreferences
  message?: string
}

const DEFAULT_PERMISSION_CONFIG: PermissionConfigValues = {
  user_perm_ai_generate: false,
  user_perm_ai_analyze: false,
  user_perm_ai_chat: false,
  user_perm_report_write: false,
  user_perm_network_fetch: false,
  user_perm_component_theme: false,
  user_perm_shortcut_register: false,
  user_perm_event_publish: false,
  user_perm_ai_image: false,
  user_perm_scheduler_register: false,
  user_perm_speech_tts: false,
  user_perm_speech_asr: false,
  guest_perm_ai_generate: false,
  guest_perm_ai_analyze: false,
  guest_perm_ai_chat: false,
  guest_perm_report_write: false,
  guest_perm_network_fetch: false,
  guest_perm_component_theme: false,
  guest_perm_shortcut_register: false,
  guest_perm_event_publish: false,
  guest_perm_ai_image: false,
  guest_perm_scheduler_register: false,
  guest_perm_speech_tts: false,
  guest_perm_speech_asr: false,
  user_ai_daily_calls: 50,
  user_ai_daily_tokens: 20000,
  user_ai_cooldown_seconds: 5,
  guest_ai_daily_calls: 10,
  guest_ai_daily_tokens: 5000,
  guest_ai_cooldown_seconds: 10,
}

const DEFAULT_CONFIG_FAVORITES = ['platforms', 'ai']
const DEFAULT_AUTO_FETCH_CONFIG: PlatformAutoFetchConfig = {
  enabled: false,
  interval_hours: 24,
}

/** Retired config nav ids remapped when restoring favorites / deep links / search. */
const LEGACY_CONFIG_SECTION_MAP: Record<string, string> = {
  music: 'modules',
  /** Standalone data-management page removed; alias lands on platforms list. */
  data: 'platforms',
  network: 'advanced',
}

function loadConfigFavorites(): string[] {
  if (typeof window === 'undefined') return DEFAULT_CONFIG_FAVORITES
  try {
    const saved = localStorage.getItem('config_favorites')
    if (!saved) return DEFAULT_CONFIG_FAVORITES
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      return DEFAULT_CONFIG_FAVORITES
    }
    return [
      ...new Set(
        (parsed as string[]).map((id) => LEGACY_CONFIG_SECTION_MAP[id] ?? id),
      ),
    ]
  } catch {
    return DEFAULT_CONFIG_FAVORITES
  }
}

// 优化：提取为独立的 memo 组件避免不必要的重渲染
interface ConfigNavItemProps {
  item: QuickAccessItem
  isActive: boolean
  isFavorite: boolean
  /** 'all' 组里已收藏的行在桌面端由 CSS 隐藏（收藏组已列出），移动端滑轨仍需要它 */
  group: 'all' | 'favorites'
  onSelect: (section: string) => void
  onToggleFavorite: (id: string) => void
}

/** 侧边栏一行：图标 + 名称 + 收藏星（整行可点，星单独可点） */
const ConfigNavItem = React.memo<ConfigNavItemProps>(
  ({ item, isActive, isFavorite, group, onSelect, onToggleFavorite }) => {
    const handleSelect = React.useCallback(() => {
      onSelect(item.section)
    }, [onSelect, item.section])

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        handleSelect()
      },
      [handleSelect],
    )

    const handleFavoriteClick = React.useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        onToggleFavorite(item.id)
      },
      [onToggleFavorite, item.id],
    )

    return (
      <div
        role="button"
        tabIndex={0}
        aria-current={isActive ? 'page' : undefined}
        title={item.description}
        onClick={handleSelect}
        onKeyDown={handleKeyDown}
        className={`config-nav-item${isActive ? ' is-active' : ''}${
          group === 'all' && isFavorite ? ' is-pinned' : ''
        }`}
      >
        <span className="config-nav-item-icon">{item.icon}</span>
        <span className="config-nav-item-label">{item.label}</span>
        <button
          type="button"
          onClick={handleFavoriteClick}
          aria-pressed={isFavorite}
          className={`config-nav-item-star${isFavorite ? ' is-active' : ''}`}
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <FaStar />
        </button>
        <span className="config-nav-item-chevron" aria-hidden>
          <LuChevronRight size={16} />
        </span>
      </div>
    )
  },
)

ConfigNavItem.displayName = 'ConfigNavItem'

const ModernConfigForm: React.FC = () => {
  const { t } = useI18n()
  const { user, isAdmin } = useAuth()
  const [config, setConfig] = useState<Config | null>(null)
  const [initialConfig, setInitialConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<ToastType>('info')
  const [activeSection, setActiveSection] = useState<string>('platforms')
  /** 分类切换动效方向（按侧边栏顺序） */
  const [sectionDir, setSectionDir] =
    useState<SectionSwitchDirection>('forward')
  /**
   * 移动端分层：nav = 一级分类列表；section = 二级内容（平台详情为三级，在区块内）。
   * 桌面端双栏同显，此状态仅影响 <1024px。
   */
  const [mobilePane, setMobilePane] = useState<'nav' | 'section'>('nav')
  const [isMobileLayout, setIsMobileLayout] = useState(false)
  /** 外部深链打开某平台二级页（如 Discord OAuth 回调） */
  const [platformFocus, setPlatformFocus] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(loadConfigFavorites)
  const [savedFavorites, setSavedFavorites] =
    useState<string[]>(loadConfigFavorites)

  // Tapp 权限下放配置状态（13 项 elevated 权限 × 2 角色 + AI 限额配置）
  const [permissionConfig, setPermissionConfig] =
    useState<PermissionConfigValues>(DEFAULT_PERMISSION_CONFIG)
  const [savedPermissionConfig, setSavedPermissionConfig] =
    useState<PermissionConfigValues>(DEFAULT_PERMISSION_CONFIG)
  const [permissionLoading, setPermissionLoading] = useState(false)
  const [notificationDraft, setNotificationDraft] =
    useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES)
  const [savedNotificationPreferences, setSavedNotificationPreferences] =
    useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES)
  const [notificationSources, setNotificationSources] = useState<
    NotificationSourceKey[]
  >(DEFAULT_NOTIFICATION_CATALOG.sources)
  const [notificationEvents, setNotificationEvents] = useState<
    NotificationEventDefinition[]
  >(DEFAULT_NOTIFICATION_CATALOG.events)
  const [notificationLoading, setNotificationLoading] = useState(false)
  const [oauthDraft, setOAuthDraft] = useState<OAuthSettings>(
    DEFAULT_OAUTH_SETTINGS,
  )
  const [savedOAuthSettings, setSavedOAuthSettings] = useState<OAuthSettings>(
    DEFAULT_OAUTH_SETTINGS,
  )
  const [oauthLoading, setOAuthLoading] = useState(false)
  const [librarySourceDraft, setLibrarySourceDraft] =
    useState<LibrarySourcePreferences>(DEFAULT_LIBRARY_SOURCE_PREFERENCES)
  const [savedLibrarySourcePreferences, setSavedLibrarySourcePreferences] =
    useState<LibrarySourcePreferences>(DEFAULT_LIBRARY_SOURCE_PREFERENCES)
  const [librarySourceSaveRevision, setLibrarySourceSaveRevision] = useState(0)
  const [moduleVisibilityDraft, setModuleVisibilityDraft] =
    useState<ModuleVisibilityPreferences>(DEFAULT_MODULE_VISIBILITY_PREFERENCES)
  const [
    savedModuleVisibilityPreferences,
    setSavedModuleVisibilityPreferences,
  ] = useState<ModuleVisibilityPreferences>(
    DEFAULT_MODULE_VISIBILITY_PREFERENCES,
  )
  const [hitokotoDraft, setHitokotoDraft] = useState<HitokotoConfig>(
    DEFAULT_HITOKOTO_CONFIG,
  )
  const [savedHitokotoConfig, setSavedHitokotoConfig] =
    useState<HitokotoConfig>(DEFAULT_HITOKOTO_CONFIG)
  const [reportSettingsDraft, setReportSettingsDraft] =
    useState<ReportSettings>(DEFAULT_REPORT_SETTINGS)
  const [savedReportSettings, setSavedReportSettings] =
    useState<ReportSettings>(DEFAULT_REPORT_SETTINGS)
  const [federationPolicyDraft, setFederationPolicyDraft] =
    useState<FederationPolicyDraft>(DEFAULT_FEDERATION_POLICY)
  const [savedFederationPolicy, setSavedFederationPolicy] =
    useState<FederationPolicyDraft>(DEFAULT_FEDERATION_POLICY)

  const showMessage = useCallback(
    (nextMessage: string, nextType: ToastType = 'info', duration = 3000) => {
      setMessageType(nextType)
      setMessage(nextMessage)
      if (duration > 0) {
        window.setTimeout(setMessage, duration, '')
      }
    },
    [],
  )

  // 所有设置项只更新草稿；实际写入统一由 handleSave 完成。
  const updatePermissionConfig = useCallback(
    (
      keyOrPatch: string | Record<string, boolean | number>,
      value?: boolean | number,
    ) => {
      const patch: Record<string, boolean | number> =
        typeof keyOrPatch === 'string'
          ? { [keyOrPatch]: value as boolean | number }
          : keyOrPatch

      setPermissionConfig((prev) => ({ ...prev, ...patch }))
    },
    [],
  )

  // 加载权限配置
  const loadPermissionConfig = useCallback(async () => {
    try {
      setPermissionLoading(true)
      const response = await fetchPermissionsConfig()

      if (response.success && response.config) {
        const { guest, user, user_ai_quota, guest_ai_quota } = response.config
        const loaded: PermissionConfigValues = {
          // 普通用户权限
          user_perm_ai_generate: user.ai_generate,
          user_perm_ai_analyze: user.ai_analyze,
          user_perm_ai_chat: user.ai_chat,
          user_perm_report_write: user.report_write,
          user_perm_network_fetch: user.network_fetch,
          user_perm_component_theme: user.component_theme,
          user_perm_shortcut_register: user.shortcut_register,
          user_perm_event_publish: user.event_publish,
          user_perm_ai_image: user.ai_image,
          user_perm_scheduler_register: user.scheduler_register,
          user_perm_speech_tts: user.speech_tts,
          user_perm_speech_asr: user.speech_asr,
          // 游客权限
          guest_perm_ai_generate: guest.ai_generate,
          guest_perm_ai_analyze: guest.ai_analyze,
          guest_perm_ai_chat: guest.ai_chat,
          guest_perm_report_write: guest.report_write,
          guest_perm_network_fetch: guest.network_fetch,
          guest_perm_component_theme: guest.component_theme,
          guest_perm_shortcut_register: guest.shortcut_register,
          guest_perm_event_publish: guest.event_publish,
          guest_perm_ai_image: guest.ai_image,
          guest_perm_scheduler_register: guest.scheduler_register,
          guest_perm_speech_tts: guest.speech_tts,
          guest_perm_speech_asr: guest.speech_asr,
          // AI 使用限额配置
          user_ai_daily_calls: user_ai_quota?.daily_calls ?? 50,
          user_ai_daily_tokens: user_ai_quota?.daily_tokens ?? 20000,
          user_ai_cooldown_seconds: user_ai_quota?.cooldown_seconds ?? 5,
          guest_ai_daily_calls: guest_ai_quota?.daily_calls ?? 10,
          guest_ai_daily_tokens: guest_ai_quota?.daily_tokens ?? 5000,
          guest_ai_cooldown_seconds: guest_ai_quota?.cooldown_seconds ?? 10,
        }
        setPermissionConfig(loaded)
        setSavedPermissionConfig(loaded)
      }
    } catch (error) {
      console.error('Failed to load permissions:', error)
    } finally {
      setPermissionLoading(false)
    }
  }, [])

  const loadNotificationSettings = useCallback(async () => {
    try {
      setNotificationLoading(true)
      const response = await notificationPreferencesApi.get()
      const loaded = cloneNotificationPreferences(response.preferences)
      setNotificationDraft(loaded)
      setSavedNotificationPreferences(cloneNotificationPreferences(loaded))
      setNotificationSources(response.catalog.sources)
      setNotificationEvents(response.catalog.events)
    } catch (error) {
      console.error('Failed to load notification settings:', error)
      showMessage(t.config.loadConfigFailed, 'error')
    } finally {
      setNotificationLoading(false)
    }
  }, [showMessage, t])

  const loadFederationPolicy = useCallback(async () => {
    if (!isAdmin) return
    try {
      const p = await federationApi.getTrustPolicy()
      const draft = federationPolicyFromApi(p)
      setFederationPolicyDraft(draft)
      setSavedFederationPolicy(draft)
    } catch (error) {
      console.error('Failed to load federation trust policy:', error)
    }
  }, [isAdmin])

  const updateFederationPolicy = useCallback(
    (patch: Partial<FederationPolicyDraft>) => {
      setFederationPolicyDraft((prev) => ({ ...prev, ...patch }))
    },
    [],
  )

  const loadOAuthSettings = useCallback(async () => {
    try {
      setOAuthLoading(true)
      const loaded = await fetchOAuthSettings()
      setOAuthDraft(cloneOAuthSettings(loaded))
      setSavedOAuthSettings(cloneOAuthSettings(loaded))
    } catch (error) {
      console.error('Failed to load OAuth settings:', error)
      showMessage(t.config.loadConfigFailed, 'error')
    } finally {
      setOAuthLoading(false)
    }
  }, [showMessage, t])

  // 获取翻译后的字段标签（覆盖后端返回的标签）
  const getFieldLabel = useCallback(
    (fieldKey: string, originalLabel: string): string => {
      const fieldLabels: Record<string, string> = {
        wallpaper_url: t.config.fieldWallpaperUrl,
        wallpaper_blur: t.config.fieldWallpaperBlur,
        wallpaper_parallax: t.config.fieldWallpaperParallax,
        pet_enabled: t.config.fieldPetEnabled,
        pet_image_url: t.config.fieldPetImageUrl,
        site_title: t.config.fieldSiteTitle,
        site_description: t.config.fieldSiteDescription,
        site_favicon: t.config.fieldSiteFavicon,
        music_enabled: t.config.fieldMusicEnabled,
        music_source: t.config.fieldMusicSource,
        music_playlist_id: t.config.fieldMusicPlaylistId,
      }
      return fieldLabels[fieldKey] || originalLabel
    },
    [t],
  )

  // 获取翻译后的占位符
  const getFieldPlaceholder = useCallback(
    (fieldKey: string, originalPlaceholder: string): string => {
      const placeholders: Record<string, string> = {
        wallpaper_url: t.config.placeholderWallpaperUrl,
        site_title: t.config.placeholderSiteTitle,
        site_description: t.config.placeholderSiteDescription,
        site_favicon: t.config.placeholderSiteFavicon,
        pet_image_url: t.config.placeholderPetImageUrl,
      }
      return placeholders[fieldKey] || originalPlaceholder
    },
    [t],
  )

  // 使用防抖优化搜索性能 - 避免频繁搜索
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  // 快速访问项（使用 useMemo 避免每次渲染重新创建数组）
  const quickAccessItems: QuickAccessItem[] = useMemo(
    () => [
      {
        id: 'platforms',
        label: t.config.platforms,
        description: t.config.platformsDesc,
        icon: <MyriadConfigIcon kind="platforms" />,
        section: 'platforms',
      },
      {
        id: 'ai',
        label: t.config.ai,
        description: t.config.aiDesc,
        icon: <MyriadConfigIcon kind="ai" />,
        section: 'ai',
      },
      {
        id: 'ui',
        label: t.config.basic,
        description: t.config.basicDesc,
        icon: <MyriadConfigIcon kind="ui" />,
        section: 'ui',
      },
      {
        id: 'oauth',
        label: t.config.oauth,
        description: t.config.oauthDesc,
        icon: <MyriadConfigIcon kind="oauth" />,
        section: 'oauth',
      },
      ...(isAdmin
        ? [
            {
              id: 'federation',
              label: t.config.federation,
              description: t.config.federationDesc,
              icon: <MyriadConfigIcon kind="federation" />,
              section: 'federation',
            },
          ]
        : []),
      {
        id: 'permissions',
        label: t.config.permissions,
        description: t.config.permissionsDesc,
        icon: <MyriadConfigIcon kind="permissions" />,
        section: 'permissions',
      },
      {
        id: 'users',
        label: t.config.users,
        description: t.config.usersDesc,
        icon: <MyriadConfigIcon kind="users" />,
        section: 'users',
      },
      {
        id: 'notifications',
        label: t.notificationCenter.title,
        description: t.notificationCenter.settingsDesc,
        icon: <MyriadConfigIcon kind="notifications" />,
        section: 'notifications',
      },
      {
        id: 'modules',
        label: t.config.moduleSettings,
        description: t.config.moduleSettingsDesc,
        icon: <MyriadConfigIcon kind="modules" />,
        section: 'modules',
      },
      {
        id: 'advanced',
        label: t.config.advanced,
        description: t.config.advancedDesc,
        icon: <MyriadConfigIcon kind="advanced" />,
        section: 'advanced',
      },
      {
        id: 'about',
        label: t.config.about,
        description: t.config.aboutDesc,
        icon: <MyriadConfigIcon kind="about" />,
        section: 'about',
      },
    ],
    [t, isAdmin],
  )

  // 搜索功能
  const searchableContent = useMemo(() => {
    if (!config) return []

    const items: Array<{
      type: string
      section: string
      title: string
      description: string
      keywords: string[]
    }> = []

    // 平台配置 - 区块描述
    items.push({
      type: 'section',
      section: 'platforms',
      title: t.config.platforms,
      description: t.config.platformsDesc,
      keywords: [
        '平台',
        '数据源',
        'token',
        'api',
        'github',
        'bilibili',
        'bangumi',
        'steam',
        'netease',
        'myanimelist',
        'mal',
        '数据管理',
        '缓存',
        '刷新',
      ],
    })

    // 数据管理已迁入各平台二级页，搜索结果回到平台列表。
    items.push({
      type: 'section',
      section: 'platforms',
      title: t.config.data,
      description: t.config.dataDesc,
      keywords: [
        '数据管理',
        'data',
        '缓存',
        'cache',
        '过滤',
        '智能过滤',
        '刷新',
      ],
    })

    // 平台配置 - 各平台
    config.platforms.forEach((platform) => {
      items.push({
        type: 'platform',
        section: 'platforms',
        title: platform.name,
        description: platform.description,
        keywords: [
          platform.name.toLowerCase(),
          '平台',
          '数据源',
          'token',
          'api',
        ],
      })
    })

    // AI配置
    items.push({
      type: 'section',
      section: 'ai',
      title: t.config.ai,
      description: t.config.aiDesc,
      keywords: [
        'ai',
        'gemini',
        'openai',
        'api',
        '模型',
        '智能',
        '图片',
        '生成',
        'image',
      ],
    })

    // UI配置（含站点地址 / 更换域名）
    items.push({
      type: 'section',
      section: 'ui',
      title: t.config.basic,
      description: t.config.basicDesc,
      keywords: [
        'basic',
        '基础',
        '站点',
        '主题',
        '背景',
        '样式',
        'theme',
        'url',
        'domain',
        '域名',
        '更换域名',
        'base_url',
        'cors',
        'origin',
      ],
    })

    // OAuth配置
    items.push({
      type: 'section',
      section: 'oauth',
      title: t.config.oauth,
      description: t.config.oauthDesc,
      keywords: ['oauth', 'github', '登录', 'auth', '认证'],
    })

    // 搜索别名：跳转到已并入的正式页（type=alias，不得用于页头说明）
    items.push({
      type: 'alias',
      section: 'modules',
      title: t.config.music,
      description: t.config.musicDesc,
      keywords: ['音乐', 'music', '歌单', '播放器', '网易云', 'qq音乐'],
    })

    items.push({
      type: 'alias',
      section: 'advanced',
      title: t.config.network,
      description: t.config.networkDesc,
      keywords: [
        'proxy',
        '代理',
        '网络',
        'gemini',
        'github',
        'api',
        '镜像',
        'mirror',
        'socks',
        'network',
      ],
    })

    // 高级配置
    items.push({
      type: 'section',
      section: 'notifications',
      title: t.notificationCenter.title,
      description: t.notificationCenter.settingsDesc,
      keywords: [
        'notification',
        '通知',
        '提醒',
        'toast',
        'browser',
        'arael',
        'brew',
        'tapp',
        'mcp',
        'aro',
      ],
    })

    // 高级配置
    items.push({
      type: 'section',
      section: 'advanced',
      title: t.config.advanced,
      description: t.config.advancedDesc,
      keywords: [
        'advanced',
        '高级',
        'danger',
        'reset',
        '重置',
        '危险',
        'proxy',
        '代理',
        '导入',
        '导出',
      ],
    })

    // 关于（含 updater 管理内联面板）
    items.push({
      type: 'section',
      section: 'about',
      title: t.config.about,
      description: t.config.aboutDesc,
      keywords: [
        'about',
        '关于',
        '版本',
        'version',
        'logo',
        'myriad',
        // updater 关键字也指向 about section（updater 已合并进关于页）
        'updater',
        '更新',
        'update',
        'upgrade',
        '升级',
        '回滚',
        'rollback',
        'snapshot',
        '快照',
      ],
    })

    // 权限管理
    items.push({
      type: 'section',
      section: 'permissions',
      title: t.config.permissions,
      description: t.config.permissionsDesc,
      keywords: [
        '权限',
        'permission',
        'elevated',
        '下放',
        '配额',
        'quota',
        'ai',
        '游客',
        'guest',
      ],
    })

    // 用户管理
    items.push({
      type: 'section',
      section: 'users',
      title: t.config.users,
      description: t.config.usersDesc,
      keywords: [
        '用户',
        'user',
        'users',
        '管理员',
        'admin',
        'oauth',
        '账户',
        'account',
        '在线',
        'online',
        '注册',
        'register',
        'identity',
        '绑定',
      ],
    })

    // 联邦信任（仅管理员侧栏出现，搜索仍可匹配）
    items.push({
      type: 'section',
      section: 'federation',
      title: t.config.federation,
      description: t.config.federationDesc,
      keywords: [
        'federation',
        '联邦',
        'trust',
        '信任',
        'allowlist',
        '白名单',
        'block',
        '封禁',
        'filter',
        '过滤',
        'mfp',
        'aro',
      ],
    })

    // 模块设置
    items.push({
      type: 'section',
      section: 'modules',
      title: t.config.moduleSettings,
      description: t.config.moduleSettingsDesc,
      keywords: [
        '模块',
        'module',
        '资料库',
        'library',
        '来源',
        'source',
        '平台',
        '分类',
        '可见性',
        'visibility',
        '登录用户',
        '管理员',
        '一言',
        'hitokoto',
        'quote',
      ],
    })

    return items
  }, [config, t])

  // 使用防抖后的搜索查询优化性能
  const filteredContent = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return searchableContent

    const query = debouncedSearchQuery.toLowerCase()
    return searchableContent.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.keywords.some((k) => k.includes(query)),
    )
  }, [debouncedSearchQuery, searchableContent])

  // 切换收藏
  const toggleFavorite = React.useCallback((section: string) => {
    setFavorites((prev) => {
      return prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section]
    })
  }, [])

  // 移动端断点与桌面 CSS（1024px）对齐
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const mq = window.matchMedia('(max-width: 1023px)')
    const sync = () => setIsMobileLayout(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // 处理节切换
  const handleSectionChange = React.useCallback(
    (section: string) => {
      const next = LEGACY_CONFIG_SECTION_MAP[section] ?? section
      // 切换方向按侧边栏里的先后顺序：往下选 = forward，往上 = back
      const order = quickAccessItems.map((item) => item.section)
      const from = order.indexOf(activeSection)
      const to = order.indexOf(next)
      setSectionDir(from >= 0 && to >= 0 && to < from ? 'back' : 'forward')

      setActiveSection(next)
      setSearchQuery('')
      setPlatformFocus(null)
      // 移动端进入二级内容页
      setMobilePane('section')
    },
    [quickAccessItems, activeSection],
  )

  /**
   * 换分类 = 换页：滚动位置归零。
   * 在新分类换上的那一帧做（旧页已淡出），所以看不到跳动；
   * 不归零的话，从长分类滚到一半切到短分类，粘顶侧栏会突然弹位。
   * 用 'auto' 覆盖全局 scroll-behavior: smooth——切换过程中再来一段平滑滚动只会更乱。
   */
  const scrollSettingsToTop = React.useCallback(() => {
    if (typeof window === 'undefined') return
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  const handleMobileBackToNav = React.useCallback(() => {
    setMobilePane('nav')
    setPlatformFocus(null)
    scrollSettingsToTop()
  }, [scrollSettingsToTop])

  const notifyDirtyState = React.useCallback((dirty: boolean) => {
    window.dispatchEvent(
      new CustomEvent('config-dirty-state', {
        detail: { dirty },
      }),
    )
  }, [])

  const handleLibrarySourcePreferencesLoaded = React.useCallback(
    (
      preferences: LibrarySourcePreferences,
      options: { resetDraft?: boolean } = {},
    ) => {
      const normalized = normalizeLibraryPreferences(preferences)
      setSavedLibrarySourcePreferences(normalized)
      if (options.resetDraft) {
        setLibrarySourceDraft(normalized)
      }
    },
    [],
  )

  const saveLibrarySourcePreferences = React.useCallback(async () => {
    const saved = await apiService.put<SaveLibrarySourcePreferencesResponse>(
      '/library/preferences',
      librarySourceDraft,
    )
    if (!saved.success) {
      throw new Error(saved.message || t.config.librarySourceSaveFailed)
    }

    const preferences = normalizeLibraryPreferences(saved.preferences)
    setLibrarySourceDraft(preferences)
    setSavedLibrarySourcePreferences(preferences)
    setLibrarySourceSaveRevision((revision) => revision + 1)
    clearDedupCache(`${API_URL}/api/library`)
  }, [librarySourceDraft, t])

  const loadModuleVisibilityPreferences = React.useCallback(async () => {
    try {
      const preferences = await fetchModuleVisibilityPreferences()
      setSavedModuleVisibilityPreferences(preferences)
      setModuleVisibilityDraft(preferences)
    } catch {
      showMessage(t.config.moduleVisibilityLoadFailed, 'error')
    }
  }, [showMessage, t])

  const saveModuleVisibilityPreferences = React.useCallback(async () => {
    const saved = await updateModuleVisibilityPreferences(moduleVisibilityDraft)
    const preferences = normalizeModuleVisibilityPreferences(saved)
    setModuleVisibilityDraft(preferences)
    setSavedModuleVisibilityPreferences(preferences)
    dispatchModuleVisibilityPreferencesUpdated(preferences)
  }, [moduleVisibilityDraft])

  const handleModuleMessage = React.useCallback(
    (msg: string, type: ToastType = 'info') => showMessage(msg, type),
    [showMessage],
  )

  const loadHitokotoSettings = React.useCallback(async () => {
    try {
      const config = await fetchHitokotoConfig()
      setSavedHitokotoConfig(config)
      setHitokotoDraft(config)
    } catch {
      showMessage(t.config.hitokotoLoadFailed, 'error')
    }
  }, [showMessage, t])

  const saveHitokotoDraft = React.useCallback(async () => {
    const saved = await updateHitokotoConfig(hitokotoDraft)
    setHitokotoDraft(saved)
    setSavedHitokotoConfig(saved)
  }, [hitokotoDraft])

  const loadReportSettings = React.useCallback(async () => {
    try {
      const settings = await fetchReportSettings()
      setSavedReportSettings(settings)
      setReportSettingsDraft(settings)
    } catch {
      showMessage(t.config.reportSettingsLoadFailed, 'error')
    }
  }, [showMessage, t])

  const saveReportSettingsDraft = React.useCallback(async () => {
    const saved = await updateReportSettings(reportSettingsDraft)
    setReportSettingsDraft(saved)
    setSavedReportSettings(saved)
  }, [reportSettingsDraft])

  const handleSave = React.useCallback(async () => {
    if (!config) {
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: { success: false, message: t.config.configEmpty },
        }),
      )
      return
    }

    const hasConfigChanges =
      Boolean(initialConfig) && !deepEqual(config, initialConfig)
    const hasLibrarySourceChanges = !areLibrarySourcePreferencesEqual(
      librarySourceDraft,
      savedLibrarySourcePreferences,
    )
    const hasModuleVisibilityChanges = !areModuleVisibilityPreferencesEqual(
      moduleVisibilityDraft,
      savedModuleVisibilityPreferences,
    )
    const hasHitokotoChanges = !areHitokotoConfigsEqual(
      hitokotoDraft,
      savedHitokotoConfig,
    )
    const hasReportSettingsChanges = !areReportSettingsEqual(
      reportSettingsDraft,
      savedReportSettings,
    )
    const hasPermissionChanges = !deepEqual(
      permissionConfig,
      savedPermissionConfig,
    )
    const hasNotificationChanges = !areNotificationPreferencesEqual(
      notificationDraft,
      savedNotificationPreferences,
    )
    const hasOAuthChanges = !areOAuthSettingsEqual(
      oauthDraft,
      savedOAuthSettings,
    )
    const hasFederationChanges =
      isAdmin &&
      !areFederationPoliciesEqual(federationPolicyDraft, savedFederationPolicy)
    const hasFavoriteChanges = !deepEqual(favorites, savedFavorites)

    if (
      !hasConfigChanges &&
      !hasLibrarySourceChanges &&
      !hasModuleVisibilityChanges &&
      !hasHitokotoChanges &&
      !hasReportSettingsChanges &&
      !hasPermissionChanges &&
      !hasNotificationChanges &&
      !hasOAuthChanges &&
      !hasFederationChanges &&
      !hasFavoriteChanges
    ) {
      notifyDirtyState(false)
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: { success: true, message: t.config.configSaved },
        }),
      )
      return
    }

    const invalidBangumi = hasConfigChanges
      ? config.platforms.find(
          (platform) =>
            platform.enabled &&
            isBangumiPlatform(platform) &&
            !hasBangumiCredential(platform),
        )
      : undefined
    if (invalidBangumi) {
      showMessage(t.config.bangumiCredentialMissing, 'error', 0)
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: {
            success: false,
            message: t.config.bangumiCredentialMissing,
          },
        }),
      )
      return
    }

    showMessage(t.config.savingConfig, 'info', 0)
    setSaving(true)

    try {
      let resultMessage = t.config.configSaved

      if (hasConfigChanges) {
        // 获取 CSRF Token（stale sessionStorage / backend restart）
        await getCSRFToken(true)

        // updateConfig throws on HTTP >= 400 or success !== true (incl. CSRF after retry)
        const result = await updateConfig(config)
        if (result?.success === false) {
          throw new Error(result.message || t.config.configSaveFailed)
        }
        resultMessage = result.message || t.config.configSaved
        // Only mark draft clean after a confirmed successful write
        setInitialConfig(JSON.parse(JSON.stringify(config)))
      }

      if (hasLibrarySourceChanges) {
        await saveLibrarySourcePreferences()
        resultMessage = hasConfigChanges
          ? resultMessage
          : t.config.librarySourceSaved
      }

      if (hasModuleVisibilityChanges) {
        await saveModuleVisibilityPreferences()
        resultMessage = hasConfigChanges
          ? resultMessage
          : t.config.moduleVisibilitySaved
      }

      if (hasHitokotoChanges) {
        await saveHitokotoDraft()
        resultMessage = hasConfigChanges
          ? resultMessage
          : t.config.hitokotoSaved
      }

      if (hasReportSettingsChanges) {
        await saveReportSettingsDraft()
        resultMessage = hasConfigChanges
          ? resultMessage
          : t.config.reportSettingsSaved
      }

      if (hasPermissionChanges) {
        await getCSRFToken(true)
        const patch = Object.fromEntries(
          Object.entries(permissionConfig).filter(
            ([key, value]) => savedPermissionConfig[key] !== value,
          ),
        )
        const response = await updatePermissionsConfig(patch)
        if (!response.success) {
          throw new Error(response.message || t.config.permissionsSaveFailed)
        }
        setSavedPermissionConfig({ ...permissionConfig })
        const { TappRuntime } = await import('../tapp/runtime/TappRuntime')
        await TappRuntime.getInstance().refreshPermissionGrants()
        resultMessage = hasConfigChanges
          ? resultMessage
          : t.config.permissionsSaved
      }

      if (hasNotificationChanges) {
        const saved = await notificationPreferencesApi.update(
          notificationDraft,
          user?.id,
        )
        const normalized = cloneNotificationPreferences(saved)
        setNotificationDraft(normalized)
        setSavedNotificationPreferences(
          cloneNotificationPreferences(normalized),
        )
      }

      if (hasOAuthChanges) {
        const saved = await updateOAuthSettings(oauthDraft)
        setOAuthDraft(cloneOAuthSettings(saved))
        setSavedOAuthSettings(cloneOAuthSettings(saved))
      }

      if (hasFederationChanges) {
        await federationApi.updateTrustPolicy(
          federationPolicyToUpdateRequest(federationPolicyDraft),
        )
        setSavedFederationPolicy({ ...federationPolicyDraft })
        resultMessage = hasConfigChanges
          ? resultMessage
          : t.config.federationPolicySaved
      }

      if (hasFavoriteChanges) {
        localStorage.setItem('config_favorites', JSON.stringify(favorites))
        setSavedFavorites([...favorites])
      }

      notifyDirtyState(false)
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: {
            success: true,
            message: resultMessage,
          },
        }),
      )

      if (!hasConfigChanges) {
        showMessage(resultMessage, 'success', 3000)
        return
      }

      showMessage(
        `${t.config.configSaved} ${t.config.refreshing}`,
        'success',
        0,
      )

      try {
        // reload-config 也需要 CSRF Token
        await getCSRFToken(true)
        await reloadSystemConfig()

        showMessage(t.config.savedSuccess, 'success', 0)

        // 等待后端完成配置保存和环境变量重新加载，然后刷新页面
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      } catch (_restartError) {
        showMessage(t.config.savedSuccess, 'success', 0)
        // 即使刷新配置失败，仍然刷新页面以应用数据库中的新配置
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      }
    } catch (error) {
      const errorMsg = `${t.config.configSaveFailed}: ${error instanceof Error ? error.message : t.errors.networkError}`
      showMessage(errorMsg, 'error', 0)
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: { success: false, message: errorMsg },
        }),
      )
    } finally {
      setSaving(false)
    }
  }, [
    config,
    initialConfig,
    librarySourceDraft,
    moduleVisibilityDraft,
    hitokotoDraft,
    notifyDirtyState,
    saveLibrarySourcePreferences,
    saveModuleVisibilityPreferences,
    saveHitokotoDraft,
    reportSettingsDraft,
    savedReportSettings,
    saveReportSettingsDraft,
    permissionConfig,
    savedPermissionConfig,
    notificationDraft,
    savedNotificationPreferences,
    oauthDraft,
    savedOAuthSettings,
    federationPolicyDraft,
    savedFederationPolicy,
    isAdmin,
    favorites,
    savedFavorites,
    user?.id,
    savedLibrarySourcePreferences,
    savedModuleVisibilityPreferences,
    savedHitokotoConfig,
    showMessage,
    t,
  ])

  const defaultAiFieldValue = React.useCallback((key: string) => {
    if (key === 'model') return 'gemini-3-flash-preview'
    if (key === 'ai_image_provider') return 'openrouter'
    if (key === 'ai_image_model') return 'openai/gpt-image-2'
    if (key === 'ai_image_openai_base_url') return 'https://api.openai.com/v1'
    if (key === 'ai_image_volcengine_base_url')
      return 'https://ark.cn-beijing.volces.com/api/v3'
    if (key === 'lite_enabled') return 'false'
    if (key === 'lite_provider') return 'openai'
    if (key === 'lite_openai_model') return 'openai/gpt-oss-20b:free'
    if (key === 'lite_openai_base_url') return 'https://openrouter.ai/api/v1'
    if (key === 'lite_gemini_model') return 'gemini-3.5-flash'
    if (key === 'pro_enabled') return 'false'
    return ''
  }, [])

  const defaultUiFieldValue = React.useCallback((key: string) => {
    if (key === 'wallpaper_url') {
      return 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809'
    }
    if (key === 'wallpaper_blur') return '3'
    if (key === 'music_enabled') return 'false'
    if (key === 'music_source') return 'netease'
    if (key === 'music_playlist_id') return ''
    if (key === 'proxy_enabled') return 'false'
    if (key === 'proxy_url') return ''
    if (key === 'proxy_bypass') return ''
    if (key === 'gemini_base_url') return ''
    if (key === 'github_api_base_url') return ''
    return ''
  }, [])

  const mapConfigFields = React.useCallback(
    (
      fields: ConfigField[],
      getDefault: (key: string) => string,
      onlyKeys?: Set<string>,
    ) =>
      fields.map((field) => {
        if (onlyKeys && !onlyKeys.has(field.key)) return field
        return { ...field, value: getDefault(field.key) }
      }),
    [],
  )

  const handleReset = React.useCallback(async () => {
    showMessage(t.config.resettingConfig, 'info', 0)
    setSaving(true)

    try {
      const data = await fetchConfig()

      const clearedData = {
        ...data,
        auto_fetch: DEFAULT_AUTO_FETCH_CONFIG,
        platforms: data.platforms.map((platform: any) => ({
          ...platform,
          enabled: false,
          has_token: false,
          config_fields: platform.config_fields.map((field: any) => ({
            ...field,
            value: '',
          })),
        })),
        ai_config: {
          ...data.ai_config,
          enabled: false,
          api_key: '',
          config_fields: data.ai_config.config_fields.map((field: any) => ({
            ...field,
            value: defaultAiFieldValue(field.key),
          })),
        },
        ui_config: {
          ...data.ui_config,
          config_fields: data.ui_config.config_fields.map((field: any) => ({
            ...field,
            value: defaultUiFieldValue(field.key),
          })),
        },
      }

      setConfig(clearedData)

      await new Promise((resolve) => setTimeout(resolve, 200))

      showMessage(t.config.savingDefault, 'info', 0)

      await getCSRFToken(true)

      const saveResult = await updateConfig(clearedData)
      if (saveResult?.success === false) {
        throw new Error(saveResult.message || t.config.resetFailed)
      }
      setInitialConfig(JSON.parse(JSON.stringify(clearedData)))

      showMessage(t.config.configReset, 'success', 5000)

      window.dispatchEvent(
        new CustomEvent('config-reset-result', {
          detail: {
            success: true,
            message: saveResult.message || t.config.configReset,
          },
        }),
      )
    } catch (error) {
      const errorMsg = `${t.config.resetFailed}${error instanceof Error ? error.message : t.errors.unknown}`
      showMessage(errorMsg, 'error', 0)
      window.dispatchEvent(
        new CustomEvent('config-reset-result', {
          detail: { success: false, message: errorMsg },
        }),
      )
    } finally {
      setSaving(false)
    }
  }, [defaultAiFieldValue, defaultUiFieldValue, showMessage, t])

  /** 仅重置当前设置页并立即保存相关部分 */
  const handleResetCurrentPage = React.useCallback(async () => {
    if (!config) return
    const section = activeSection
    showMessage(t.config.resettingConfig, 'info', 0)
    setSaving(true)

    try {
      await getCSRFToken(true)

      if (section === 'platforms') {
        const next = {
          ...config,
          auto_fetch: DEFAULT_AUTO_FETCH_CONFIG,
          platforms: config.platforms.map((platform) => ({
            ...platform,
            enabled: false,
            has_token: false,
            config_fields: platform.config_fields.map((field) => ({
              ...field,
              value: '',
            })),
          })),
        }
        const result = await updateConfig(next)
        if (result?.success === false) {
          throw new Error(result.message || t.config.resetFailed)
        }
        setConfig(next)
        setInitialConfig(JSON.parse(JSON.stringify(next)))
        setPlatformFocus(null)
      } else if (section === 'ai') {
        const next = {
          ...config,
          ai_config: {
            ...config.ai_config,
            enabled: false,
            api_key: '',
            config_fields: mapConfigFields(
              config.ai_config.config_fields,
              defaultAiFieldValue,
            ),
          },
        }
        const result = await updateConfig(next)
        if (result?.success === false) {
          throw new Error(result.message || t.config.resetFailed)
        }
        setConfig(next)
        setInitialConfig(JSON.parse(JSON.stringify(next)))
      } else if (section === 'ui') {
        const basicKeys = new Set([
          'wallpaper_url',
          'wallpaper_blur',
          'site_title',
          'site_description',
          'site_favicon',
          'parallax_enabled',
          'site_url',
        ])
        const next = {
          ...config,
          ui_config: {
            ...config.ui_config,
            config_fields: config.ui_config.config_fields.map((field) =>
              basicKeys.has(field.key)
                ? { ...field, value: defaultUiFieldValue(field.key) }
                : field,
            ),
          },
        }
        const result = await updateConfig(next)
        if (result?.success === false) {
          throw new Error(result.message || t.config.resetFailed)
        }
        setConfig(next)
        setInitialConfig(JSON.parse(JSON.stringify(next)))
      } else if (section === 'advanced') {
        const netKeys = new Set([
          'proxy_enabled',
          'proxy_url',
          'proxy_bypass',
          'gemini_base_url',
          'github_api_base_url',
        ])
        const next = {
          ...config,
          ui_config: {
            ...config.ui_config,
            config_fields: config.ui_config.config_fields.map((field) =>
              netKeys.has(field.key)
                ? { ...field, value: defaultUiFieldValue(field.key) }
                : field,
            ),
          },
        }
        const result = await updateConfig(next)
        if (result?.success === false) {
          throw new Error(result.message || t.config.resetFailed)
        }
        setConfig(next)
        setInitialConfig(JSON.parse(JSON.stringify(next)))
      } else if (section === 'modules') {
        const musicKeys = new Set([
          'music_enabled',
          'music_source',
          'music_playlist_id',
        ])
        const nextConfig = {
          ...config,
          ui_config: {
            ...config.ui_config,
            config_fields: config.ui_config.config_fields.map((field) =>
              musicKeys.has(field.key)
                ? { ...field, value: defaultUiFieldValue(field.key) }
                : field,
            ),
          },
        }
        const result = await updateConfig(nextConfig)
        if (result?.success === false) {
          throw new Error(result.message || t.config.resetFailed)
        }
        setConfig(nextConfig)
        setInitialConfig(JSON.parse(JSON.stringify(nextConfig)))

        const lib = normalizeLibraryPreferences(
          DEFAULT_LIBRARY_SOURCE_PREFERENCES,
        )
        const libSaved =
          await apiService.put<SaveLibrarySourcePreferencesResponse>(
            '/library/preferences',
            lib,
          )
        if (!libSaved.success) {
          throw new Error(libSaved.message || t.config.librarySourceSaveFailed)
        }
        const libNorm = normalizeLibraryPreferences(libSaved.preferences)
        setLibrarySourceDraft(libNorm)
        setSavedLibrarySourcePreferences(libNorm)
        setLibrarySourceSaveRevision((r) => r + 1)

        const vis = await updateModuleVisibilityPreferences(
          DEFAULT_MODULE_VISIBILITY_PREFERENCES,
        )
        const visNorm = normalizeModuleVisibilityPreferences(vis)
        setModuleVisibilityDraft(visNorm)
        setSavedModuleVisibilityPreferences(visNorm)
        dispatchModuleVisibilityPreferencesUpdated(visNorm)

        const hitokoto = await updateHitokotoConfig(DEFAULT_HITOKOTO_CONFIG)
        setHitokotoDraft(hitokoto)
        setSavedHitokotoConfig(hitokoto)

        const reports = await updateReportSettings(DEFAULT_REPORT_SETTINGS)
        setReportSettingsDraft(reports)
        setSavedReportSettings(reports)
      } else if (section === 'oauth' || section === 'users') {
        // users 页含注册开关，与 oauth 共用 draft
        const next =
          section === 'users'
            ? {
                ...oauthDraft,
                allowLocalRegistration:
                  DEFAULT_OAUTH_SETTINGS.allowLocalRegistration,
              }
            : cloneOAuthSettings(DEFAULT_OAUTH_SETTINGS)
        const saved = await updateOAuthSettings(next)
        setOAuthDraft(cloneOAuthSettings(saved))
        setSavedOAuthSettings(cloneOAuthSettings(saved))
      } else if (section === 'federation') {
        if (!isAdmin) throw new Error(t.config.resetFailed)
        await federationApi.updateTrustPolicy(
          federationPolicyToUpdateRequest(DEFAULT_FEDERATION_POLICY),
        )
        setFederationPolicyDraft({ ...DEFAULT_FEDERATION_POLICY })
        setSavedFederationPolicy({ ...DEFAULT_FEDERATION_POLICY })
      } else if (section === 'permissions') {
        await getCSRFToken(true)
        const response = await updatePermissionsConfig({
          ...DEFAULT_PERMISSION_CONFIG,
        })
        if (!response.success) {
          throw new Error(response.message || t.config.permissionsSaveFailed)
        }
        setPermissionConfig({ ...DEFAULT_PERMISSION_CONFIG })
        setSavedPermissionConfig({ ...DEFAULT_PERMISSION_CONFIG })
        const { TappRuntime } = await import('../tapp/runtime/TappRuntime')
        await TappRuntime.getInstance().refreshPermissionGrants()
      } else if (section === 'notifications') {
        const saved = await notificationPreferencesApi.update(
          DEFAULT_NOTIFICATION_PREFERENCES,
          user?.id,
        )
        const normalized = cloneNotificationPreferences(saved)
        setNotificationDraft(normalized)
        setSavedNotificationPreferences(
          cloneNotificationPreferences(normalized),
        )
      } else {
        // about / updater 等：无可重置项
        showMessage(t.config.resetCurrentPageNone ?? '本页无可重置选项', 'info')
        return
      }

      notifyDirtyState(false)
      showMessage(
        t.config.resetCurrentPageDone ?? '本页设置已重置',
        'success',
        3000,
      )
    } catch (error) {
      const errorMsg = `${t.config.resetFailed}${error instanceof Error ? error.message : t.errors.unknown}`
      showMessage(errorMsg, 'error', 0)
    } finally {
      setSaving(false)
    }
  }, [
    activeSection,
    config,
    defaultAiFieldValue,
    defaultUiFieldValue,
    isAdmin,
    mapConfigFields,
    notifyDirtyState,
    oauthDraft,
    showMessage,
    t,
    user?.id,
  ])

  const loadConfig = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchConfig()
      const normalizedData = {
        ...data,
        auto_fetch: data.auto_fetch || DEFAULT_AUTO_FETCH_CONFIG,
      }
      setConfig(normalizedData)
      setInitialConfig(JSON.parse(JSON.stringify(normalizedData)))
      notifyDirtyState(false)

      const event = new CustomEvent('config-loaded', { detail: data })
      window.dispatchEvent(event)
    } catch (_error) {
      showMessage(t.config.loadConfigFailed, 'error')
    } finally {
      setLoading(false)
    }
  }, [notifyDirtyState])

  useEffect(() => {
    loadConfig()
    loadPermissionConfig()
    loadModuleVisibilityPreferences()
    loadHitokotoSettings()
    loadReportSettings()
    loadNotificationSettings()
    loadOAuthSettings()
    void loadFederationPolicy()
  }, [
    loadConfig,
    loadPermissionConfig,
    loadModuleVisibilityPreferences,
    loadHitokotoSettings,
    loadReportSettings,
    loadNotificationSettings,
    loadOAuthSettings,
    loadFederationPolicy,
  ])

  // Discord 一键授权回调：/config?section=platforms&discord_oauth=ok|error
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const oauth = params.get('discord_oauth')
    if (!oauth) return

    if (params.get('section') === 'platforms') {
      setActiveSection('platforms')
    }

    if (oauth === 'ok') {
      showMessage(t.config.discordOAuthSuccess, 'success')
      setPlatformFocus('Discord')
      setMobilePane('section')
      void loadConfig()
    } else {
      const reason = params.get('reason') || 'unknown'
      showMessage(
        `${t.config.discordOAuthFailed}${reason !== 'unknown' ? ` (${reason})` : ''}`,
        'error',
      )
    }

    params.delete('discord_oauth')
    params.delete('reason')
    const qs = params.toString()
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', next)
  }, [loadConfig, t.config.discordOAuthFailed, t.config.discordOAuthSuccess])

  useEffect(() => {
    const handleSaveEvent = () => handleSave()
    const handleResetEvent = () => handleReset()

    window.addEventListener('request-config-save', handleSaveEvent)
    window.addEventListener('config-reset', handleResetEvent)

    return () => {
      window.removeEventListener('request-config-save', handleSaveEvent)
      window.removeEventListener('config-reset', handleResetEvent)
    }
  }, [handleSave, handleReset])

  // 测试语音服务可用性（返回 Promise 供组件使用）
  const handleSpeechTest = React.useCallback(async (): Promise<{
    success: boolean
    message: string
  }> => {
    if (!config) {
      return { success: false, message: 'Config not loaded' }
    }

    try {
      const result = await checkSpeechStatus()

      return {
        success: result.available === true,
        message: result.available
          ? t.config.speechTestSuccess
          : result.error || t.config.speechTestFailed,
      }
    } catch (_error) {
      return {
        success: false,
        message: t.config.speechTestFailed,
      }
    }
  }, [config, t])

  const updateConfigField = React.useCallback(
    (
      section: 'ai' | 'ui',
      fieldKey: string,
      value: string,
      providerFieldKey?: string,
      /** 不标 dirty（如域名即时应用成功后仅同步展示） */
      options?: { silent?: boolean },
    ) => {
      if (!config) return

      const sectionKey = `${section}_config` as 'ai_config' | 'ui_config'
      const sectionConfig = config[sectionKey]
      const newFields = [...sectionConfig.config_fields]
      const field = newFields.find((f) => f.key === fieldKey)

      if (field) {
        field.value = sanitizeMaskedFieldValue(value)

        if (providerFieldKey && fieldKey === providerFieldKey) {
          setConfig({
            ...config,
            [sectionKey]: {
              ...sectionConfig,
              provider: value,
              config_fields: newFields,
            },
          })
        } else {
          setConfig({
            ...config,
            [sectionKey]: { ...sectionConfig, config_fields: newFields },
          })
        }
        if (!options?.silent) {
          notifyDirtyState(true)
        }
      }
    },
    [config, notifyDirtyState],
  )

  const updateFieldValue = React.useCallback(
    (platformIndex: number, fieldKey: string, value: string) => {
      if (!config) return

      const newPlatforms = [...config.platforms]
      const field = newPlatforms[platformIndex].config_fields.find(
        (f) => f.key === fieldKey,
      )
      if (field) {
        field.value = sanitizeMaskedFieldValue(value)
        setConfig({ ...config, platforms: newPlatforms })
        notifyDirtyState(true)
      }
    },
    [config, notifyDirtyState],
  )

  const updateAiFieldValue = React.useCallback(
    (fieldKey: string, value: string) => {
      updateConfigField('ai', fieldKey, value, 'provider')
    },
    [updateConfigField],
  )

  const updateUiFieldValue = React.useCallback(
    (fieldKey: string, value: string, options?: { silent?: boolean }) => {
      updateConfigField('ui', fieldKey, value, undefined, options)
    },
    [updateConfigField],
  )

  const togglePlatform = React.useCallback(
    (platformIndex: number) => {
      if (!config) return

      const newPlatforms = [...config.platforms]
      newPlatforms[platformIndex].enabled = !newPlatforms[platformIndex].enabled
      setConfig({ ...config, platforms: newPlatforms })
      notifyDirtyState(true)
    },
    [config, notifyDirtyState],
  )

  const updateAutoFetchConfig = React.useCallback(
    (auto_fetch: PlatformAutoFetchConfig) => {
      if (!config) return
      setConfig({ ...config, auto_fetch })
      notifyDirtyState(true)
    },
    [config, notifyDirtyState],
  )

  // 🆕 调整平台顺序（拖拽排序）：该顺序会作为报告页平台卡片的出现顺序保存
  // fromIndex 的卡片移动到 toIndex 位置
  const reorderPlatform = React.useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!config) return
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= config.platforms.length ||
        toIndex >= config.platforms.length
      ) {
        return
      }

      const newPlatforms = [...config.platforms]
      const [moved] = newPlatforms.splice(fromIndex, 1)
      newPlatforms.splice(toIndex, 0, moved)
      setConfig({ ...config, platforms: newPlatforms })
      notifyDirtyState(true)
    },
    [config, notifyDirtyState],
  )

  const isBaseConfigDirty = useMemo(() => {
    if (!config || !initialConfig) return false
    return !deepEqual(config, initialConfig)
  }, [config, initialConfig])

  const isLibrarySourceDirty = useMemo(
    () =>
      !areLibrarySourcePreferencesEqual(
        librarySourceDraft,
        savedLibrarySourcePreferences,
      ),
    [librarySourceDraft, savedLibrarySourcePreferences],
  )

  const isModuleVisibilityDirty = useMemo(
    () =>
      !areModuleVisibilityPreferencesEqual(
        moduleVisibilityDraft,
        savedModuleVisibilityPreferences,
      ),
    [moduleVisibilityDraft, savedModuleVisibilityPreferences],
  )

  const isHitokotoDirty = useMemo(
    () => !areHitokotoConfigsEqual(hitokotoDraft, savedHitokotoConfig),
    [hitokotoDraft, savedHitokotoConfig],
  )

  const isReportSettingsDirty = useMemo(
    () => !areReportSettingsEqual(reportSettingsDraft, savedReportSettings),
    [reportSettingsDraft, savedReportSettings],
  )

  const isPermissionDirty = useMemo(
    () => !deepEqual(permissionConfig, savedPermissionConfig),
    [permissionConfig, savedPermissionConfig],
  )

  const isNotificationDirty = useMemo(
    () =>
      !areNotificationPreferencesEqual(
        notificationDraft,
        savedNotificationPreferences,
      ),
    [notificationDraft, savedNotificationPreferences],
  )

  const isOAuthDirty = useMemo(
    () => !areOAuthSettingsEqual(oauthDraft, savedOAuthSettings),
    [oauthDraft, savedOAuthSettings],
  )

  const isFederationDirty = useMemo(
    () =>
      isAdmin &&
      !areFederationPoliciesEqual(federationPolicyDraft, savedFederationPolicy),
    [isAdmin, federationPolicyDraft, savedFederationPolicy],
  )

  const isFavoritesDirty = useMemo(
    () => !deepEqual(favorites, savedFavorites),
    [favorites, savedFavorites],
  )

  const isConfigDirty =
    isBaseConfigDirty ||
    isLibrarySourceDirty ||
    isModuleVisibilityDirty ||
    isHitokotoDirty ||
    isReportSettingsDirty ||
    isPermissionDirty ||
    isNotificationDirty ||
    isOAuthDirty ||
    isFederationDirty ||
    isFavoritesDirty

  useEffect(() => {
    notifyDirtyState(isConfigDirty)
  }, [isConfigDirty, notifyDirtyState])

  useEffect(() => {
    if (!isConfigDirty) return

    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnAboutUnsavedChanges)
    return () =>
      window.removeEventListener('beforeunload', warnAboutUnsavedChanges)
  }, [isConfigDirty])

  const getSectionProps = (sectionId: string) => {
    const item = quickAccessItems.find((i) => i.id === sectionId)
    if (!item) {
      // 理论上不会发生，因为 activeSection 总是有效的
      return { title: '', icon: null, description: '' }
    }
    // Header copy always comes from nav (quickAccessItems), never from
    // searchableContent — search aliases share section ids (music→modules,
    // network→advanced) and must not override the page description.
    return {
      title: item.label,
      icon: item.icon,
      sectionId: item.id,
      description: item.description,
    }
  }

  /** section 由切换容器传入：退场期间渲染的仍是上一个分类 */
  const renderActiveSection = (activeSection: string) => {
    if (!config) return null

    const props = getSectionProps(activeSection)

    switch (activeSection) {
      case 'platforms':
        return (
          <PlatformsConfigSection
            platforms={config.platforms}
            autoFetch={config.auto_fetch || DEFAULT_AUTO_FETCH_CONFIG}
            onUpdateField={updateFieldValue}
            onToggle={togglePlatform}
            onReorder={reorderPlatform}
            onAutoFetchChange={updateAutoFetchConfig}
            showMessage={showMessage}
            openOAuthSection={() => handleSectionChange('oauth')}
            focusPlatform={platformFocus}
            onFocusPlatformConsumed={() => setPlatformFocus(null)}
            {...props}
          />
        )
      case 'ai':
        return (
          <AiConfigSection
            configFields={config.ai_config.config_fields}
            updateValue={updateAiFieldValue}
            onSpeechTest={handleSpeechTest}
            {...props}
          />
        )
      case 'ui':
        return (
          <UiConfigSection
            configFields={config.ui_config.config_fields}
            updateValue={updateUiFieldValue}
            getFieldLabel={getFieldLabel}
            getFieldPlaceholder={getFieldPlaceholder}
            {...props}
          />
        )
      case 'oauth':
        return (
          <OAuthConfigSection
            configFields={config.ui_config.config_fields}
            providers={oauthDraft.providers}
            loading={oauthLoading}
            onProvidersChange={(providers) =>
              setOAuthDraft((current) => ({ ...current, providers }))
            }
            {...props}
          />
        )
      case 'federation':
        if (!isAdmin) return null
        return (
          <FederationConfigSection
            policyDraft={federationPolicyDraft}
            onPolicyChange={updateFederationPolicy}
            onMessage={(msg, type = 'info') => showMessage(msg, type)}
            {...props}
          />
        )
      case 'permissions':
        return (
          <PermissionsConfigSection
            permissionConfig={permissionConfig}
            updatePermissionConfig={updatePermissionConfig}
            loading={permissionLoading}
            {...props}
          />
        )
      case 'modules':
        return (
          <ModuleConfigSection
            sourceDraft={librarySourceDraft}
            setSourceDraft={setLibrarySourceDraft}
            visibilityDraft={moduleVisibilityDraft}
            setVisibilityDraft={setModuleVisibilityDraft}
            isSourceDirty={isLibrarySourceDirty}
            saveRevision={librarySourceSaveRevision}
            onSourcePreferencesLoaded={handleLibrarySourcePreferencesLoaded}
            hitokotoDraft={hitokotoDraft}
            setHitokotoDraft={setHitokotoDraft}
            reportSettingsDraft={reportSettingsDraft}
            setReportSettingsDraft={setReportSettingsDraft}
            uiConfigFields={config.ui_config.config_fields}
            updateUiFieldValue={updateUiFieldValue}
            onMessage={handleModuleMessage}
            {...props}
          />
        )
      case 'notifications':
        return (
          <NotificationConfigSection
            preferences={notificationDraft}
            sources={notificationSources}
            events={notificationEvents}
            loading={notificationLoading}
            onChange={setNotificationDraft}
            {...props}
          />
        )
      case 'users':
        return (
          <UsersConfigSection
            onMessage={(msg, type = 'info') => showMessage(msg, type)}
            allowRegister={oauthDraft.allowLocalRegistration}
            allowRegisterLoading={oauthLoading}
            onAllowRegisterChange={(allowLocalRegistration) =>
              setOAuthDraft((current) => ({
                ...current,
                allowLocalRegistration,
              }))
            }
            {...props}
          />
        )
      case 'advanced':
        return (
          <AdvancedConfigSection
            onReset={handleReset}
            uiConfigFields={config.ui_config.config_fields}
            updateUiFieldValue={updateUiFieldValue}
            onMessage={(msg, type = 'info') => showMessage(msg, type)}
            {...props}
          />
        )
      case 'about':
        return <AboutConfigSection {...props} />
      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="modern-config-loading" role="status" aria-live="polite">
        <Spinner size="lg" color="primary" />
      </div>
    )
  }

  if (!config) {
    return (
      <div
        className="modern-config-error"
        role="alert"
        aria-live="assertive"
        aria-labelledby="config-load-error-title"
      >
        <div className="modern-config-error-card">
          <div className="modern-config-error-visual" aria-hidden="true">
            <span className="modern-config-error-icon">
              <FaExclamationTriangle />
            </span>
          </div>

          <div className="modern-config-error-copy">
            <h2 id="config-load-error-title">{t.config.loadConfigFailed}</h2>
            <p>{t.config.loadConfigFailedDesc}</p>
          </div>

          <div className="modern-config-error-actions">
            <SettingsButton
              variant="primary"
              size="md"
              icon={<LuRefreshCw />}
              onClick={() => void loadConfig()}
            >
              {t.common.retry}
            </SettingsButton>
          </div>
        </div>
      </div>
    )
  }

  const activeSectionMeta = getSectionProps(activeSection)

  return (
    <motion.div
      className="modern-config-container"
      initial={SETTINGS_PAGE_MOTION.initial}
      animate={SETTINGS_PAGE_MOTION.animate}
      exit={SETTINGS_PAGE_MOTION.exit}
      transition={SETTINGS_PAGE_MOTION.transition}
    >
      {/* 消息提示 */}
      {message && <Toast message={message} type={messageType} />}

      <div
        className="config-shell"
        data-mobile-pane={isMobileLayout ? mobilePane : 'desktop'}
      >
        {/* 分类侧边栏：移动端为一级页；桌面端为粘顶导航 */}
        {!(isMobileLayout && mobilePane === 'section') ? (
        <motion.aside
          className="config-sidebar"
          aria-label={t.config.title}
          initial={SETTINGS_SIDEBAR_MOTION.initial}
          animate={SETTINGS_SIDEBAR_MOTION.animate}
          transition={SETTINGS_SIDEBAR_MOTION.transition}
        >
          <div className="config-sidebar-header">
            <span className="nav-icon">
              <MyriadConfigIcon kind="ui" />
            </span>
            <div className="config-sidebar-heading">
              <h3 className="nav-title">{t.config.title}</h3>
              <p className="nav-subtitle">{t.config.selectProject}</p>
            </div>
          </div>

          <div className="config-sidebar-search">
            <div className="search-input-wrapper">
              <FaSearch className="search-icon" />
              <input
                type="search"
                placeholder={t.config.searchConfig}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="search-clear"
                  aria-label="Clear search"
                >
                  <FaTimes />
                </button>
              )}
            </div>
          </div>

          {/* 搜索时侧边栏切换为结果列表，右侧内容保持不变 */}
          {searchQuery ? (
            <div className="config-sidebar-results">
              <div className="config-nav-group sm-stagger">
                <div className="config-nav-group-title">
                  {t.config.searchResults} ({filteredContent.length})
                </div>
                {filteredContent.length > 0 ? (
                  filteredContent.map((item, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => {
                        handleSectionChange(item.section)
                      }}
                      className="config-nav-result"
                    >
                      <span className="config-nav-result-text">
                        <span className="config-nav-result-title">
                          {item.title}
                        </span>
                        <span className="config-nav-result-desc">
                          {item.description}
                        </span>
                      </span>
                      <span className="config-nav-result-arrow" aria-hidden>
                        ›
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="config-nav-empty">
                    {t.config.noMatchingConfig}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <nav className="config-sidebar-scroll">
              {/* 收藏夹 */}
              {favorites.length > 0 && (
                <div className="config-nav-group config-nav-group--favorites">
                  <div className="config-nav-group-title">
                    <FaStar className="config-nav-group-icon" />
                    {t.config.favorites}
                  </div>
                  {favorites.map((fav) => {
                    const item = quickAccessItems.find((i) => i.id === fav)
                    return item ? (
                      <ConfigNavItem
                        key={item.id}
                        item={item}
                        isActive={activeSection === item.section}
                        isFavorite={true}
                        group="favorites"
                        onSelect={handleSectionChange}
                        onToggleFavorite={toggleFavorite}
                      />
                    ) : null
                  })}
                </div>
              )}

              {/* 所有配置 */}
              <div className="config-nav-group config-nav-group--all">
                <div className="config-nav-group-title">
                  {t.config.allConfig}
                </div>
                {quickAccessItems.map((item) => (
                  <ConfigNavItem
                    key={item.id}
                    item={item}
                    isActive={activeSection === item.section}
                    isFavorite={favorites.includes(item.id)}
                    group="all"
                    onSelect={handleSectionChange}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </div>
            </nav>
          )}
        </motion.aside>
        ) : null}

        {/* 配置内容：移动端二级；平台详情在区块内为三级。
            一级页卸载内容，避免返回总览后仍停在平台详情。 */}
        {!(isMobileLayout && mobilePane === 'nav') ? (
          <div className="config-content">
            {isMobileLayout ? (
              <div className="config-mobile-section-bar">
                <button
                  type="button"
                  className="config-mobile-back"
                  onClick={handleMobileBackToNav}
                  aria-label={`${t.common.back} · ${t.config.title}`}
                >
                  <LuChevronLeft
                    size={18}
                    strokeWidth={2.25}
                    className="config-mobile-back-icon"
                    aria-hidden
                  />
                  <span className="config-mobile-back-label">
                    {t.config.title}
                  </span>
                </button>
                <div className="config-mobile-section-mid">
                  {activeSectionMeta.icon ? (
                    <span className="config-mobile-section-icon">
                      {activeSectionMeta.icon}
                    </span>
                  ) : null}
                  <span className="config-mobile-section-title">
                    {activeSectionMeta.title}
                  </span>
                </div>
                <span className="config-mobile-section-trail" aria-hidden />
              </div>
            ) : null}
            <SettingsPageActionsProvider
              value={{
                resetCurrentPage: handleResetCurrentPage,
                canResetCurrentPage:
                  activeSection !== 'about' && activeSection !== 'updater',
              }}
            >
              <SectionSwitch
                sectionKey={activeSection}
                direction={sectionDir}
                onCommit={scrollSettingsToTop}
              >
                {(section) => renderActiveSection(section)}
              </SectionSwitch>
            </SettingsPageActionsProvider>
          </div>
        ) : null}
      </div>

      {isConfigDirty && (
        <div className="floating-save-container">
          <SettingsButton
            variant="primary"
            className="floating-save-btn"
            onClick={handleSave}
            aria-label={t.config.saveConfigLabel}
            disabled={saving}
            loading={saving}
            icon={
              <svg
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                width="20"
                height="20"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            }
          >
            {saving ? t.config.savingConfig : t.config.saveConfig}
          </SettingsButton>
        </div>
      )}
    </motion.div>
  )
}

export default ModernConfigForm
