/**
 * 聊天档：输入框上面的人设形象。
 *
 * 和首页小组件同一份主立绘 / Rig。放大 2.5，裁掉底下 1/5，底边模糊收。
 * 不套小组件外壳，也不是玻璃。
 * 这块不是玻璃 —— 输入框已经是 .glass，再套一层会糊成乳白带。
 */

import type { CSSProperties } from 'react'
import type { RigCharacterHandle } from '../../features/merope/rig/RigCharacter'
import type { MeropeRigManifest } from '../../features/merope/rig/types'
import type { MeropeActivity } from '../../features/merope/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { isAnime25DPlayback } from '../../features/merope/anime25drig/types'
import { getSiteFace } from '../../features/merope/api'
import {
  FACE_UPDATED_EVENT,
  PERSONA_UPDATED_EVENT,
} from '../../features/merope/events'
import { semanticRigCapabilities } from '../../features/merope/motion/rigStateSummary'
import { useRigMotionLifecycle } from '../../features/merope/motion/useRigMotionLifecycle'
import {
  MEROPE_STATE_EVENT,
  meropeStateEventDetail,
} from '../../features/merope/performanceEvents'
import RigCharacter from '../../features/merope/rig/RigCharacter'
import { agentService } from '../../services/agent'
import { ADDRESSEE_UPDATED_EVENT } from '../agent/meropeVitals'

const DEFAULT_AGENT_NAME = 'Arael'
const DEFAULT_MOOD = 70

function toMeropeActivity(raw: string | undefined): MeropeActivity {
  if (raw === 'talking' || raw === 'thinking') return raw
  return 'idle'
}

function hasPlayableRig(manifest: MeropeRigManifest | null): boolean {
  return Boolean(
    manifest &&
    isAnime25DPlayback(manifest.anime25dPlayback) &&
    manifest.textures[0]?.url,
  )
}

function portraitStyle(
  canvas: { width: number; height: number } | undefined,
): CSSProperties | undefined {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return undefined
  return {
    '--agent-face-portrait': `${canvas.width} / ${canvas.height}`,
  } as CSSProperties
}

export function AgentPanelFace() {
  const { t } = useI18n()
  const { hasChecked, isAuthenticated } = useAuth()
  const [manifest, setManifest] = useState<MeropeRigManifest | null>(null)
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME)
  const [mood, setMood] = useState(DEFAULT_MOOD)
  const [activity, setActivity] = useState<MeropeActivity>('idle')
  const [personaOn, setPersonaOn] = useState(true)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const faceRequestRef = useRef(0)
  const rigRef = useRef<RigCharacterHandle>(null)
  const capabilities = useMemo(() => semanticRigCapabilities(manifest), [manifest])
  useRigMotionLifecycle(rigRef, { mood, activity, capabilities })

  const loadFace = useCallback(() => {
    const request = ++faceRequestRef.current
    setLoading(true)
    setFailed(false)
    void getSiteFace()
      .then((face) => {
        if (request !== faceRequestRef.current) return
        setManifest(face.manifest)
        setPortraitUrl(face.portraitUrl)
      })
      .catch(() => {
        if (request !== faceRequestRef.current) return
        setManifest(null)
        setPortraitUrl(null)
        setFailed(true)
      })
      .finally(() => {
        if (request === faceRequestRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadFace()
    window.addEventListener(FACE_UPDATED_EVENT, loadFace)
    return () => {
      window.removeEventListener(FACE_UPDATED_EVENT, loadFace)
      faceRequestRef.current += 1
    }
  }, [loadFace])

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = meropeStateEventDetail(
        (event as CustomEvent<unknown>).detail,
      )
      if (!detail) return
      setMood(detail.mood.after)
      setActivity(toMeropeActivity(detail.activity))
    }
    window.addEventListener(MEROPE_STATE_EVENT, onState)
    return () => window.removeEventListener(MEROPE_STATE_EVENT, onState)
  }, [])

  useEffect(() => {
    if (!hasChecked || !isAuthenticated) {
      setPersonaOn(true)
      return undefined
    }
    let active = true
    const loadPersona = () => {
      void agentService
        .getPersona()
        .then((persona) => {
          if (!active) return
          if (!persona) {
            setPersonaOn(false)
            return
          }
          setPersonaOn(true)
          setAgentName(persona.name.trim() || DEFAULT_AGENT_NAME)
          setMood(
            typeof persona.mood === 'number' ? persona.mood : DEFAULT_MOOD,
          )
          setActivity(toMeropeActivity(persona.activity))
        })
        .catch(() => {
          if (active) setFailed(true)
        })
    }
    loadPersona()
    window.addEventListener(PERSONA_UPDATED_EVENT, loadPersona)
    window.addEventListener(ADDRESSEE_UPDATED_EVENT, loadPersona)
    return () => {
      active = false
      window.removeEventListener(PERSONA_UPDATED_EVENT, loadPersona)
      window.removeEventListener(ADDRESSEE_UPDATED_EVENT, loadPersona)
    }
  }, [hasChecked, isAuthenticated])

  const playableRig = hasPlayableRig(manifest)
  const showCharacter = playableRig || Boolean(portraitUrl)
  const emptyMessage = failed
    ? t.merope.loadFailed
    : !personaOn
      ? t.agentPanel.agentPersonaOff
      : t.merope.assetEmpty
  const surfaceStyle = useMemo(
    () => portraitStyle(manifest?.anime25dPlayback?.pixelCanvas),
    [manifest],
  )

  return (
    <div
      className="agent-panel-face"
      style={surfaceStyle}
      data-activity={activity}
      aria-label={`${t.merope.title}: ${agentName}`}
      aria-busy={loading || undefined}
    >
      {showCharacter ? (
        <div className="agent-panel-face-rig">
          <RigCharacter
            ref={rigRef}
            activity={activity}
            fallbackUrl={playableRig ? undefined : portraitUrl}
            manifest={manifest}
            mood={mood}
          />
        </div>
      ) : !loading ? (
        <span className="agent-panel-tag" data-block="true" role="status">
          <span className="agent-panel-tag-text">{emptyMessage}</span>
        </span>
      ) : null}
    </div>
  )
}
