import type { ReactNode } from 'react'
import type { ManagedListItem } from '../../settings/ManagedList'
import {
  LuChevronDown as ChevronDown,
  LuExternalLink as ExternalLink,
  LuFileText as FileText,
  LuMessageCircle as MessageCircle,
  LuMonitor as Monitor,
  LuNewspaper as Newspaper,
  LuPackage as Package,
  LuPalette as Palette,
  LuSettings as Settings,
  LuShoppingCart as ShoppingCart,
  LuVideo as Video,
  LuWrench as Wrench,
} from '@lib/icons'
import { useCallback, useMemo, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { SettingsButton } from '../../settings/items/SettingsButton'
import { ManagedList } from '../../settings/ManagedList'
import { SettingTitleTag } from '../../settings/SettingTitleTag'
import './RSSHubRoutes.css'

export type RouteConfigRequirement = 'none' | 'server' | 'optional'

export interface RouteTemplate {
  path: string
  requiresConfig?: RouteConfigRequirement
  configNote?: string
}

const CATEGORIES = [
  { id: 'social', nameKey: 'rsshubCategorySocial' as const, icon: <MessageCircle /> },
  { id: 'video', nameKey: 'rsshubCategoryVideo' as const, icon: <Video /> },
  { id: 'news', nameKey: 'rsshubCategoryNews' as const, icon: <Newspaper /> },
  { id: 'blog', nameKey: 'rsshubCategoryBlog' as const, icon: <FileText /> },
  { id: 'programming', nameKey: 'rsshubCategoryProgramming' as const, icon: <Monitor /> },
  { id: 'design', nameKey: 'rsshubCategoryDesign' as const, icon: <Palette /> },
  { id: 'shopping', nameKey: 'rsshubCategoryShopping' as const, icon: <ShoppingCart /> },
  { id: 'other', nameKey: 'rsshubCategoryOther' as const, icon: <Package /> },
] as const

const POPULAR_ROUTES: { category: string; routes: RouteTemplate[] }[] = [
  {
    category: 'social',
    routes: [
      { path: '/bsky/profile/:handle' },
      { path: '/douban/people/:id/status' },
      { path: '/douban/group/:groupid' },
      { path: '/douban/movie/playing' },
      { path: '/douban/explore' },
      { path: '/telegram/channel/:id' },
      { path: '/weibo/oasis/user/:userid' },
    ],
  },
  {
    category: 'video',
    routes: [
      { path: '/bilibili/user/video/:uid' },
      { path: '/bilibili/ranking/:rid?' },
      { path: '/bilibili/popular/all' },
      { path: '/bilibili/weekly' },
      { path: '/bilibili/precious' },
      { path: '/bilibili/hot-search' },
      { path: '/bilibili/bangumi/media/:mediaid' },
      { path: '/bilibili/user/article/:uid' },
      { path: '/bilibili/audio/:id' },
      { path: '/acfun/user/video/:uid' },
    ],
  },
  {
    category: 'news',
    routes: [
      { path: '/sspai/index' },
      { path: '/sspai/matrix' },
      { path: '/sspai/author/:id' },
      { path: '/sspai/tag/:keyword' },
      { path: '/sspai/topic/:id' },
      { path: '/36kr/hot-list' },
      { path: '/36kr/newsflashes' },
      { path: '/thepaper/featured' },
      { path: '/zhihu/daily' },
      { path: '/cls/telegraph' },
    ],
  },
  {
    category: 'programming',
    routes: [
      { path: '/github/repos/:user' },
      { path: '/github/issue/:user/:repo' },
      { path: '/github/pull/:user/:repo' },
      { path: '/github/wiki/:user/:repo/:page?' },
      { path: '/github/topics/:name' },
      { path: '/hellogithub/home' },
      { path: '/hellogithub/volume' },
      { path: '/huggingface/daily-papers' },
      { path: '/anthropic/news' },
      { path: '/anthropic/research' },
      { path: '/web/articles' },
      { path: '/web/blog' },
      { path: '/hackernews/best' },
    ],
  },
  {
    category: 'blog',
    routes: [
      { path: '/rsshub/routes/:lang?' },
      { path: '/zhubai/:id' },
      { path: '/substack/:id' },
      { path: '/xlog/:handle' },
      { path: '/wordpress/:domain' },
      { path: '/zhiy/letters/:author' },
    ],
  },
  {
    category: 'design',
    routes: [
      { path: '/dribbble/popular/:timeframe?' },
      { path: '/dribbble/user/:name' },
      { path: '/zcool/discover/:type?' },
      { path: '/zcool/user/:uid' },
      { path: '/topys' },
    ],
  },
  {
    category: 'shopping',
    routes: [
      { path: '/smzdm/keyword/:keyword' },
      { path: '/smzdm/ranking/:rank_type/:rank_id' },
    ],
  },
  {
    category: 'other',
    routes: [
      { path: '/douban/book/latest' },
      { path: '/bangumi/calendar/today' },
      { path: '/steam/search/:params' },
      { path: '/earthquake/:region?' },
    ],
  },
]

const ROUTE_COUNT = POPULAR_ROUTES.reduce(
  (sum, group) => sum + group.routes.length,
  0,
)

function routeName(names: Record<string, string>, path: string): string {
  return names[path] || path
}

function findRoute(path: string): RouteTemplate | undefined {
  for (const group of POPULAR_ROUTES) {
    const match = group.routes.find((route) => route.path === path)
    if (match) return match
  }
  return undefined
}

export function RSSHubRouteExplorer({
  routePath,
  disabled = false,
  onSelect,
}: {
  routePath: string
  disabled?: boolean
  onSelect: (route: RouteTemplate) => void
}) {
  const { t } = useI18n()
  const phantasi = t.phantasi
  const names = phantasi.rsshubRouteNames as Record<string, string>
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<string | null>(null)

  const current = findRoute(routePath)
  const currentLabel = current ? routeName(names, current.path) : routePath

  const handlePick = useCallback(
    (route: RouteTemplate) => {
      onSelect(route)
      setOpen(false)
    },
    [onSelect],
  )

  const routes = useMemo(() => {
    return CATEGORIES.flatMap((item) => {
      if (category && category !== item.id) return []
      return POPULAR_ROUTES.find((group) => group.category === item.id)
        ?.routes ?? []
    })
  }, [category])

  const toItem = useCallback(
    (route: RouteTemplate): ManagedListItem => {
      const selected = routePath === route.path
      return {
        id: route.path,
        title: routeName(names, route.path),
        subtitle: route.path,
        className: selected ? 'is-on' : '',
        badge:
          route.requiresConfig === 'server'
            ? { label: phantasi.rsshubServerConfig, tone: 'warn' }
            : route.requiresConfig === 'optional'
              ? { label: phantasi.rsshubOptionalConfig, tone: 'default' }
              : undefined,
        renderHit: ({
          leading,
          main,
        }: {
          leading: ReactNode
          main: ReactNode
        }) => (
          <button
            type="button"
            className="managed-list-row-hit"
            disabled={disabled}
            onClick={() => handlePick(route)}
          >
            {leading}
            {main}
          </button>
        ),
      }
    },
    [
      phantasi.rsshubOptionalConfig,
      phantasi.rsshubServerConfig,
      disabled,
      handlePick,
      names,
      routePath,
    ],
  )

  return (
    <div
      className={`phantasi-rsshub-routes${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <button
        type="button"
        className="phantasi-rsshub-routes__summary"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen((next) => !next)
        }}
      >
        <span className="phantasi-rsshub-routes__summary-main">
          <span className="phantasi-rsshub-routes__summary-name">
            {phantasi.rsshubBrowsePopular}
          </span>
          {currentLabel ? (
            <span className="phantasi-rsshub-routes__summary-url">
              {currentLabel}
            </span>
          ) : null}
        </span>
        <span className="phantasi-rsshub-routes__summary-side">
          <SettingTitleTag variant="muted">{ROUTE_COUNT}</SettingTitleTag>
          <ChevronDown className="phantasi-rsshub-routes__chevron" />
        </span>
      </button>

      {open ? (
        <div className="phantasi-rsshub-routes__panel">
          <div className="phantasi-rsshub-routes__cats">
            <SettingTitleTag
              variant={!category ? 'default' : 'muted'}
              onClick={() => setCategory(null)}
            >
              {phantasi.all}
            </SettingTitleTag>
            {CATEGORIES.map((item) => (
              <SettingTitleTag
                key={item.id}
                variant={category === item.id ? 'default' : 'muted'}
                icon={item.icon}
                onClick={() => setCategory(item.id)}
              >
                {phantasi[item.nameKey]}
              </SettingTitleTag>
            ))}
          </div>
          <div className="phantasi-rsshub-routes__legend">
            <span className="phantasi-rsshub-routes__key phantasi-rsshub-routes__key--server">
              <Settings />
              {phantasi.rsshubServerConfig}
            </span>
            <span className="phantasi-rsshub-routes__key phantasi-rsshub-routes__key--optional">
              <Wrench />
              {phantasi.rsshubOptionalConfig}
            </span>
          </div>
          <ManagedList
            className="phantasi-rsshub-routes__list"
            items={routes.map(toItem)}
            emptyText={phantasi.rsshubBrowsePopular}
            maxHeight="11rem"
          />
          <SettingsButton
            size="sm"
            variant="ghost"
            icon={<ExternalLink />}
            onClick={() => {
              window.open(
                'https://docs.rsshub.app/routes',
                '_blank',
                'noopener,noreferrer',
              )
            }}
          >
            {phantasi.rsshubViewFullDocs}
          </SettingsButton>
        </div>
      ) : null}
    </div>
  )
}
