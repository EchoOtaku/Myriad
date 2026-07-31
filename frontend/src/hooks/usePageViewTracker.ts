/**
 * SPA route → pageview + engagement.
 * Waits for auth; excludes admin/owner self-traffic.
 */

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  trackPageview,
  getOrCreateVisitorId,
  trackEvent,
  setAnalyticsStaffSession,
  setAnalyticsAdminSession,
} from '../utils/siteAnalytics'
import {
  trackProductEvent,
  AnalyticsEvents,
} from '../utils/analyticsEvents'

export {
  getOrCreateVisitorId,
  trackEvent,
  trackPageview,
  setAnalyticsStaffSession,
  setAnalyticsAdminSession,
  trackProductEvent,
  AnalyticsEvents,
}

export function usePageViewTracker() {
  const location = useLocation()
  const { isAdmin, hasChecked, user } = useAuth()
  const isOwner = Boolean(user?.is_owner)
  const isStaff = isAdmin || isOwner
  const lastPathRef = useRef<string | null>(null)

  useEffect(() => {
    setAnalyticsStaffSession({ isAdmin, isOwner })
  }, [isAdmin, isOwner])

  useEffect(() => {
    if (!hasChecked) return
    if (isStaff) {
      lastPathRef.current = location.pathname || '/'
      return
    }

    const path = location.pathname || '/'
    if (lastPathRef.current === path) return
    lastPathRef.current = path
    trackPageview(path)
  }, [location.pathname, hasChecked, isStaff])
}

export default usePageViewTracker
