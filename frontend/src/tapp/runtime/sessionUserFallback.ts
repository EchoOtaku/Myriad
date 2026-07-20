/**
 * Session-cookie fallback for tapp user/role when Runtime Grant is dead or
 * /api/tapp/context/user fails. Uses the same /api/auth/me session as the host.
 */

import { API_URL } from '../../config'

export type HostUserRole = 'guest' | 'user' | 'admin'

export interface SessionUserSnapshot {
  id: string
  username: string
  display_name?: string | null
  avatar_url?: string | null
  avatar?: string | null
  isAdmin: boolean
  role: HostUserRole
  authenticated: boolean
}

interface AuthMeResponse {
  id?: number | string
  username?: string
  display_name?: string | null
  avatar_url?: string | null
  is_admin?: boolean
  is_owner?: boolean
}

/**
 * Probe the host session via cookie. Returns null when unauthenticated / error.
 * Does not use Runtime Grant — safe after AuthContext.destroyAll().
 */
export async function fetchSessionUserSnapshot(): Promise<SessionUserSnapshot | null> {
  try {
    const response = await fetch(`${API_URL}/api/auth/me`, {
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const data = (await response.json()) as AuthMeResponse
    const numericId =
      typeof data.id === 'number'
        ? data.id
        : typeof data.id === 'string'
          ? Number.parseInt(data.id, 10)
          : NaN
    if (!Number.isFinite(numericId) || numericId <= 0) return null
    const username =
      typeof data.username === 'string' ? data.username.trim() : ''
    if (!username) return null
    const isAdmin = data.is_admin === true
    return {
      id: `user_${numericId}`,
      username,
      display_name: data.display_name ?? null,
      avatar_url: data.avatar_url ?? null,
      avatar: data.avatar_url ?? null,
      isAdmin,
      role: isAdmin ? 'admin' : 'user',
      authenticated: true,
    }
  } catch {
    return null
  }
}

export function roleFromSessionSnapshot(
  snap: SessionUserSnapshot | null,
): HostUserRole {
  if (!snap) return 'guest'
  return snap.role
}
