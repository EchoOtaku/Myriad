/** Installed Tapp discovery and runtime state controls. */

import type { TappManifest } from '../types'
import { apiRequest } from './TappHttpClient'

export interface TappListItem {
  id: string
  name: string
  version: string
  description?: string
  icon?: string
  iconSvg?: string
  status: string
  installedAt: string
  lastRunAt?: string
  isTemporary?: boolean
  isAdminTapp?: boolean
}

export interface TappDetail {
  id: string
  name: string
  version: string
  description?: string
  author?: {
    name: string
    email?: string
    url?: string
  }
  icon?: string
  theme_color?: string
  manifest: TappManifest
  status: string
  granted_permissions: string[]
  installed_at: string
  last_run_at?: string
  user_role?: string
  is_temporary?: boolean
  is_admin_tapp?: boolean
}

export interface RecentTappItem {
  id: string
  name: string
  icon?: string
  iconSvg?: string
  themeColor?: string
  lastRunAt: string
  runCount: number
}

export async function listTapps(): Promise<TappListItem[]> {
  return apiRequest('/api/tapps')
}

export async function listTappDetails(): Promise<TappDetail[]> {
  return apiRequest('/api/tapps/details')
}

export async function getRecentTapps(
  limit: number = 10,
): Promise<RecentTappItem[]> {
  return apiRequest(`/api/tapps/recent?limit=${limit}`)
}

export async function getTapp(tappId: string): Promise<TappDetail> {
  return apiRequest(`/api/tapps/${encodeURIComponent(tappId)}`)
}

export async function startTapp(tappId: string): Promise<void> {
  return apiRequest(`/api/tapps/${encodeURIComponent(tappId)}/start`, {
    method: 'POST',
  })
}

export async function stopTapp(tappId: string): Promise<void> {
  return apiRequest(`/api/tapps/${encodeURIComponent(tappId)}/stop`, {
    method: 'POST',
  })
}
