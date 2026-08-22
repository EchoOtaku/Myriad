import type { RigCharacterHandle } from './rig/RigCharacter'
import type { CompanionRigManifest } from './rig/types'
import type { CompanionActivity } from './types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ADDRESSEE_UPDATED_EVENT } from '../../components/agent/lifeVitals'
import { useI18n } from '../../contexts/I18nContext'
import { isExlight, useAnimationLevel } from '../../hooks/useAnimationLevel'
import { agentService } from '../../services/agent'
import { getPublicConfigDeduped } from '../../utils/requestDedup'
import { getSiteFace } from './api'
import { FACE_UPDATED_EVENT } from './events'
import {
  COMPANION_PERFORMANCE_EVENT,
  companionPerformanceEventDetail,
} from './performanceEvents'
import RigCharacter from './rig/RigCharacter'
import './companion.css'

function toCompanionActivity(raw: string | undefined): CompanionActivity {
  if (raw === 'talking' || raw === 'thinking') return raw
  return 'idle'
}

export default function AraelFaceOverlay() {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const still = isExlight(useAnimationLevel())
  const settingsOpen = pathname === '/config' || pathname.startsWith('/config/')
  const [visible, setVisible] = useState(false)
  const [manifest, setManifest] = useState<CompanionRigManifest | null>(null)
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [mood, setMood] = useState(70)
  const [activity, setActivity] = useState<CompanionActivity>('idle')
  const rigCharacterRef = useRef<RigCharacterHandle>(null)

  const refresh = useCallback(async () => {
    const publicConfig = await getPublicConfigDeduped()
    if (!publicConfig?.agentLifeEnabled) {
      setVisible(false)
      return
    }
    const [face, persona] = await Promise.all([
      getSiteFace(),
      agentService.getPersona().catch(() => null),
    ])
    if (!face.manifest && !face.portraitUrl) {
      setVisible(false)
      return
    }
    setManifest(face.manifest)
    setPortraitUrl(face.portraitUrl)
    setMood(typeof persona?.mood === 'number' ? persona.mood : 70)
    setActivity(toCompanionActivity(persona?.activity))
    setVisible(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    void refresh().catch(() => {
      if (!cancelled) setVisible(false)
    })
    const onChange = () => {
      void refresh().catch(() => {
        if (!cancelled) setVisible(false)
      })
    }
    window.addEventListener(ADDRESSEE_UPDATED_EVENT, onChange)
    window.addEventListener(FACE_UPDATED_EVENT, onChange)
    window.addEventListener('arael-persona-updated', onChange)
    return () => {
      cancelled = true
      window.removeEventListener(ADDRESSEE_UPDATED_EVENT, onChange)
      window.removeEventListener(FACE_UPDATED_EVENT, onChange)
      window.removeEventListener('arael-persona-updated', onChange)
    }
  }, [refresh])

  useEffect(() => {
    const onPerformance = (event: Event) => {
      const detail = companionPerformanceEventDetail(
        (event as CustomEvent<unknown>).detail,
      )
      if (!detail) return
      rigCharacterRef.current?.playMotionPlan()
    }
    window.addEventListener(COMPANION_PERFORMANCE_EVENT, onPerformance)
    return () => {
      window.removeEventListener(COMPANION_PERFORMANCE_EVENT, onPerformance)
    }
  }, [])

  if (!visible || !portraitUrl || settingsOpen) return null

  return (
    <aside className="dlc-stage" aria-label={t.companion.faceStage}>
      <div className="dlc-character">
        <RigCharacter
          ref={rigCharacterRef}
          activity={activity}
          fallbackUrl={portraitUrl}
          manifest={still ? null : manifest}
          mood={mood}
        />
      </div>
    </aside>
  )
}
