/**
 * 国际化 (i18n) 模块
 * 支持中文、英文和日文，默认根据用户浏览器语言设置
 */

export type Locale = 'zh-CN' | 'en-US' | 'ja-JP';

export interface TranslationKeys {
  // 通用
  common: {
    save: string;
    cancel: string;
    confirm: string;
    delete: string;
    edit: string;
    done: string;
    loading: string;
    error: string;
    success: string;
    retry: string;
    close: string;
    or: string;
    go: string;
    refresh: string;
    reset: string;
    search: string;
    noResults: string;
    enabled: string;
    disabled: string;
    configured: string;
    unconfigured: string;
    required: string;
    networkError: string;
    unknownError: string;
    details: string;
    detailsPlaceholder: string;
  };
  
  // 导航
  nav: {
    home: string;
    library: string;
    reports: string;
    config: string;
    login: string;
    logout: string;
    account: string;
    dataManagement: string;
    backToHome: string;
    // 导航岛
    mainNavigation: string;
    back: string;
    backToNav: string;
    platformReport: string;
    showPlatformReport: string;
    comprehensiveReport: string;
    showComprehensiveReport: string;
    all: string;
    showAll: string;
    game: string;
    showGame: string;
    video: string;
    showVideo: string;
    music: string;
    showMusic: string;
    anime: string;
    showAnime: string;
    tvSeries: string;
    showTvSeries: string;
    currentFilterAll: string;
    currentFilterGame: string;
    currentFilterVideo: string;
    currentFilterMusic: string;
    currentFilterAnime: string;
    currentFilterTvSeries: string;
    currentTabPlatform: string;
    currentTabComprehensive: string;
    // Tapp
    tapp: string;
    tappStore: string;
    openTappStore: string;
  };
  
  // 问候语
  greeting: {
    morning: string;
    noon: string;
    afternoon: string;
    evening: string;
    night: string;
    lateNight: string;
    welcome: string;
  };
  
  // 控制面板
  controlPanel: {
    appearance: string;
    dark: string;
    light: string;
    animation: string;
    lowPerformance: string;
    highPerformance: string;
    noAnimation: string;
    wallpaper: string;
    random: string;
    configuration: string;
    system: string;
    themeSwitch: string;
    wallpaperSwitch: string;
    appearanceSettings: string;
    clickToExpand: string;
    language: string;
    languageSwitch: string;
  };
  
  // 登录
  auth: {
    username: string;
    password: string;
    confirmPassword: string;
    login: string;
    loggingIn: string;
    logout: string;
    loggingOut: string;
    loginWithGithub: string;
    enterUsername: string;
    enterPassword: string;
    fillUsernameAndPassword: string;
    usernameLengthError: string;
    usernameFormatError: string;
    passwordLengthError: string;
    loginFailed: string;
    loginResponseIncomplete: string;
    userInfoIncomplete: string;
    invalidTokenFormat: string;
    rateLimitError: string;
    logoutSuccess: string;
    logoutFailed: string;
  };
  
  // 设置向导
  setup: {
    title: string;
    databaseConfig: string;
    databaseConfigDesc: string;
    adminAccount: string;
    adminAccountDesc: string;
    connectionFailed: string;
    connectionFailedDesc: string;
    backendDisconnected: string;
    reconnecting: string;
    retry: string;
    complete: string;
    completeDesc: string;
    goToLogin: string;
    host: string;
    port: string;
    database: string;
    username: string;
    connectionInfo: string;
    saveAndConnect: string;
    saving: string;
    configurationMode: string;
    configurationModeDesc: string;
    initDatabase: string;
    initDatabaseDesc: string;
    initializing: string;
    createAdmin: string;
    creating: string;
    adminUsernameHint: string;
    adminPasswordHint: string;
    passwordMismatch: string;
    enterDbPassword: string;
    dbConfigSaved: string;
    dbReconnecting: string;
    waitingForConnection: string;
    restartRequired: string;
    saveConfigFailed: string;
    dbConnectionSuccess: string;
    systemSwitchedToNormal: string;
    dbConnectionTimeout: string;
    dbConnectionTimeoutDesc: string;
    dbMigrationFailed: string;
    verificationResult: string;
    totalTables: string;
    usersTable: string;
    platformsTable: string;
    configurationsTable: string;
    yes: string;
    no: string;
    usernameLengthError: string;
    usernameFormatError: string;
    passwordLengthError: string;
    adminCreated: string;
    createAdminFailed: string;
    createFailed: string;
    adminAccountFullDesc: string;
    saveHint: string;
    atLeast8Chars: string;
    enterPasswordAgain: string;
  };
  
  // 配置
  config: {
    title: string;
    platforms: string;
    platformsDesc: string;
    ai: string;
    aiDesc: string;
    basic: string;
    basicDesc: string;
    oauth: string;
    oauthDesc: string;
    music: string;
    musicDesc: string;
    data: string;
    dataDesc: string;
    selectProject: string;
    favorites: string;
    allConfig: string;
    saveConfig: string;
    resetConfig: string;
    searchConfig: string;
    searchResults: string;
    noMatchingConfig: string;
    savingConfig: string;
    configSaved: string;
    configSaveFailed: string;
    configEmpty: string;
    loadConfigFailed: string;
    resettingConfig: string;
    configReset: string;
    testConnection: string;
    testFailed: string;
    imageGenService: string;
    free: string;
    aiModel: string;
    width: string;
    height: string;
    enableMusicPlayer: string;
    musicPlayerDesc: string;
    musicPlatform: string;
    playlistId: string;
    playlistIdHint: string;
    cacheManagement: string;
    clearMusicCache: string;
    clearMusicCacheDesc: string;
    musicCacheCleared: string;
    siteMetadata: string;
    backgroundAndTheme: string;
    parallaxHint: string;
    // UI 字段标签
    fieldWallpaperUrl: string;
    fieldWallpaperBlur: string;
    fieldWallpaperParallax: string;
    fieldPetEnabled: string;
    fieldPetImageUrl: string;
    fieldSiteTitle: string;
    fieldSiteDescription: string;
    fieldSiteFavicon: string;
    fieldMusicEnabled: string;
    fieldMusicSource: string;
    fieldMusicPlaylistId: string;
    // UI 字段占位符
    placeholderWallpaperUrl: string;
    placeholderSiteTitle: string;
    placeholderSiteDescription: string;
    placeholderSiteFavicon: string;
    placeholderPetImageUrl: string;
    githubOAuthHint: string;
    callbackUrl: string;
    redirectUrl: string;
    aiServiceDesc: string;
    getApiKey: string;
    personaServiceDesc: string;
    savingDefault: string;
    resetFailed: string;
    refreshing: string;
    refreshFailed: string;
    savedSuccess: string;
    // ConfigForm 扩展
    configured: string;
    notConfigured: string;
    aiConfigTitle: string;
    aiConfigDesc: string;
    aiServiceInfoTitle: string;
    aiServiceInfo: string;
    aiProvider: string;
    aiProviderHint: string;
    aiServiceInfoDescription: string;
    geminiDescription: string;
    openaiCompatible: string;
    openaiDescription: string;
    // AI Image Generation
    aiImageTitle: string;
    aiImageDesc: string;
    aiImageUsageTitle: string;
    enableAiImage: string;
    aiImageHint: string;
    pollinationsDescription: string;
    imagineproDescription: string;
    pollinationsFree: string;
    imagineproMJ: string;
    fluxAnimeRecommend: string;
    fluxDefault: string;
    fluxRealism: string;
    flux3D: string;
    imagineproPlaceholder: string;
    // Platform configuration
    platformsConfigTitle: string;
    platformsConfigDesc: string;
    configuredStatus: string;
    unconfiguredStatus: string;
    enablePlatform: string;
    testingConnection: string;
    howToGetToken: string;
    basicConfigTitle: string;
    basicConfigDesc: string;
    siteUrlConfig: string;
    baseUrl: string;
    baseUrlPlaceholder: string;
    baseUrlHint: string;
    oauthConfigTitle: string;
    oauthConfigDesc: string;
    oauthGuideTitle: string;
    oauthGuideStep1: string;
    oauthGuideStep2: string;
    oauthGuideStep3: string;
    oauthGuideStep4: string;
    currentCallbackUrl: string;
    currentCallbackUrlHint: string;
    callbackUrlNotConfigured: string;
    githubClientId: string;
    githubClientIdPlaceholder: string;
    githubClientSecret: string;
    githubClientSecretPlaceholder: string;
    musicConfigTitle: string;
    musicConfigDesc: string;
    musicUsageTitle: string;
    musicUsageInfo: string;
    neteaseMusic: string;
    qqMusic: string;
    neteasePlaylistHint: string;
    qqPlaylistHint: string;
    clearMusicCacheBtn: string;
    wallpaperParallaxHint: string;
    neteasePlaylistExample: string;
    qqPlaylistExample: string;
    removeFavorite: string;
    addFavorite: string;
    resetConfigLabel: string;
    saveConfigLabel: string;
    clearSearchLabel: string;
    closeLabel: string;
    // Tapp permission delegation settings
    permissions: string;
    permissionsDesc: string;
    permissionsTitle: string;
    tappPermissionsInfoTitle: string;
    tappPermissionsInfo: string;
    // User elevated permissions
    userElevatedPermissions: string;
    userElevatedPermissionsDesc: string;
    // Guest elevated permissions
    guestElevatedPermissions: string;
    guestElevatedPermissionsDesc: string;
    // 11 elevated permissions (9 configurable, platform:write and platform:register are privileged)
    permAiGenerate: string;
    permAiGenerateHint: string;
    permAiAnalyze: string;
    permAiAnalyzeHint: string;
    permAiChat: string;
    permAiChatHint: string;
    permReportWrite: string;
    permReportWriteHint: string;
    permNetworkFetch: string;
    permNetworkFetchHint: string;
    permMediaControl: string;
    permMediaControlHint: string;
    permComponentTheme: string;
    permComponentThemeHint: string;
    permShortcutRegister: string;
    permShortcutRegisterHint: string;
    permEventPublish: string;
    permEventPublishHint: string;
    permissionsSaved: string;
    permissionsSaveFailed: string;
    loadPermissionsFailed: string;
    // AI 使用限额配置
    aiQuotaTitle: string;
    aiQuotaDesc: string;
    userAiQuota: string;
    guestAiQuota: string;
    aiDailyCalls: string;
    aiDailyCallsHint: string;
    aiDailyTokens: string;
    aiDailyTokensHint: string;
    aiCooldownSeconds: string;
    aiCooldownSecondsHint: string;
    aiQuotaAdminNote: string;
  };
  
  // 小组件
  widgets: {
    welcome: string;
    quickStats: string;
    recentActivity: string;
    weather: string;
    quote: string;
    musicPlayer: string;
    reportBilibili: string;
    reportSteam: string;
    reportGithub: string;
    reportNetease: string;
    socialNetwork: string;
    library: string;
    dataReport: string;
    multiPlatformAggregation: string;
    dualLayerAnalysis: string;
    showPersonality: string;
    platformProfile: string;
  };
  
  // 首页
  home: {
    dashboard: string;
    welcomeBack: string;
    defaultBio: string;
    fetchUserInfoFailed: string;
    fetchCsrfFailed: string;
    parseDashboardFailed: string;
    loadConfigFailed: string;
    saveWidgetsFailed: string;
    saveTitleFailed: string;
    saveCustomPlatformsFailed: string;
  };
  
  // 资料库
  library: {
    title: string;
    noData: string;
    loadFailed: string;
    loadingMore: string;
    // 游戏时长
    playedHours: string;
    // 音乐相关
    unknownArtist: string;
    unknownAlbum: string;
    // 播放提示
    alreadyPlaying: string;
    vipSongWarning: string;
    nowPlaying: string;
    // 空状态
    emptyLibrary: string;
    emptyCategory: string;
    // 内容类型
    anime: string;
    tvSeries: string;
  };
  
  // 报告
  reports: {
    title: string;
    noData: string;
    loadFailed: string;
    generating: string;
    generated: string;
  };
  
  // 账户
  account: {
    title: string;
    profile: string;
    name: string;
    bio: string;
    avatar: string;
    saveProfile: string;
    saving: string;
    saved: string;
    saveFailed: string;
    changePassword: string;
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
    passwordChanged: string;
    passwordChangeFailed: string;
  };
  
  // 错误信息
  errors: {
    networkError: string;
    serverError: string;
    unauthorized: string;
    forbidden: string;
    notFound: string;
    timeout: string;
    unknown: string;
  };
  
  // 天气小组件
  weather: {
    humidity: string;
    windSpeed: string;
    airQuality: string;
    feelsLike: string;
    updating: string;
    unavailable: string;
    tomorrow: string;
    noForecast: string;
    // 天气状态
    sunny: string;
    partlyCloudy: string;
    cloudy: string;
    foggy: string;
    rainy: string;
    snowy: string;
    lightRain: string;
    moderateRain: string;
    heavyRain: string;
    freezingRain: string;
    showers: string;
    heavyShowers: string;
    lightSnow: string;
    moderateSnow: string;
    heavySnow: string;
    sleet: string;
    snowShowers: string;
    heavySnowShowers: string;
    thunderstorm: string;
    unknown: string;
  };
  
  // 音乐播放器
  music: {
    noSong: string;
    noPlaylist: string;
    noPlaying: string;
    stopTemp: string;
    stopTempAndRestore: string;
    progress: string;
    lyrics: string;
    previous: string;
    next: string;
    volume: string;
    playlist: string;
    back: string;
    playlistTitle: string;
    searchPlaceholder: string;
    clearSearch: string;
    noMatching: string;
    showVipSongs: string;
    hideVipSongs: string;
    play: string;
    pause: string;
    singleRepeat: string;
    shuffle: string;
    listRepeat: string;
    loadPlaylistFailed: string;
    playFailed: string;
  };
  
  // 缓存管理
  cache: {
    title: string;
    totalSize: string;
    clearAll: string;
    clearAllConfirm: string;
    clearPlatformConfirm: string;
    clearFailed: string;
    submitTaskFailed: string;
    cached: string;
    notCached: string;
    size: string;
    modifiedTime: string;
    notProcessed: string;
    clearCache: string;
    reprocess: string;
    process: string;
    loading: string;
    aboutCaching: string;
    cacheHint1: string;
    cacheHint2: string;
    cacheHint3: string;
    cacheHint4: string;
  };
  
  // 任务状态
  task: {
    fetchFailed: string;
    loadingInfo: string;
    pending: string;
    processing: string;
    completed: string;
    failed: string;
    closeError: string;
    closeTask: string;
    progress: string;
    createdTime: string;
    completedTime: string;
  };
  
  // 用户弹窗
  userModal: {
    title: string;
    from: string;
    bio: string;
    account: string;
    role: string;
    admin: string;
    normalUser: string;
    authMethod: string;
    localAccount: string;
    githubAccount: string;
    githubBinding: string;
    githubLinked: string;
    githubNotLinked: string;
    bindGithub: string;
    changePassword: string;
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
    enterCurrentPassword: string;
    atLeast8Chars: string;
    enterPasswordAgain: string;
    newPasswordMinLength: string;
    passwordMismatch: string;
    passwordSameAsOld: string;
    cannotGetCsrf: string;
    passwordChanged: string;
    changing: string;
    confirmChange: string;
    networkError: string;
    logout: string;
    pleaseLogin: string;
    unknownUser: string;
    unknownPlatform: string;
    defaultBio: string;
    installedApps: string;
    recentlyUsed: string;
    noRecentTapps: string;
    viewAllTapps: string;
  };
  
  // 小组件网格
  widgetGrid: {
    widgetLibrary: string;
    undo: string;
    redo: string;
    deleteWidget: string;
    positionConflict: string;
    canPlace: string;
  };
  
  // 社交网络小组件
  socialNetwork: {
    platformName: string;
    platformNameHint: string;
    usernameHint: string;
    linkAutoGenerate: string;
    linkManualInput: string;
    popupHint: string;
    close: string;
    delete: string;
    longPressToEdit: string;
    linkType: string;
    urlLink: string;
    infoPopup: string;
    usernameId: string;
    optional: string;
    urlPattern: string;
    popupContent: string;
    usePlaceholder: string;
    noUsernameHint: string;
    generating: string;
    create: string;
    noContent: string;
    neteaseMusic: string;
    selectPlatform: string;
    copy: string;
    clickToVisit: string;
    notConfigured: string;
  };
  
  // 报告卡片小组件
  reportCard: {
    noReportData: string;
    casualPlayer: string;
    hardcorePlayer: string;
    beginnerDev: string;
    activeDev: string;
    seniorDev: string;
    coreDev: string;
    legendaryDev: string;
    danmakuDefault: string[];
  };
  
  // 性能监控
  performance: {
    animationDetected: string;
    collapse: string;
    expand: string;
  };
  
  // 报告页面
  reportsPage: {
    // 平台名称
    neteaseMusic: string;
    bilibili: string;
    steam: string;
    github: string;
    
    // 弹幕默认文本
    danmakuDefaults: string[];
    
    // 玩家类型
    casualPlayer: string;
    
    // 开发者级别
    activeDeveloper: string;
    legendary: string;
    core: string;
    senior: string;
    prolific: string;
    active: string;
    
    // 统计标签
    library: string;
    playtime: string;
    commits: string;
    repos: string;
    fans: string;
    lists: string;
    
    // 状态文本
    analyzingRepos: string;
    noReposFound: string;
    
    // Toast 消息
    noPlatformReports: string;
    allPlaybackComplete: string;
    getTokenFailed: string;
    refreshingReport: string;
    reportRefreshSuccess: string;
    reportRefreshNoData: string;
    getLatestReportFailed: string;
    refreshReportFailed: string;
    adminOnlyGenerate: string;
    generateFailed: string;
    generateFailedRetry: string;
    deleteFailed: string;
    deleteFailedRetry: string;
    
    // UI 文本
    close: string;
    regenerateReport: string;
    aiSummary: string;
    deepInsightReport: string;
    platformReport: string;
    clickToView: string;
    stagePlaying: string;
    playAllReports: string;
    refreshing: string;
    refreshCurrentReport: string;
    continuePlay: string;
    pause: string;
    closeStage: string;
    clickToGenerate: string;
    noReport: string;
    anime: string;
    tvSeries: string;
    video: string;
    game: string;
    music: string;
    content: string;
    dataEcho: string;
    deepInsight: string;
    unknownPlatform: string;
    generating: string;
    generate: string;
    comprehensiveReport: string;
    adminOnlyGenerateHint: string;
    styleDescPlaceholder: string;
    allPlatformReport: string;
    confirmDeleteReport: string;
    tenThousandSuffix: string;
    noComprehensiveReport: string;
    useInputToGenerate: string;
    adminNotGenerated: string;
    waitingGenerate: string;
  };
  
  // 账户页面
  accountPage: {
    accountInfo: string;
    githubBinding: string;
    adminRole: string;
    normalUser: string;
    localAccount: string;
    githubAccount: string;
    displayName: string;
    bindGithub: string;
    githubBound: string;
    localLoginEnabled: string;
    changePassword: string;
    changePasswordDesc: string;
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
    enterCurrentPassword: string;
    atLeast8Chars: string;
    enterNewPasswordAgain: string;
    passwordMinLength: string;
    passwordMismatch: string;
    passwordSameAsOld: string;
    csrfTokenError: string;
    passwordChangeSuccess: string;
    changeFailed: string;
    networkError: string;
    changing: string;
    changePasswordBtn: string;
  };
  
  // 数据管理页面
  dataManagement: {
    neteaseMusic: string;
    loadStatusFailed: string;
    confirmRefreshData: string;
    csrfTokenError: string;
    dataRefreshed: string;
    refreshFailed: string;
    submitTaskFailed: string;
    confirmClearCache: string;
    cacheCleared: string;
    clearCacheFailed: string;
    unknown: string;
    backToConfig: string;
    refreshData: string;
    processData: string;
    process: string;
    clearCache: string;
    dataManagementTitle: string;
    dataManagementDesc: string;
    rawData: string;
    noData: string;
    smartFilter: string;
    noCache: string;
    refreshing: string;
    refresh: string;
    processing: string;
    clearing: string;
    clear: string;
    usageTitle: string;
    usageRawData: string;
    usageSmartFilter: string;
    usageBackground: string;
  };
  
  // 快速统计小组件
  quickStats: {
    widgetTitle: string;
    game: string;
    video: string;
    music: string;
    anime: string;
    tvSeries: string;
    loadCacheFailed: string;
    saveCacheFailed: string;
    fetchStatsFailed: string;
  };
  
  // 最近活动小组件
  recentActivity: {
    widgetTitle: string;
    yes: string;
    no: string;
    unknownProject: string;
    playTime: string;
    playtime2weeks: string;
    playtimeForever: string;
    achievementCount: string;
    achievements: string;
    lastPlayed: string;
    status: string;
    rating: string;
    progress: string;
    tags: string;
    notes: string;
    note: string;
    favorite: string;
    iconUrl: string;
    lastSync: string;
    description: string;
    category: string;
    genres: string;
    name: string;
    title: string;
    watchersCount: string;
    watchers: string;
    stargazersCount: string;
    forksCount: string;
    openIssuesCount: string;
    likedSongs: string;
    playlists: string;
    picUrl: string;
    coverUrl: string;
    sampleRate: string;
    games: string;
    videos: string;
    songs: string;
    albums: string;
    justNow: string;
    daysAgo: string;
    hoursAgo: string;
    loadCacheFailed: string;
    saveCacheFailed: string;
    fetchActivitiesFailed: string;
    myMusicCollection: string;
    techShareCollection: string;
  };
  
  // 天气小组件
  weatherWidget: {
    loadCacheFailed: string;
    saveCacheFailed: string;
    fetchWeatherFailed: string;
    sunny: string;
    sampleCity: string;
  };
  
  // 语录小组件
  quoteWidget: {
    loadCacheFailed: string;
    saveCacheFailed: string;
    fetchQuoteFailed: string;
    defaultQuote: string;
    anonymous: string;
    unavailable: string;
  };
  
  // 音乐播放器小组件
  musicPlayer: {
    sampleSong: string;
    sampleArtist: string;
    sampleLyricPrev: string;
    sampleLyricCurrent: string;
    sampleLyricNext: string;
    noLyrics: string;
  };
  
  // 平台卡片小组件
  platformCard: {
    neteaseMusic: string;
  };
  
  // 报告卡片小组件扩展
  reportCardWidget: {
    bilibili: string;
    neteaseMusic: string;
    beginnerDev: string;
    intermediateDev: string;
    seniorDev: string;
    veteranDev: string;
    legendaryDev: string;
    hardcorePlayer: string;
    happyMood: string;
    sadMood: string;
    passionateMood: string;
    sampleProject: string;
    sampleProjectDesc: string;
    sampleGame: string;
    sampleAnime: string;
    samplePlaylist: string;
    fetchReportFailed: string;
  };
  
  // 社交网络小组件扩展
  socialNetworkWidget: {
    fillPlatformName: string;
    fillUsernameOrUrl: string;
    fillPopupContent: string;
    invalidUrlPattern: string;
    createCustomPlatformFailed: string;
    confirmDeleteCustomPlatform: string;
    close: string;
    delete: string;
    longPressToEdit: string;
  };
  
  // Tapp 相关
  tapp: {
    // 通用
    apps: string;
    store: string;
    install: string;
    uninstall: string;
    start: string;
    stop: string;
    settings: string;
    running: string;
    stopped: string;
    installed: string;
    installing: string;
    version: string;
    author: string;
    
    // 分类
    categoryAI: string;
    categoryDataExtension: string;
    categoryWidget: string;
    categoryPageApp: string;
    categoryTool: string;
    categoryGame: string;
    categoryDemo: string;
    categoryTest: string;
    categoryPlatform: string;
    categoryProductivity: string;
    categoryEntertainment: string;
    categoryDevelopment: string;
    categorySocial: string;
    categoryMedia: string;
    categoryUtilities: string;
    categoryMusic: string;
    categoryVisualization: string;
    categoryData: string;
    
    // 权限
    permissions: string;
    noPermissions: string;
    basicPermission: string;
    elevatedPermission: string;
    privilegedPermission: string;
    grantedPermissions: string;
    
    // 权限标签
    permRegisterWidget: string;
    permReadPlatform: string;
    permWritePlatform: string;
    permRegisterPlatform: string;
    permAiGenerate: string;
    permAiAnalyze: string;
    permAiChat: string;
    permReadReport: string;
    permWriteReport: string;
    permStorage: string;
    permNotification: string;
    permFullscreen: string;
    permReadTheme: string;
    permConfirm: string;
    permNetworkFetch: string;
    permMediaControl: string;
    permMediaRead: string;
    permRegisterTheme: string;
    permRegisterAgent: string;
    permRegisterShortcut: string;
    permPublishEvent: string;
    permSubscribeEvent: string;
    
    // 权限描述
    permRegisterWidgetDesc: string;
    permReadPlatformDesc: string;
    permWritePlatformDesc: string;
    permRegisterPlatformDesc: string;
    permAiGenerateDesc: string;
    permAiAnalyzeDesc: string;
    permAiChatDesc: string;
    permReadReportDesc: string;
    permWriteReportDesc: string;
    permStorageDesc: string;
    permNotificationDesc: string;
    permFullscreenDesc: string;
    permReadThemeDesc: string;
    permConfirmDesc: string;
    permNetworkFetchDesc: string;
    permMediaControlDesc: string;
    permMediaReadDesc: string;
    permRegisterThemeDesc: string;
    permRegisterAgentDesc: string;
    permRegisterShortcutDesc: string;
    permPublishEventDesc: string;
    permSubscribeEventDesc: string;
    
    // 列表页面
    listTitle: string;
    listSubtitle: string;
    noAppsInstalled: string;
    noAppsInstalledDesc: string;
    browseStore: string;
    manualInstall: string;
    clickToOpen: string;
    confirmUninstall: string;
    noPermissionToOperate: string;
    loginRequiredToInstall: string;
    export: string;
    exportFailed: string;
    
    // 安装弹窗
    installTappTitle: string;
    dropTappFile: string;
    orClickToSelect: string;
    selectTappFile: string;
    invalidTappFile: string;
    installFailed: string;
    installSuccess: string;
    
    // 运行页面
    loadingApp: string;
    pleaseWait: string;
    cannotLoadApp: string;
    appNotExist: string;
    appCodeLoadFailed: string;
    loadAppFailed: string;
    backToAppList: string;
    exitFullscreen: string;
    fullscreen: string;
    stopApp: string;
    back: string;
    
    // 详情页面
    appSettings: string;
    customizeBehavior: string;
    noSettingsAvailable: string;
    noSettingsDesc: string;
    appInfo: string;
    detailInfo: string;
    appId: string;
    installedAt: string;
    lastRunAt: string;
    homepage: string;
    visit: string;
    loading: string;
    
    // AI 配额
    aiQuota: string;
    premiumQuota: string;
    standardQuota: string;
    dailyCalls: string;
    tokenUsage: string;
    
    // 商店
    storeTitle: string;
    storeSourceSettings: string;
    storeClose: string;
    refreshStore: string;
    searchApps: string;
    allApps: string;
    installedApps: string;
    loadingRemoteApps: string;
    loadRemoteFailed: string;
    noMatchingApps: string;
    totalApps: string;
    installedCount: string;
    remoteStore: string;
    cancel: string;
    retry: string;
    uninstallFailed: string;
    unknownError: string;
    
    // 商店源设置
    sourceManagement: string;
    addSource: string;
    sourceName: string;
    sourceUrl: string;
    official: string;
    disabled: string;
    enable: string;
    disable: string;
    deleteSource: string;
    fillNameAndUrl: string;
    invalidUrl: string;
    addSourceFailed: string;
    refreshAllStores: string;
    confirmDeleteSource: string;
    
    // 动态内容 API
    dynamicContent: string;
    dynamicContentDesc: string;
    dynamicContentSet: string;
    dynamicContentRemoved: string;
  };
  
  // 动态内容
  dynamicContent: {
    unavailable: string;
    noContent: string;
    loading: string;
    tappContent: string;
  };
}

// 获取默认语言
export function getDefaultLocale(): Locale {
  // 1. 先检查本地存储
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('locale');
    if (saved === 'zh-CN' || saved === 'en-US' || saved === 'ja-JP') {
      return saved;
    }
  }
  
  // 2. 检查浏览器语言
  if (typeof navigator !== 'undefined') {
    const browserLang = navigator.language || (navigator as any).userLanguage;
    if (browserLang) {
      // 中文环境
      if (browserLang.startsWith('zh')) {
        return 'zh-CN';
      }
      // 日文环境
      if (browserLang.startsWith('ja')) {
        return 'ja-JP';
      }
    }
  }
  
  // 3. 默认英文
  return 'en-US';
}

// 保存语言设置
export function saveLocale(locale: Locale): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('locale', locale);
  }
}
