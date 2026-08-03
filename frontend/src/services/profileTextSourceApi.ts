/**
 * 名称/简介文案来源 API 客户端（与画像源独立）。
 *
 * - GET /api/users/me/profile-text-sources
 * - PUT /api/users/me/profile-text-source
 * - GET /api/admin/users/{id}/profile-text-sources
 * - PUT /api/admin/users/{id}/profile-text-source
 *
 * 切换成功后广播 `notifyProfileDisplayChanged()`，首页信息条 / 控制面板
 * 站长条会强制刷新 name/bio（不改 avatar 来源）。
 */

import apiService from './api'
import { notifyProfileDisplayChanged } from './profileDisplayEvents'

export type ProfileTextSourceKind = 'auto' | 'account' | 'identity' | 'platform'

export interface ProfileTextSourceItem {
  kind: ProfileTextSourceKind
  ref: string
  label: string
  sublabel: string | null
  preview_name: string | null
  preview_bio: string | null
  is_current: boolean
}

export interface ProfileTextSourcesResponse {
  current: { kind: ProfileTextSourceKind; ref: string | null }
  sources: ProfileTextSourceItem[]
}

interface SetProfileTextSourceResponse {
  kind: ProfileTextSourceKind
  ref: string | null
  name: string | null
  bio: string | null
  platform: string | null
}

export const profileTextSourceApi = {
  async listMine(): Promise<ProfileTextSourcesResponse> {
    return apiService.get<ProfileTextSourcesResponse>(
      '/users/me/profile-text-sources',
    )
  },

  async setMine(
    kind: ProfileTextSourceKind,
    ref?: string | null,
  ): Promise<SetProfileTextSourceResponse> {
    const response = await apiService.put<SetProfileTextSourceResponse>(
      '/users/me/profile-text-source',
      { kind, ref: ref ?? null },
    )
    notifyProfileDisplayChanged()
    return response
  },

  async listForUser(userId: number): Promise<ProfileTextSourcesResponse> {
    return apiService.get<ProfileTextSourcesResponse>(
      `/admin/users/${userId}/profile-text-sources`,
    )
  },

  /**
   * Admin: set name/bio source for another user.
   * Only broadcast global refresh when the target is the viewer or site owner —
   * editing a random user must not flash the homepage owner card.
   */
  async setForUser(
    userId: number,
    kind: ProfileTextSourceKind,
    ref?: string | null,
    options?: { broadcast?: boolean },
  ): Promise<SetProfileTextSourceResponse> {
    const response = await apiService.put<SetProfileTextSourceResponse>(
      `/admin/users/${userId}/profile-text-source`,
      { kind, ref: ref ?? null },
    )
    if (options?.broadcast) {
      notifyProfileDisplayChanged()
    }
    return response
  },
}

export default profileTextSourceApi
