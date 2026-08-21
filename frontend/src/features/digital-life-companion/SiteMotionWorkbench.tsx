import type { RigCharacterHandle } from './rig/RigCharacter'
import type { CompanionRigManifest, RigMotionProfile } from './rig/types'
import type { CompanionActivity } from './types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FACE_UPDATED_EVENT } from '../../components/agent/lifeVitals'
import { InfoActionCard, InputItem, SettingGroup } from '../../components/settings'
import { useI18n } from '../../contexts/I18nContext'
import {
  decomposeSitePortraitWithSeeThrough,
  generateSitePortrait,
  getSeeThroughStatus,
  getSiteFace,
  migrateCompanionRig,
  updateCompanionRigClips,
  updateCompanionRigMotionProfile,
  updateSeeThroughToken,
} from './api'
import {
  commitRigPsdAsset,
  preflightRigPsdAsset,
} from './assets/pipeline'
import MotionWorkbench from './rig/MotionWorkbench'
import RigCharacter from './rig/RigCharacter'
import './companion.css'
import './life-motion-home.css'

function toCompanionActivity(raw: string): CompanionActivity {
  if (raw === 'talking' || raw === 'thinking') return raw
  return 'idle'
}

function notifyFaceUpdated(): void {
  window.dispatchEvent(new CustomEvent(FACE_UPDATED_EVENT))
  window.dispatchEvent(new CustomEvent('arael-persona-updated'))
}

interface Props {
  mood: number
  activity: string
}

export default function SiteMotionWorkbench({ mood, activity }: Props) {
  const { t } = useI18n()
  const [rigManifest, setRigManifest] = useState<CompanionRigManifest | null>(
    null,
  )
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [generationFingerprint, setGenerationFingerprint] = useState<
    string | null
  >(null)
  const [assetId, setAssetId] = useState<string | null>(null)
  const [seeThroughTokenConfigured, setSeeThroughTokenConfigured] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [portraitRequirements, setPortraitRequirements] = useState('')
  const [reviewDock, setReviewDock] = useState<HTMLDivElement | null>(null)
  const [studioHost, setStudioHost] = useState<HTMLDivElement | null>(null)
  const rigCharacterRef = useRef<RigCharacterHandle>(null)
  const motionState = {
    energy: 70,
    mood,
    boredom: 70,
    curiosity: 70,
    social: 70,
    affection: 70,
  }

  const loadFace = useCallback(async () => {
    const face = await getSiteFace()
    setRigManifest(face.manifest)
    setPortraitUrl(face.portraitUrl)
    setGenerationFingerprint(face.generationFingerprint)
    setAssetId(face.assetId)
    return face
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadFace()
      .catch((reason) => {
        if (!cancelled) {
          setRigManifest(null)
          setPortraitUrl(null)
          setGenerationFingerprint(null)
          setAssetId(null)
          setError(
            reason instanceof Error ? reason.message : t.companion.loadFailed,
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [loadFace, t.companion.loadFailed])

  useEffect(() => {
    let cancelled = false
    void getSeeThroughStatus()
      .then((status) => {
        if (!cancelled) setSeeThroughTokenConfigured(status.tokenConfigured)
      })
      .catch((reason) => {
        if (!cancelled) {
          setSeeThroughTokenConfigured(false)
          setError(
            reason instanceof Error ? reason.message : t.companion.loadFailed,
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [t.companion.loadFailed])

  const requireCompiledRig = useCallback(() => {
    if (assetId) return
    throw new Error(t.companion.motionNeedsCompiledRig)
  }, [assetId, t.companion.motionNeedsCompiledRig])

  const saveMotionProfile = useCallback(async (profile: RigMotionProfile) => {
    requireCompiledRig()
    const manifest = await updateCompanionRigMotionProfile(profile)
    setRigManifest(manifest)
    rigCharacterRef.current?.setMotionProfile(profile)
    notifyFaceUpdated()
  }, [requireCompiledRig])

  const saveMotionClips = useCallback(
    async (clips: CompanionRigManifest['clips']) => {
      requireCompiledRig()
      setRigManifest(await updateCompanionRigClips(clips))
      notifyFaceUpdated()
    },
    [requireCompiledRig],
  )

  const migrateRig = useCallback(async () => {
    requireCompiledRig()
    const result = await migrateCompanionRig()
    setRigManifest(result.manifest)
    notifyFaceUpdated()
    return result.migrated
  }, [requireCompiledRig])

  const generatePortrait = useCallback(async () => {
    if (generating) return
    if (!window.confirm(t.companion.visualConfirm)) return
    setGenerating(true)
    setError('')
    try {
      await generateSitePortrait(portraitRequirements.trim() || undefined)
      await loadFace()
      notifyFaceUpdated()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t.companion.visualFailed,
      )
    } finally {
      setGenerating(false)
    }
  }, [
    generating,
    loadFace,
    portraitRequirements,
    t.companion.visualConfirm,
    t.companion.visualFailed,
  ])

  const preflightRigPsd = useCallback(
    async (
      file: File,
      onStage: NonNullable<Parameters<typeof preflightRigPsdAsset>[2]>,
    ) => {
      if (!portraitUrl) throw new Error(t.companion.visualFailed)
      return preflightRigPsdAsset(
        file,
        portraitUrl,
        onStage,
        generationFingerprint || undefined,
      )
    },
    [generationFingerprint, portraitUrl, t.companion.visualFailed],
  )

  const saveSeeThroughToken = useCallback(async (token: string) => {
    const status = await updateSeeThroughToken(token)
    setSeeThroughTokenConfigured(status.tokenConfigured)
  }, [])

  const decomposeRigPsd = useCallback(async () => {
    if (!portraitUrl) throw new Error(t.companion.visualFailed)
    return decomposeSitePortraitWithSeeThrough({
      sourceMasterAssetId: portraitUrl,
      sourceGenerationFingerprint: generationFingerprint || undefined,
      resolution: 768,
      seed: 42,
      splitArmsAndLegs: true,
    })
  }, [generationFingerprint, portraitUrl, t.companion.visualFailed])

  const commitRigPsd = useCallback(
    async (
      preflight: Parameters<typeof commitRigPsdAsset>[0],
      onStage: NonNullable<Parameters<typeof commitRigPsdAsset>[1]>,
    ) => {
      const imported = await commitRigPsdAsset(preflight, onStage)
      setRigManifest(imported.manifest)
      await loadFace()
      notifyFaceUpdated()
      return {
        partCount: imported.partCount,
        score: imported.report.score,
      }
    },
    [loadFace],
  )

  const exitReview = useCallback(() => {
    rigCharacterRef.current?.stopMotionPlan()
    setReviewMode(false)
  }, [])

  useEffect(() => {
    if (!reviewMode) return undefined
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitReview()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [exitReview, reviewMode])

  const portraitCard = (
    <>
      <InputItem
        itemKey="portrait-requirements"
        label={t.companion.visualRequirements}
        description={t.companion.visualRequirementsDescription}
        value={portraitRequirements}
        onChange={setPortraitRequirements}
        placeholder={t.companion.visualRequirementsPlaceholder}
        multiline
        rows={3}
        disabled={generating}
      />
      <InfoActionCard
        copyable={false}
        tone={portraitUrl ? 'default' : 'info'}
        title={t.companion.visualTitle}
        empty={!portraitUrl}
        emptyText={t.companion.visualDescription}
        fields={
          portraitUrl
            ? [
                {
                  key: 'portrait',
                  label: t.companion.visualTitle,
                  value: t.companion.visualReady,
                  copyable: false,
                },
              ]
            : undefined
        }
        actions={[
          {
            key: 'portrait',
            label: generating
              ? t.companion.visualGenerating
              : portraitUrl
                ? t.companion.visualRegenerate
                : t.companion.visualGenerate,
            onClick: () => void generatePortrait(),
            disabled: generating,
            loading: generating,
          },
        ]}
        footer={error || undefined}
      />
    </>
  )

  if (!rigManifest || !portraitUrl) {
    return (
      <SettingGroup
        title={t.companion.essentials}
        description={t.companion.essentialsDescription}
        id="life-motion-essentials"
      >
        {portraitCard}
        <p className="life-character-home__empty">
          {t.companion.visualDescription}
        </p>
      </SettingGroup>
    )
  }

  const studioTarget = reviewMode ? document.body : studioHost
  const studio = (
    <section
      className={`life-motion-home life-motion-home--settings${reviewMode ? ' is-reviewing' : ''}`}
      aria-label={
        reviewMode ? t.companion.motionReviewEnter : t.companion.essentials
      }
      aria-modal={reviewMode || undefined}
      role={reviewMode ? 'dialog' : undefined}
    >
      <div className="life-motion-home__studio">
        <div className="life-motion-home__stage">
          <RigCharacter
            ref={rigCharacterRef}
            activity={toCompanionActivity(activity)}
            expanded
            fallbackUrl={portraitUrl}
            gestureNonce={0}
            manifest={rigManifest}
            busy={false}
            unreadCount={0}
            energy={motionState.energy}
            mood={motionState.mood}
            boredom={motionState.boredom}
            curiosity={motionState.curiosity}
            social={motionState.social}
            affection={motionState.affection}
          />
        </div>
        <div ref={setReviewDock} className="life-motion-home__dock" />
      </div>
    </section>
  )

  return (
    <>
    <MotionWorkbench
      essentialsLead={
        <>
          {portraitCard}
          <div ref={setStudioHost} className="life-motion-home__host" />
        </>
      }
      manifest={rigManifest}
      motionState={motionState}
      reviewMode={reviewMode}
      onReviewModeChange={(reviewing) => {
        if (reviewing) setReviewMode(true)
        else exitReview()
      }}
      onPreviewProfile={(profile) => {
        rigCharacterRef.current?.setMotionProfile(profile)
      }}
      onSaveProfile={async (profile) => {
        try {
          setError('')
          await saveMotionProfile(profile)
        } catch (reason) {
          setError(
            reason instanceof Error ? reason.message : t.companion.loadFailed,
          )
          throw reason
        }
      }}
      onPreviewIntent={(intent) =>
        rigCharacterRef.current?.previewIntent(intent)
      }
      onPreviewClip={(clipId, options) =>
        rigCharacterRef.current?.previewClip(clipId, options)
      }
      onPreviewMotionPlan={(plan) =>
        rigCharacterRef.current?.playMotionPlan(plan)
      }
      onPreviewPerformance={(sequence, onProgress) =>
        rigCharacterRef.current?.previewPerformance(sequence, onProgress) ??
        null
      }
      onStopPerformance={() => rigCharacterRef.current?.stopMotionPlan()}
      onSaveClips={async (clips) => {
        try {
          setError('')
          await saveMotionClips(clips)
        } catch (reason) {
          setError(
            reason instanceof Error ? reason.message : t.companion.loadFailed,
          )
          throw reason
        }
      }}
      onCaptureFrame={() => rigCharacterRef.current?.captureFrame() || null}
      onReadMotionSignals={() =>
        rigCharacterRef.current?.readMotionSignals() || null
      }
      onMigrateRig={async () => {
        try {
          setError('')
          return await migrateRig()
        } catch (reason) {
          setError(
            reason instanceof Error ? reason.message : t.companion.loadFailed,
          )
          throw reason
        }
      }}
      sourceMasterAssetId={portraitUrl}
      sourceGenerationFingerprint={generationFingerprint || undefined}
      seeThroughTokenConfigured={seeThroughTokenConfigured}
      onSaveSeeThroughToken={saveSeeThroughToken}
      onDecomposeRigPsd={decomposeRigPsd}
      onPreflightRigPsd={preflightRigPsd}
      onCommitRigPsd={commitRigPsd}
      reviewDock={reviewDock}
    />
    {studioTarget ? createPortal(studio, studioTarget) : null}
    </>
  )
}
