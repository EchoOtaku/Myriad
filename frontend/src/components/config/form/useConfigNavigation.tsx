import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { SectionSwitchDirection } from '../../settings'
import MyriadConfigIcon from '../MyriadConfigIcon'
import { LEGACY_CONFIG_SECTION_MAP, loadConfigFavorites } from './defaults'
import type { QuickAccessItem } from './types'
import {
  scheduleScrollToSettingGuide,
  scrollToSettingGuide,
} from '../../settings/guides/guideAnchor'

type NavI18n = {
  config: {
    platforms: string
    platformsDesc: string
    ai: string
    aiDesc: string
    basic: string
    basicDesc: string
    oauth: string
    oauthDesc: string
    federation: string
    federationDesc: string
    permissions: string
    permissionsDesc: string
    users: string
    usersDesc: string
    advanced: string
    advancedDesc: string
    about: string
    aboutDesc: string
    moduleSettings: string
    moduleSettingsDesc: string
  }
  notificationCenter: {
    title: string
    settingsDesc: string
  }
}

export function useConfigNavigation(isAdmin: boolean, t: NavI18n) {
  const [activeSection, setActiveSection] = useState('platforms')
  const [sectionDir, setSectionDir] =
    useState<SectionSwitchDirection>('forward')
  const [mobilePane, setMobilePane] = useState<'nav' | 'section'>('nav')
  const [isMobileLayout, setIsMobileLayout] = useState(false)
  const [platformFocus, setPlatformFocus] = useState<string | null>(null)
  const pendingGuideScrollRef = React.useRef<string | null>(null)
  const [favorites, setFavorites] = useState<string[]>(loadConfigFavorites)
  const [savedFavorites, setSavedFavorites] =
    useState<string[]>(loadConfigFavorites)

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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 1023px)')
    const sync = () => setIsMobileLayout(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const handleSectionChange = useCallback(
    (section: string, options?: { guidePath?: string | null }) => {
      const next = LEGACY_CONFIG_SECTION_MAP[section] ?? section
      // Non-admin must not land on federation (nav item is admin-only)
      if (next === 'federation' && !isAdmin) {
        return
      }
      const guidePath = options?.guidePath?.trim() || null
      pendingGuideScrollRef.current = guidePath

      const order = quickAccessItems.map((item) => item.section)
      const from = order.indexOf(activeSection)
      const to = order.indexOf(next)
      setSectionDir(from >= 0 && to >= 0 && to < from ? 'back' : 'forward')

      const sameSection = next === activeSection
      setActiveSection(next)
      setPlatformFocus(null)
      setMobilePane('section')

      if (sameSection && guidePath) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const path = pendingGuideScrollRef.current
            pendingGuideScrollRef.current = null
            if (path) scrollToSettingGuide(path)
          })
        })
      }
    },
    [quickAccessItems, activeSection, isAdmin],
  )

  // Deep link: /config?section=about|advanced|… (updater→about, mcp→notifications via LEGACY map)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const applySectionFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const raw = params.get('section')
      if (!raw) return
      const next = LEGACY_CONFIG_SECTION_MAP[raw] ?? raw
      const known = quickAccessItems.some((item) => item.section === next)
      if (!known) return
      setActiveSection(next)
      setPlatformFocus(null)
      setMobilePane('section')
    }
    applySectionFromUrl()
    window.addEventListener('popstate', applySectionFromUrl)
    return () => window.removeEventListener('popstate', applySectionFromUrl)
  }, [quickAccessItems])

  const scrollSettingsToTop = useCallback(() => {
    if (typeof window === 'undefined') return
    window.scrollTo({ top: 0, behavior: 'auto' })
    const path = pendingGuideScrollRef.current
    if (!path) return
    pendingGuideScrollRef.current = null
    scheduleScrollToSettingGuide(path)
  }, [])

  const handleMobileBackToNav = useCallback(() => {
    setMobilePane('nav')
    setPlatformFocus(null)
    scrollSettingsToTop()
  }, [scrollSettingsToTop])

  const toggleFavorite = useCallback((section: string) => {
    setFavorites((prev) =>
      prev.includes(section)
        ? prev.filter((id) => id !== section)
        : [...prev, section],
    )
  }, [])

  const getSectionProps = useCallback(
    (sectionId: string) => {
      const item = quickAccessItems.find((i) => i.id === sectionId)
      if (!item) {
        return { title: '', icon: null, description: '' }
      }
      return {
        title: item.label,
        icon: item.icon,
        sectionId: item.id,
        description: item.description,
      }
    },
    [quickAccessItems],
  )

  return {
    activeSection,
    setActiveSection,
    sectionDir,
    mobilePane,
    setMobilePane,
    isMobileLayout,
    platformFocus,
    setPlatformFocus,
    favorites,
    setFavorites,
    savedFavorites,
    setSavedFavorites,
    quickAccessItems,
    handleSectionChange,
    scrollSettingsToTop,
    handleMobileBackToNav,
    toggleFavorite,
    getSectionProps,
  }
}
