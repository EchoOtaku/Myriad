import type { CSSProperties } from 'react'
import type { RigCharacterHandle } from '../../features/merope/rig/RigCharacter'
import type { MeropeActivity } from '../../features/merope/types'
import type { MoodBand } from '../agent/meropeVitals'
import type { WidgetComponentProps } from '../WidgetGrid'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { ADDRESSEE_UPDATED_EVENT, moodBand } from '../agent/meropeVitals'
import { WidgetShell } from './shared/WidgetShell'
import { WidgetSkeletonCover } from './shared/WidgetSkeleton'
import './MeropeWidget.css'

const DEFAULT_AGENT_NAME = 'Arael'
const DEFAULT_MOOD = 70

/** 电平格数 = 心情档位，四格对四档 */
const MOOD_LEVEL: Record<MoodBand, number> = {
  floor: 1,
  low: 2,
  normal: 3,
  high: 4,
}

const LEVEL_SLOTS = [0, 1, 2, 3]

function Nameplate({
  name,
  band,
  compact,
}: {
  name: string
  band: MoodBand | null
  compact?: boolean
}) {
  const o = useI18n().t.agentPersona.onboarding
  return (
    <div className="merope-widget__identity glass-surface">
      <strong>{name}</strong>
      {!compact && band ? (
        <div className="merope-widget__mood">
          <span>{o.moodLine.replace('{band}', o.mood[band])}</span>
          <span className="merope-widget__mood-level" aria-hidden>
            {LEVEL_SLOTS.map((slot) => (
              <i key={slot} data-on={slot < MOOD_LEVEL[band] || undefined} />
            ))}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function toMeropeActivity(raw: string | undefined): MeropeActivity {
  if (raw === 'talking' || raw === 'thinking') return raw
  return 'idle'
}

function hasPlayableRig(
  manifest: Awaited<ReturnType<typeof getSiteFace>>['manifest'],
): boolean {
  return Boolean(
    manifest &&
    isAnime25DPlayback(manifest.anime25dPlayback) &&
    manifest.textures[0]?.url,
  )
}

/**
 * 取景框与人物画布同比 → 播放器的等比缩放由宽度决定，人物横向铺满卡片，
 * 纵向溢出的身体被卡片裁掉。没有 rig 时交给 CSS 回落到 master portrait 的 3:4。
 */
function portraitFrameStyle(
  canvas: { width: number; height: number } | undefined,
): CSSProperties | undefined {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return undefined
  return {
    '--merope-widget-portrait': `${canvas.width} / ${canvas.height}`,
  } as CSSProperties
}

function MeropeWidgetPreview({ compact }: { compact?: boolean }) {
  return (
    <WidgetShell
      padding={0}
      className={`merope-widget${compact ? ' merope-widget--compact' : ''}`}
    >
      <div className="merope-widget__surface">
        <Nameplate name={DEFAULT_AGENT_NAME} band={null} compact={compact} />
      </div>
    </WidgetShell>
  )
}

function LiveMeropeWidget({ compact }: { compact: boolean }) {
  const { t } = useI18n()
  const { hasChecked, isAuthenticated } = useAuth()
  const [manifest, setManifest] =
    useState<Awaited<ReturnType<typeof getSiteFace>>['manifest']>(null)
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME)
  const [mood, setMood] = useState(DEFAULT_MOOD)
  const [activity, setActivity] = useState<MeropeActivity>('idle')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [vitalsReady, setVitalsReady] = useState(false)
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
      setVitalsReady(false)
      return undefined
    }
    let active = true
    const loadPersona = () => {
      void agentService
        .getPersona()
        .then((persona) => {
          if (!active || !persona) return
          setAgentName(persona.name.trim() || DEFAULT_AGENT_NAME)
          setMood(
            typeof persona.mood === 'number' ? persona.mood : DEFAULT_MOOD,
          )
          setActivity(toMeropeActivity(persona.activity))
          setVitalsReady(true)
        })
        .catch(() => {
          if (active) setVitalsReady(false)
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
  const stateClass = `merope-widget__rig merope-widget__rig--${activity}`
  const band = vitalsReady ? moodBand(mood) : null
  const surfaceStyle = useMemo(
    () => portraitFrameStyle(manifest?.anime25dPlayback?.pixelCanvas),
    [manifest],
  )

  return (
    <WidgetShell
      padding={0}
      className={`merope-widget${compact ? ' merope-widget--compact' : ''}`}
    >
      <div
        className="merope-widget__surface"
        style={surfaceStyle}
        aria-label={`${t.widgets.agentPersona}: ${agentName}`}
      >
        {showCharacter ? (
          <>
            <div className={stateClass}>
              <RigCharacter
                ref={rigRef}
                activity={activity}
                fallbackUrl={playableRig ? undefined : portraitUrl}
                manifest={manifest}
                mood={mood}
              />
            </div>
            <Nameplate name={agentName} band={band} compact={compact} />
          </>
        ) : !loading ? (
          <p className="merope-widget__empty" role="status">
            {failed ? t.merope.loadFailed : t.merope.assetEmpty}
          </p>
        ) : null}

        <WidgetSkeletonCover
          active={loading}
          preset="hero"
          label={t.common.loading}
          accent="var(--color-primary)"
        />
      </div>
    </WidgetShell>
  )
}

export const MeropeWidget = memo(
  ({ isPreview = false, config }: WidgetComponentProps) => {
    const compact = config.size === '2x2'
    return isPreview ? (
      <MeropeWidgetPreview compact={compact} />
    ) : (
      <LiveMeropeWidget compact={compact} />
    )
  },
)
