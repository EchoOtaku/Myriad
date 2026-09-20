import { useEffect, useMemo, useState } from 'react'

import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { agentSettingsRedirectFromSearch } from '../components/agent/settings/agentSettingsPath'
import AnimatedView from '../components/AnimatedView'
import ConfigForm from '../components/ConfigForm'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../contexts/I18nContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { buildPrivatePageSeo } from '../utils/modulePageSeo'

export default function Config() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const { isAdmin: authIsAdmin, isAuthenticated, hasChecked } = useAuth()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const agentHome = agentSettingsRedirectFromSearch(location.search)

  usePageSeo(
    useMemo(
      () =>
        buildPrivatePageSeo({
          label: t.nav.config,
          path: '/config',
        }),
      [t],
    ),
  )

  useEffect(() => {
    if (!hasChecked) return
    if (!isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    if (!authIsAdmin) {
      navigate('/', { replace: true })
      return
    }
    setIsAdmin(true)
    setLoading(false)
  }, [hasChecked, authIsAdmin, isAuthenticated, navigate])

  if (agentHome) {
    return <Navigate to={agentHome} replace />
  }

  if (loading) {
    return null
  }

  if (!isAdmin) {
    return null
  }

  return (
    <AnimatedView className="min-h-screen px-4 sm:px-6 pt-20 pb-24 md:pb-12">
      <ConfigForm />
    </AnimatedView>
  )
}
