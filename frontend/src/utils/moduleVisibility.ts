import { useCallback, useEffect, useState } from 'react'
import apiService from '../services/api'

export type ModuleVisibilityLevel = 'all' | 'authenticated' | 'admin'
export type ModuleVisibilityKey = 'library' | 'brew' | 'reports' | 'tapp'

export interface ModuleVisibilityPreferences {
  modules: Record<ModuleVisibilityKey, ModuleVisibilityLevel>
}

interface ModuleVisibilityResponse {
  success: boolean
  preferences?: ModuleVisibilityPreferences
  message?: string
}

export const MODULE_VISIBILITY_KEYS: ModuleVisibilityKey[] = [
  'library',
  'brew',
  'reports',
  'tapp',
]

export const MODULE_VISIBILITY_LEVELS: ModuleVisibilityLevel[] = [
  'all',
  'authenticated',
  'admin',
]

export const MODULE_VISIBILITY_UPDATED_EVENT =
  'module-visibility-preferences-updated'

export const DEFAULT_MODULE_VISIBILITY_PREFERENCES: ModuleVisibilityPreferences =
  {
    modules: {
      library: 'all',
      brew: 'all',
      reports: 'all',
      tapp: 'all',
    },
  }

function isVisibilityLevel(value: unknown): value is ModuleVisibilityLevel {
  return (
    value === 'all' || value === 'authenticated' || value === 'admin'
  )
}

export function normalizeModuleVisibilityPreferences(
  preferences?: Partial<ModuleVisibilityPreferences>,
): ModuleVisibilityPreferences {
  return {
    modules: MODULE_VISIBILITY_KEYS.reduce(
      (acc, key) => {
        const value = preferences?.modules?.[key]
        acc[key] = isVisibilityLevel(value)
          ? value
          : DEFAULT_MODULE_VISIBILITY_PREFERENCES.modules[key]
        return acc
      },
      {} as Record<ModuleVisibilityKey, ModuleVisibilityLevel>,
    ),
  }
}

export function areModuleVisibilityPreferencesEqual(
  left: ModuleVisibilityPreferences,
  right: ModuleVisibilityPreferences,
) {
  return MODULE_VISIBILITY_KEYS.every(
    (key) => left.modules[key] === right.modules[key],
  )
}

export function canAccessModuleVisibility(
  visibility: ModuleVisibilityLevel,
  viewer: { isAuthenticated: boolean; isAdmin: boolean },
) {
  if (visibility === 'all') return true
  if (visibility === 'authenticated') return viewer.isAuthenticated
  return viewer.isAdmin
}

export function getModuleVisibilityKeyForPath(
  pathname: string,
): ModuleVisibilityKey | null {
  if (pathname === '/library' || pathname.startsWith('/library/')) {
    return 'library'
  }
  if (pathname === '/brew' || pathname.startsWith('/brew/')) {
    return 'brew'
  }
  if (pathname === '/reports' || pathname.startsWith('/reports/')) {
    return 'reports'
  }
  if (pathname === '/tapp' || pathname.startsWith('/tapp/')) {
    return 'tapp'
  }
  return null
}

export async function fetchModuleVisibilityPreferences() {
  const response = await apiService.get<ModuleVisibilityResponse>(
    '/config/module-visibility',
  )
  return normalizeModuleVisibilityPreferences(response.preferences)
}

export async function updateModuleVisibilityPreferences(
  preferences: ModuleVisibilityPreferences,
) {
  const normalized = normalizeModuleVisibilityPreferences(preferences)
  const response = await apiService.put<ModuleVisibilityResponse>(
    '/config/module-visibility',
    normalized,
  )
  if (!response.success) {
    throw new Error(response.message || 'Failed to save module visibility')
  }
  return normalizeModuleVisibilityPreferences(response.preferences)
}

export function dispatchModuleVisibilityPreferencesUpdated(
  preferences: ModuleVisibilityPreferences,
) {
  window.dispatchEvent(
    new CustomEvent(MODULE_VISIBILITY_UPDATED_EVENT, {
      detail: normalizeModuleVisibilityPreferences(preferences),
    }),
  )
}

export function useModuleVisibilityPreferences() {
  const [preferences, setPreferences] = useState<ModuleVisibilityPreferences>(
    DEFAULT_MODULE_VISIBILITY_PREFERENCES,
  )
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      setIsLoading(true)
      const nextPreferences = await fetchModuleVisibilityPreferences()
      setPreferences(nextPreferences)
    } catch {
      setPreferences(DEFAULT_MODULE_VISIBILITY_PREFERENCES)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()

    const handleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ModuleVisibilityPreferences>).detail
      setPreferences(normalizeModuleVisibilityPreferences(detail))
      setIsLoading(false)
    }

    window.addEventListener(MODULE_VISIBILITY_UPDATED_EVENT, handleUpdated)
    return () => {
      window.removeEventListener(MODULE_VISIBILITY_UPDATED_EVENT, handleUpdated)
    }
  }, [reload])

  return { preferences, isLoading, reload }
}
