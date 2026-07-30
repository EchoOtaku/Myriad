/**
 * ui_config bag 字段归属（单一真相源）。
 * Section 组件 re-export 同名常量，避免与壳层 key 集漂移。
 */

/** UI（基础）页：不含 base_url（域名走 SiteUrlField 独立 API） */
export const UI_RESET_KEYS: readonly string[] = Object.freeze([
  'wallpaper_url',
  'wallpaper_blur',
  'site_title',
  'site_description',
  'site_favicon',
  'site_icp',
  'site_gongan',
  'cloud_sponsors',
  'evocative_parallax',
  'evocative_dynamic_blur',
  'evocative_ripple',
  'evocative_fps',
  'evocative_ripple_quality',
])

/** 数据平台页：访客统计开关 */
export const PLATFORMS_UI_RESET_KEYS: readonly string[] = Object.freeze([
  'analytics_enabled',
])

/** 模块页：音乐播放器（库/报告/一言走独立 draft） */
export const MODULE_UI_RESET_KEYS: readonly string[] = Object.freeze([
  'music_enabled',
  'music_source',
  'music_playlist_id',
])

/** 高级页：网络代理 + API 镜像 */
export const ADVANCED_RESET_KEYS: readonly string[] = Object.freeze([
  'proxy_enabled',
  'proxy_url',
  'proxy_bypass',
  'gemini_base_url',
  'github_api_base_url',
])

/** 全量重置时允许写入的 bag key（不含 base_url） */
export const ALL_OWNED_UI_BAG_KEYS: readonly string[] = Object.freeze([
  ...UI_RESET_KEYS,
  ...PLATFORMS_UI_RESET_KEYS,
  ...MODULE_UI_RESET_KEYS,
  ...ADVANCED_RESET_KEYS,
])

/** 变更后需要硬刷新页面的 bag key（代理 / API 镜像影响出站与运行时） */
export const RUNTIME_RELOAD_UI_BAG_KEYS: readonly string[] = Object.freeze([
  ...ADVANCED_RESET_KEYS,
])

export function bagFieldValue(
  fields: Array<{ key: string; value: string }> | undefined,
  key: string,
): string | undefined {
  return fields?.find((f) => f.key === key)?.value
}

/**
 * bag / 平台 / AI / 自动刷新变更是否需要 `reloadSystemConfig` + 整页刷新。
 * 纯展示项（壁纸、站点元数据、动效、访客统计、音乐）只落库，不必硬刷。
 */
export function configChangesNeedHardReload(
  next: {
    platforms: unknown
    auto_fetch: unknown
    ai_config: unknown
    ui_config?: { config_fields?: Array<{ key: string; value: string }> }
  },
  prev: {
    platforms: unknown
    auto_fetch: unknown
    ai_config: unknown
    ui_config?: { config_fields?: Array<{ key: string; value: string }> }
  },
  deepEqual: (a: unknown, b: unknown) => boolean,
): boolean {
  if (!deepEqual(next.platforms, prev.platforms)) return true
  if (!deepEqual(next.auto_fetch, prev.auto_fetch)) return true
  if (!deepEqual(next.ai_config, prev.ai_config)) return true

  const nextFields = next.ui_config?.config_fields
  const prevFields = prev.ui_config?.config_fields
  for (const key of RUNTIME_RELOAD_UI_BAG_KEYS) {
    if (bagFieldValue(nextFields, key) !== bagFieldValue(prevFields, key)) {
      return true
    }
  }
  return false
}
