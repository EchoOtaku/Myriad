/**
 * 设置选项详细指南（弹窗正文结构）
 */

export interface SettingGuideEntry {
  /** 作用：这个选项控制什么 */
  what: string
  /** 关联链路：配置 → 存储/API → 下游模块（尽量写全） */
  chain?: string
  /** 前端落点：具体页面 / 组件 / 入口 */
  frontend?: string
  /** 注意：依赖其它设置、保存方式、危险操作 */
  notes?: string
}

/** 分区指南目录 */
export interface SettingGuidesCatalog {
  ui: {
    siteUrl: SettingGuideEntry
    siteMetadata: SettingGuideEntry
    siteTitle: SettingGuideEntry
    siteDescription: SettingGuideEntry
    siteFavicon: SettingGuideEntry
    siteFooter: SettingGuideEntry
    siteIcp: SettingGuideEntry
    siteGongan: SettingGuideEntry
    cloudSponsors: SettingGuideEntry
    backgroundAndTheme: SettingGuideEntry
    wallpaper: SettingGuideEntry
    wallpaperBlur: SettingGuideEntry
    evocative: SettingGuideEntry
    evocativeEffects: SettingGuideEntry
    evocativeFps: SettingGuideEntry
    evocativeRippleQuality: SettingGuideEntry
  }
  modules: {
    visibility: SettingGuideEntry
    visibilityItem: SettingGuideEntry
    library: SettingGuideEntry
    libraryType: SettingGuideEntry
    report: SettingGuideEntry
    reportExpiry: SettingGuideEntry
    reportAutoRegen: SettingGuideEntry
    reportExpiryDays: SettingGuideEntry
    music: SettingGuideEntry
    musicPlatform: SettingGuideEntry
    musicPlaylist: SettingGuideEntry
    musicCache: SettingGuideEntry
    hitokoto: SettingGuideEntry
    hitokotoSource: SettingGuideEntry
    hitokotoCustomUrl: SettingGuideEntry
    hitokotoTextField: SettingGuideEntry
    hitokotoAuthorField: SettingGuideEntry
  }
  platforms: {
    list: SettingGuideEntry
    autoRefresh: SettingGuideEntry
    platformCard: SettingGuideEntry
    platformFields: SettingGuideEntry
  }
  notifications: {
    master: SettingGuideEntry
    island: SettingGuideEntry
    toast: SettingGuideEntry
    browser: SettingGuideEntry
    source: SettingGuideEntry
    locations: SettingGuideEntry
    events: SettingGuideEntry
  }
  ai: {
    standard: SettingGuideEntry
    lite: SettingGuideEntry
    liteEnable: SettingGuideEntry
    pro: SettingGuideEntry
    proEnable: SettingGuideEntry
    image: SettingGuideEntry
    speech: SettingGuideEntry
    provider: SettingGuideEntry
    apiKey: SettingGuideEntry
    baseUrl: SettingGuideEntry
    model: SettingGuideEntry
  }
  oauth: {
    section: SettingGuideEntry
    allowRegister: SettingGuideEntry
    provider: SettingGuideEntry
  }
  permissions: {
    agentPreset: SettingGuideEntry
    fineTune: SettingGuideEntry
    userElevated: SettingGuideEntry
    guestElevated: SettingGuideEntry
    aiQuota: SettingGuideEntry
    userQuota: SettingGuideEntry
    guestQuota: SettingGuideEntry
  }
  users: {
    section: SettingGuideEntry
    create: SettingGuideEntry
    list: SettingGuideEntry
  }
  advanced: {
    network: SettingGuideEntry
    proxyEnable: SettingGuideEntry
    proxyUrl: SettingGuideEntry
    proxyBypass: SettingGuideEntry
    geminiBaseUrl: SettingGuideEntry
    githubApiBaseUrl: SettingGuideEntry
    backup: SettingGuideEntry
    exportConfig: SettingGuideEntry
    importConfig: SettingGuideEntry
    resetConfig: SettingGuideEntry
  }
  federation: {
    keys: SettingGuideEntry
    policy: SettingGuideEntry
    minTrust: SettingGuideEntry
    allowlist: SettingGuideEntry
    autoDiscover: SettingGuideEntry
    knownInstances: SettingGuideEntry
    contentFilters: SettingGuideEntry
    deliveryQueue: SettingGuideEntry
    advanced: SettingGuideEntry
    rateMax: SettingGuideEntry
    rateWindow: SettingGuideEntry
    rateTrusted: SettingGuideEntry
  }
  updater: {
    channel: SettingGuideEntry
    maintenance: SettingGuideEntry
    rescue: SettingGuideEntry
    forceExit: SettingGuideEntry
    infra: SettingGuideEntry
    target: SettingGuideEntry
    snapshot: SettingGuideEntry
    advanced: SettingGuideEntry
  }
  about: {
    section: SettingGuideEntry
  }
}

export interface GuideSectionLabels {
  what: string
  chain: string
  frontend: string
  notes: string
}
