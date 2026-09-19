/** 站长公开资料的组件状态；变更靠 avatar/profile-display 广播。 */
import type { SiteOwnerProfile } from '../services/siteOwnerProfile'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  onAvatarChanged,
  onProfileDisplayChanged,
} from '../services/profileDisplayEvents'
import { fetchSiteOwnerProfile } from '../services/siteOwnerProfile'

interface SiteOwnerProfileOptions {

  /** 站长资料尚未就绪时的占位名（通常是站点标题）。 */
  fallbackName?: string
  fallbackBio?: string

  /** false 时不发请求也不回退占位。控制面板只有站长需要这份资料。 */
  enabled?: boolean
}

export function useSiteOwnerProfile({
  fallbackName,
  fallbackBio,
  enabled = true,
}: SiteOwnerProfileOptions = {}) {
  const [profile, setProfile] = useState<SiteOwnerProfile | null>()

  const [avatarEpoch, setAvatarEpoch] = useState(0)
  const requestGen = useRef(0)
  const active = useRef(false)

  // 双发时后一次 refresh 会 supersede；用 ref 记住本轮要 bump epoch。
  const pendingAvatarBump = useRef(false)

  const refresh = useCallback(
    async (force = false) => {
      if (!active.current || !enabled) return
      const gen = ++requestGen.current
      const next = await fetchSiteOwnerProfile({ force })

      // 被更新的 force 刷新 superseded 时丢弃陈旧结果。
      if (!active.current || gen !== requestGen.current) return
      setProfile(next)

      // 仅头像相关变更 bump epoch。纯文案刷新不得 bump，否则首页头像闪一下。
      if (force && pendingAvatarBump.current) {
        pendingAvatarBump.current = false
        setAvatarEpoch((n) => n + 1)
      }
    },
    [enabled],
  )

  useEffect(() => {
    active.current = true
    if (enabled) void refresh(false)
    else setProfile(undefined)
    return () => {
      active.current = false
      requestGen.current++
      pendingAvatarBump.current = false
    }
  }, [enabled, refresh])

  useEffect(() => {
    if (!enabled) return
    const offDisplay = onProfileDisplayChanged(() => void refresh(true))
    const offAvatar = onAvatarChanged(() => {
      pendingAvatarBump.current = true
      void refresh(true)
    })
    return () => {
      offDisplay()
      offAvatar()
    }
  }, [enabled, refresh])

  // 占位文案属于展示，不参与请求或事件订阅的生命周期。
  const displayedProfile = useMemo(() => {
    if (!enabled || profile === undefined) return null
    return profile ?? (fallbackName === undefined
      ? null
      : { name: fallbackName, avatar: null, bio: fallbackBio ?? '' })
  }, [enabled, profile, fallbackName, fallbackBio])

  return { profile: displayedProfile, refresh, avatarEpoch }
}
