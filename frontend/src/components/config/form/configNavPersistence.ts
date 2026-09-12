import { LEGACY_CONFIG_SECTION_MAP } from './defaults'

export const CONFIG_NAV_STORAGE_KEY = 'myriad_config_nav_v1'

/** 侧栏「全部配置」默认顺序：基础与数据 → 智能 → 人与权限 → 模块与运维。 */
export const CONFIG_NAV_SECTIONS = [
  'basic',
  'platforms',
  'ai',
  'agent',
  'notifications',
  'oauth',
  'users',
  'permissions',
  'federation',
  'modules',
  'advanced',
  'tripo',
  'about',
] as const

export type ConfigNavSection = (typeof CONFIG_NAV_SECTIONS)[number]

/** 无 URL / 无 session 时落到侧栏第一项。 */
export const CONFIG_NAV_DEFAULT_SECTION: ConfigNavSection = 'basic'

export interface ConfigNavPersisted {
  section: string
  mobilePane?: 'nav' | 'section'
  platformFocus?: string | null
  scrollY?: number
}

function isKnownSection(section: string, isAdmin: boolean): boolean {
  if (section === 'federation' && !isAdmin) return false
  return (CONFIG_NAV_SECTIONS as readonly string[]).includes(section)
}

export function normalizeConfigSection(
  raw: string | null | undefined,
  isAdmin: boolean,
): string | null {
  if (!raw) return null
  const next = LEGACY_CONFIG_SECTION_MAP[raw] ?? raw
  return isKnownSection(next, isAdmin) ? next : null
}

/** 人设二级页旧深链是 ?section=ai&page=merope，归到 Agent。 */
export function resolveConfigSectionFromSearch(
  params: URLSearchParams,
  isAdmin: boolean,
): string | null {
  const page = params.get('page')
  if (page === 'merope' || page === 'merope-setup') return 'agent'
  return normalizeConfigSection(params.get('section'), isAdmin)
}

export function loadConfigNavPersisted(): ConfigNavPersisted | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CONFIG_NAV_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ConfigNavPersisted>
    if (!parsed || typeof parsed.section !== 'string') return null
    return {
      section: parsed.section,
      mobilePane:
        parsed.mobilePane === 'nav' || parsed.mobilePane === 'section'
          ? parsed.mobilePane
          : undefined,
      platformFocus:
        parsed.platformFocus === null ||
        typeof parsed.platformFocus === 'string'
          ? parsed.platformFocus
          : undefined,
      scrollY:
        typeof parsed.scrollY === 'number' &&
        Number.isFinite(parsed.scrollY) &&
        parsed.scrollY >= 0
          ? parsed.scrollY
          : undefined,
    }
  } catch {
    return null
  }
}

export function saveConfigNavPersisted(
  patch: Partial<ConfigNavPersisted>,
): void {
  if (typeof window === 'undefined') return
  try {
    const prev = loadConfigNavPersisted() ?? {
      section: CONFIG_NAV_DEFAULT_SECTION,
    }
    const next: ConfigNavPersisted = {
      section: patch.section ?? prev.section,
      mobilePane: patch.mobilePane ?? prev.mobilePane,
      platformFocus:
        patch.platformFocus !== undefined
          ? patch.platformFocus
          : prev.platformFocus,
      scrollY: patch.scrollY ?? prev.scrollY,
    }
    sessionStorage.setItem(CONFIG_NAV_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* private mode / quota */
  }
}

export function snapshotConfigNavScroll(): void {
  if (typeof window === 'undefined') return
  saveConfigNavPersisted({ scrollY: window.scrollY || window.pageYOffset || 0 })
}

/** URL ?section=, else sessionStorage, else 侧栏第一项 */
export function resolveInitialConfigSection(isAdmin: boolean): string {
  if (typeof window === 'undefined') return CONFIG_NAV_DEFAULT_SECTION
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = resolveConfigSectionFromSearch(params, isAdmin)
    if (fromUrl) return fromUrl
    const stored = loadConfigNavPersisted()
    const fromStore = normalizeConfigSection(stored?.section, isAdmin)
    if (fromStore) return fromStore
  } catch {
    /* ignore */
  }
  return CONFIG_NAV_DEFAULT_SECTION
}

/** replaceState ?section=; keep other query */
export function syncConfigSectionToUrl(section: string): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('section') === section) return
    url.searchParams.set('section', section)
    if (section !== 'agent') url.searchParams.delete('page')
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    /* ignore */
  }
}
