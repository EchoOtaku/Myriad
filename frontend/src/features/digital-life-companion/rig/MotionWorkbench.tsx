import type { ReactNode } from 'react'
import type {
  RigAssetCompileEvent,
  RigAssetPreflight,
} from '../assets/pipeline'
import type { RigCapability } from './diagnostics'
import type { RigGestureIntent } from './director'
import type { GeneratedMotionPhase } from './generation'
import type { MotionCharacterState, MotionDebugSignals } from './motion'
import type {
  RigPerformancePlaybackState,
  RigPerformanceSequence,
} from './performance'
import type { CompanionMotionPlan, GeneratedMotionPhraseId } from './planner'
import type { MotionRegressionResult } from './regression'
import type {
  CompanionRigManifest,
  RigClip,
  RigKeyframe,
  RigMotionProfile,
} from './types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ButtonItem,
  InfoActionCard,
  InputItem,
  SettingGroup,
  SettingsButton,
  SliderItem,
  SwitchItem,
} from '../../../components/settings'
import { useI18n } from '../../../contexts/I18nContext'
import {
  availableRigActionPresetGroups,
  RIG_PREVIEW_INTENTS,
  sortRigClipsForDemo,
} from './actionCatalog'
import { authorPresentationEnvelope } from './clipAuthoring'
import {
  anime25DAbandonsCapability,
  diagnoseRig,
  rigCapabilityRegressions,
} from './diagnostics'
import { generateMotionInstance } from './generation'
import { createDefaultMotionProfile } from './motion'
import { MotionTimelineEditor } from './MotionTimelineEditor'
import {
  MOTION_GAZE_SOURCE_REVEAL_MS,
  motionWorkbenchGazeSource,
} from './motionWorkbenchGaze'
import {
  ActionPresetLibrary,
  GeneratedMotionLab,
  MotionReviewBar,
  PerformanceDemoSection,
} from './MotionWorkbenchPreview'
import {
  buildRigPerformanceSequences,
  performancePlaybackState,
} from './performance'
import { generateMotionPhrase } from './planner'
import { compareRigDataUrls } from './regression'

interface Props {
  manifest: CompanionRigManifest
  motionState: MotionCharacterState
  reviewMode: boolean
  onReviewModeChange: (reviewing: boolean) => void
  onPreviewProfile: (profile: RigMotionProfile) => void
  onSaveProfile: (profile: RigMotionProfile) => Promise<void>
  onPreviewIntent: (intent: RigGestureIntent) => void
  onPreviewClip: (
    clipId: string,
    options?: { variationSeed?: number; phase?: GeneratedMotionPhase },
  ) => void
  onPreviewMotionPlan: (plan: CompanionMotionPlan) => void
  onPreviewPerformance: (
    sequence: RigPerformanceSequence,
    onProgress: (state: RigPerformancePlaybackState) => void,
  ) => number | null
  onStopPerformance: () => void
  onSaveClips: (clips: RigClip[]) => Promise<void>
  onCaptureFrame: () => string | null
  onReadMotionSignals: () => Readonly<MotionDebugSignals> | null
  onMigrateRig: () => Promise<boolean>
  sourceMasterAssetId: string
  sourceGenerationFingerprint?: string
  seeThroughTokenConfigured: boolean
  onSaveSeeThroughToken: (token: string) => Promise<void>
  onDecomposeRigPsd: () => Promise<File>
  onPreflightRigPsd: (
    file: File,
    onStage: (event: RigAssetCompileEvent) => void,
  ) => Promise<RigAssetPreflight>
  onCommitRigPsd: (
    preflight: RigAssetPreflight,
    onStage: (event: RigAssetCompileEvent) => void,
  ) => Promise<{ partCount: number; score: number }>
  reviewDock?: HTMLElement | null
  essentialsLead?: ReactNode
}

interface RangeDefinition {
  key: string
  label: string
  minimum: number
  maximum: number
  step: number
  value: number
  format: (value: number) => string
  update: (profile: RigMotionProfile, value: number) => RigMotionProfile
}

type WorkbenchMotionDebugSignals = Omit<MotionDebugSignals, 'gazeSource'> & {
  gazeSource: MotionDebugSignals['gazeSource'] | 'none'
}

function formatSignedSignal(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`
}

export default function MotionWorkbench({
  manifest,
  motionState,
  reviewMode,
  onReviewModeChange,
  onPreviewProfile,
  onSaveProfile,
  onPreviewIntent,
  onPreviewClip,
  onPreviewMotionPlan,
  onPreviewPerformance,
  onStopPerformance,
  onSaveClips,
  onCaptureFrame,
  onReadMotionSignals,
  onMigrateRig,
  sourceMasterAssetId,
  sourceGenerationFingerprint,
  seeThroughTokenConfigured,
  onSaveSeeThroughToken,
  onDecomposeRigPsd,
  onPreflightRigPsd,
  onCommitRigPsd,
  reviewDock = null,
  essentialsLead = null,
}: Props) {
  const { t } = useI18n()
  const labels = t.companion
  const resolvedProfile = useMemo(
    () => manifest.motionProfile || createDefaultMotionProfile(manifest),
    [manifest],
  )
  const [profile, setProfile] = useState(resolvedProfile)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [clips, setClips] = useState(manifest.clips)
  const [selectedClipId, setSelectedClipId] = useState(
    manifest.clips[0]?.id || '',
  )
  const [selectedBoneId, setSelectedBoneId] = useState(
    manifest.clips[0]?.tracks[0]?.boneId || '',
  )
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0)
  const [clipsDirty, setClipsDirty] = useState(false)
  const [savingClips, setSavingClips] = useState(false)
  const [baselineFrame, setBaselineFrame] = useState<string | null>(null)
  const [candidateFrame, setCandidateFrame] = useState<string | null>(null)
  const [regression, setRegression] = useState<MotionRegressionResult | null>(
    null,
  )
  const [migrating, setMigrating] = useState(false)
  const [migrationComplete, setMigrationComplete] = useState(false)
  const [demoRunning, setDemoRunning] = useState(false)
  const [demoIndex, setDemoIndex] = useState(0)
  const [activePerformanceId, setActivePerformanceId] = useState<string | null>(
    null,
  )
  const [activeGeneratedPhraseId, setActiveGeneratedPhraseId] =
    useState<GeneratedMotionPhraseId | null>(null)
  const [performanceProgress, setPerformanceProgress] =
    useState<RigPerformancePlaybackState | null>(null)
  const [variantSeed, setVariantSeed] = useState(1)
  const [variantPhase, setVariantPhase] =
    useState<GeneratedMotionPhase>('action')
  const previewClipRef = useRef(onPreviewClip)
  const readMotionSignalsRef = useRef(onReadMotionSignals)
  const performanceStartTimerRef = useRef<number | null>(null)
  const rigPsdInputRef = useRef<HTMLInputElement>(null)
  const [rigImportStage, setRigImportStage] =
    useState<RigAssetCompileEvent | null>(null)
  const [rigImportResult, setRigImportResult] = useState<string | null>(null)
  const [rigImportError, setRigImportError] = useState<string | null>(null)
  const [rigPreflight, setRigPreflight] = useState<RigAssetPreflight | null>(
    null,
  )
  const [seeThroughTokenDraft, setSeeThroughTokenDraft] = useState('')
  const [seeThroughTokenError, setSeeThroughTokenError] = useState<
    string | undefined
  >()
  const [rigImportOperation, setRigImportOperation] = useState<
    'decompose' | 'manual' | 'commit' | null
  >(null)
  const importingRig = rigImportOperation !== null

  useEffect(() => {
    setRigPreflight(null)
    setRigImportResult(null)
    setRigImportError(null)
  }, [sourceGenerationFingerprint, sourceMasterAssetId])
  const runtimeSignalsVisible = true
  const [runtimeSignals, setRuntimeSignals] =
    useState<WorkbenchMotionDebugSignals>({
      restStillness: 0,
      breathAmplitudeScale: 1,
      breathPhase: 0,
      nextBlinkSafe: true,
      blinkClosure: 0,
      locksIdle: false,
      idleGlance: { x: 0, y: 0 },
      gazeSource: 'none',
    })

  useEffect(() => {
    readMotionSignalsRef.current = onReadMotionSignals
  }, [onReadMotionSignals])

  useEffect(() => {
    if (!runtimeSignalsVisible) return
    let gazeSourceRevealReady = false
    const update = () => {
      const next = readMotionSignalsRef.current()
      if (next) {
        setRuntimeSignals({
          ...next,
          idleGlance: { ...next.idleGlance },
          gazeSource: motionWorkbenchGazeSource(
            next.gazeSource,
            gazeSourceRevealReady,
          ),
        })
      }
    }
    update()
    const revealTimer = window.setTimeout(() => {
      gazeSourceRevealReady = true
      update()
    }, MOTION_GAZE_SOURCE_REVEAL_MS)
    const timer = window.setInterval(update, 100)
    return () => {
      window.clearTimeout(revealTimer)
      window.clearInterval(timer)
    }
  }, [runtimeSignalsVisible])

  useEffect(() => {
    previewClipRef.current = onPreviewClip
  }, [onPreviewClip])

  useEffect(() => {
    setProfile(resolvedProfile)
    setDirty(false)
  }, [resolvedProfile])

  useEffect(() => {
    const next = manifest.clips
    setClips(next)
    const first = next[0]
    setSelectedClipId(first?.id || '')
    setSelectedBoneId(first?.tracks[0]?.boneId || '')
    setSelectedFrameIndex(0)
    setClipsDirty(false)
    setDemoRunning(false)
    setDemoIndex(0)
    setActivePerformanceId(null)
    setActiveGeneratedPhraseId(null)
    setPerformanceProgress(null)
  }, [manifest.clips])

  useEffect(
    () => () => {
      if (performanceStartTimerRef.current !== null) {
        window.clearTimeout(performanceStartTimerRef.current)
      }
    },
    [],
  )

  const demoClips = useMemo(() => {
    return sortRigClipsForDemo(clips)
  }, [clips])

  const actionPresetGroups = useMemo(
    () => availableRigActionPresetGroups(clips),
    [clips],
  )

  const performanceSequences = useMemo(
    () => buildRigPerformanceSequences({ ...manifest, clips }),
    [clips, manifest],
  )

  const activePerformance = performanceSequences.find(
    (sequence) => sequence.id === activePerformanceId,
  )

  useEffect(() => {
    if (!demoRunning) return
    const clip = demoClips[demoIndex]
    if (!clip) {
      setDemoRunning(false)
      return
    }
    setSelectedClipId(clip.id)
    setSelectedBoneId(clip.tracks[0]?.boneId || '')
    setSelectedFrameIndex(0)
    previewClipRef.current(clip.id)
    const timeout = window.setTimeout(
      () => {
        if (demoIndex >= demoClips.length - 1) setDemoRunning(false)
        else setDemoIndex(demoIndex + 1)
      },
      Math.max(900, Math.min(5_000, clip.duration * 1_000 + 350)),
    )
    return () => window.clearTimeout(timeout)
  }, [demoClips, demoIndex, demoRunning])

  const selectedClip = clips.find((clip) => clip.id === selectedClipId)
  const generatedInstance = useMemo(
    () =>
      generateMotionInstance({
        clipId: selectedClip?.id || 'idle-accent',
        seed: variantSeed,
        phase: variantPhase,
        state: motionState,
        maxAmplitudeScale: selectedClip?.generation?.maxAmplitudeScale,
      }),
    [motionState, selectedClip, variantPhase, variantSeed],
  )
  const selectedTrack = selectedClip?.tracks.find(
    (track) => track.boneId === selectedBoneId,
  )
  const selectedFrame = selectedTrack?.keyframes[selectedFrameIndex]
  const canAuthorPresentationEnvelope = Boolean(
    selectedClip?.presentation?.expression,
  )
  const diagnostic = useMemo(
    () => diagnoseRig({ ...manifest, clips }),
    [clips, manifest],
  )
  const preflightRegressions = useMemo(() => {
    if (!rigPreflight) return []
    return rigCapabilityRegressions(diagnostic, rigPreflight.report)
  }, [diagnostic, rigPreflight])

  const selectClip = (clipId: string) => {
    setDemoRunning(false)
    setActivePerformanceId(null)
    setActiveGeneratedPhraseId(null)
    setPerformanceProgress(null)
    const clip = clips.find((candidate) => candidate.id === clipId)
    setSelectedClipId(clipId)
    setSelectedBoneId(clip?.tracks[0]?.boneId || '')
    setSelectedFrameIndex(0)
  }

  const previewReviewClip = (index: number) => {
    if (demoClips.length === 0) return
    const normalizedIndex = (index + demoClips.length) % demoClips.length
    const clip = demoClips[normalizedIndex]
    setDemoRunning(false)
    setActivePerformanceId(null)
    setActiveGeneratedPhraseId(null)
    setPerformanceProgress(null)
    setDemoIndex(normalizedIndex)
    setSelectedClipId(clip.id)
    setSelectedBoneId(clip.tracks[0]?.boneId || '')
    setSelectedFrameIndex(0)
    onPreviewClip(clip.id)
  }

  const stopPerformance = () => {
    if (performanceStartTimerRef.current !== null) {
      window.clearTimeout(performanceStartTimerRef.current)
      performanceStartTimerRef.current = null
    }
    setActivePerformanceId(null)
    setActiveGeneratedPhraseId(null)
    setPerformanceProgress(null)
    onStopPerformance()
  }

  const updatePerformanceProgress = (state: RigPerformancePlaybackState) => {
    setPerformanceProgress(state)
  }

  const previewPerformance = (sequence: RigPerformanceSequence) => {
    if (activePerformanceId === sequence.id) {
      stopPerformance()
      return
    }
    setDemoRunning(false)
    setActiveGeneratedPhraseId(null)
    setActivePerformanceId(sequence.id)
    setPerformanceProgress(performancePlaybackState(sequence, 0, true))
    onReviewModeChange(true)
    performanceStartTimerRef.current = window.setTimeout(() => {
      performanceStartTimerRef.current = null
      onPreviewPerformance(sequence, updatePerformanceProgress)
    }, 90)
  }

  const selectedReviewIndex = Math.max(
    0,
    demoClips.findIndex((clip) => clip.id === selectedClipId),
  )

  const selectBone = (boneId: string) => {
    setSelectedBoneId(boneId)
    setSelectedFrameIndex(0)
  }

  const previewGeneratedVariant = (
    seed: number,
    phase: GeneratedMotionPhase = variantPhase,
  ) => {
    if (!selectedClipId) return
    setDemoRunning(false)
    stopPerformance()
    onPreviewClip(selectedClipId, { variationSeed: seed, phase })
  }

  const previewGeneratedPhrase = (phraseId: GeneratedMotionPhraseId) => {
    setDemoRunning(false)
    stopPerformance()
    setActiveGeneratedPhraseId(phraseId)
    onReviewModeChange(true)
    onPreviewMotionPlan(
      generateMotionPhrase(phraseId, motionState, variantSeed),
    )
  }

  const updateFrame = (update: (frame: RigKeyframe) => RigKeyframe) => {
    if (!selectedClip || !selectedTrack || !selectedFrame) return
    const changed = update(selectedFrame)
    const reordered = selectedTrack.keyframes
      .map((frame, index) => (index === selectedFrameIndex ? changed : frame))
      .sort((left, right) => left.time - right.time)
    setClips((current) =>
      current.map((clip) => {
        if (clip.id !== selectedClip.id) return clip
        return {
          ...clip,
          tracks: clip.tracks.map((track) => {
            if (track.boneId !== selectedTrack.boneId) return track
            return { ...track, keyframes: reordered }
          }),
        }
      }),
    )
    setSelectedFrameIndex(reordered.indexOf(changed))
    setClipsDirty(true)
  }

  const addFrame = () => {
    if (!selectedClip || !selectedTrack) return
    const source = selectedFrame?.transform || {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    }
    const occupied = new Set(selectedTrack.keyframes.map((frame) => frame.time))
    let time = selectedClip.duration / 2
    while (occupied.has(time) && time < selectedClip.duration) time += 0.01
    const added: RigKeyframe = {
      time: Math.min(selectedClip.duration, time),
      transform: structuredClone(source),
    }
    setClips((current) =>
      current.map((clip) =>
        clip.id !== selectedClip.id
          ? clip
          : {
              ...clip,
              tracks: clip.tracks.map((track) =>
                track.boneId !== selectedTrack.boneId
                  ? track
                  : {
                      ...track,
                      keyframes: [...track.keyframes, added].sort(
                        (left, right) => left.time - right.time,
                      ),
                    },
              ),
            },
      ),
    )
    setSelectedFrameIndex(
      [...selectedTrack.keyframes, added]
        .sort((left, right) => left.time - right.time)
        .indexOf(added),
    )
    setClipsDirty(true)
  }

  const removeFrame = () => {
    if (!selectedClip || !selectedTrack || selectedTrack.keyframes.length <= 1)
      return
    setClips((current) =>
      current.map((clip) =>
        clip.id !== selectedClip.id
          ? clip
          : {
              ...clip,
              tracks: clip.tracks.map((track) =>
                track.boneId !== selectedTrack.boneId
                  ? track
                  : {
                      ...track,
                      keyframes: track.keyframes.filter(
                        (_, index) => index !== selectedFrameIndex,
                      ),
                    },
              ),
            },
      ),
    )
    setSelectedFrameIndex(Math.max(0, selectedFrameIndex - 1))
    setClipsDirty(true)
  }

  const authorClipPresentationEnvelope = () => {
    if (!selectedClip || !canAuthorPresentationEnvelope) return
    const authored = authorPresentationEnvelope(selectedClip)
    if (!authored.presentation) return
    setClips((current) =>
      current.map((clip) =>
        clip.id === selectedClip.id ? authored : clip,
      ),
    )
    setClipsDirty(true)
  }

  const saveClips = async () => {
    if (!clipsDirty || savingClips) return
    setSavingClips(true)
    try {
      await onSaveClips(clips)
      setClipsDirty(false)
    } finally {
      setSavingClips(false)
    }
  }

  const preflightRigPsd = async (file: File) => {
    if (importingRig || !sourceMasterAssetId) return
    setRigImportOperation('manual')
    setRigImportStage(null)
    setRigImportResult(null)
    setRigImportError(null)
    try {
      setRigPreflight(null)
      const imported = await onPreflightRigPsd(file, setRigImportStage)
      setRigPreflight(imported)
      setRigImportResult(
        `Preflight passed without persistence · ${imported.partCount} parts · diagnostic ${imported.report.score}/100`,
      )
    } catch (reason) {
      setRigImportError(
        reason instanceof Error ? reason.message : 'Rig PSD import failed',
      )
    } finally {
      setRigImportOperation(null)
    }
  }

  const saveSeeThroughToken = async (token: string) => {
    if (!token || token.includes('•') || token.includes('*')) return
    setSeeThroughTokenError(undefined)
    try {
      await onSaveSeeThroughToken(token)
      setSeeThroughTokenDraft('')
    } catch (reason) {
      const message = reason instanceof Error
        ? reason.message
        : labels.motionSeeThroughTokenFailed
      setSeeThroughTokenError(message)
      throw reason
    }
  }

  const decomposeRigPsd = async () => {
    if (importingRig || !sourceMasterAssetId || !seeThroughTokenConfigured) return
    setRigImportOperation('decompose')
    setRigImportStage(null)
    setRigImportResult(null)
    setRigImportError(null)
    try {
      setRigPreflight(null)
      const file = await onDecomposeRigPsd()
      const imported = await onPreflightRigPsd(file, setRigImportStage)
      setRigPreflight(imported)
      setRigImportResult(
        `See-through preflight passed without persistence · ${imported.partCount} parts · diagnostic ${imported.report.score}/100`,
      )
    } catch (reason) {
      setRigImportError(
        reason instanceof Error ? reason.message : 'See-through decomposition failed',
      )
    } finally {
      setRigImportOperation(null)
    }
  }

  const commitRigPsd = async () => {
    if (importingRig || !rigPreflight) return
    setRigImportOperation('commit')
    setRigImportStage(null)
    setRigImportError(null)
    try {
      const imported = await onCommitRigPsd(rigPreflight, setRigImportStage)
      setRigImportResult(
        `Committed ${imported.partCount} preflighted parts · diagnostic ${imported.score}/100`,
      )
      setRigPreflight(null)
    } catch (reason) {
      setRigImportError(
        reason instanceof Error ? reason.message : 'Rig PSD commit failed',
      )
    } finally {
      setRigImportOperation(null)
    }
  }

  const captureBaseline = () => {
    const frame = onCaptureFrame()
    if (!frame) return
    setBaselineFrame(frame)
    setCandidateFrame(null)
    setRegression(null)
  }

  const compareFrame = async () => {
    if (!baselineFrame) return
    const frame = onCaptureFrame()
    if (!frame) return
    setCandidateFrame(frame)
    setRegression(await compareRigDataUrls(baselineFrame, frame))
  }

  const apply = (next: RigMotionProfile) => {
    setProfile(next)
    setDirty(true)
    setSaved(false)
    onPreviewProfile(next)
  }

  const essentialRanges: RangeDefinition[] = [
    {
      key: 'breath-frequency',
      label: labels.motionBreathFrequency,
      minimum: 0.05,
      maximum: 0.6,
      step: 0.01,
      value:
        (profile.breath.minFrequencyHz + profile.breath.maxFrequencyHz) / 2,
      format: (value) => `${value.toFixed(2)} Hz`,
      update: (current, value) => ({
        ...current,
        breath: {
          ...current.breath,
          minFrequencyHz: Math.max(0.05, value - 0.04),
          maxFrequencyHz: Math.min(2, value + 0.04),
        },
      }),
    },
    {
      key: 'breath-amplitude',
      label: labels.motionBreathAmplitude,
      minimum: 0,
      maximum: 0.02,
      step: 0.0005,
      value: profile.breath.amplitude,
      format: (value) => `${(value * 100).toFixed(2)}%`,
      update: (current, value) => ({
        ...current,
        breath: { ...current.breath, amplitude: value },
      }),
    },
    {
      key: 'blink-interval',
      label: labels.motionBlinkInterval,
      minimum: 1,
      maximum: 12,
      step: 0.1,
      value:
        (profile.blink.minIntervalSeconds + profile.blink.maxIntervalSeconds) /
        2,
      format: (value) => `${value.toFixed(1)} s`,
      update: (current, value) => ({
        ...current,
        blink: {
          ...current.blink,
          minIntervalSeconds: Math.max(0.5, value - 1.2),
          maxIntervalSeconds: Math.min(30, value + 1.2),
        },
      }),
    },
  ]

  const detailRanges: RangeDefinition[] = [
    {
      key: 'secondary-frequency',
      label: labels.motionSpringFrequency,
      minimum: 0.3,
      maximum: 6,
      step: 0.1,
      value: profile.secondary.frequencyHz,
      format: (value) => `${value.toFixed(1)} Hz`,
      update: (current, value) => ({
        ...current,
        secondary: { ...current.secondary, frequencyHz: value },
      }),
    },
    {
      key: 'secondary-damping',
      label: labels.motionSpringDamping,
      minimum: 0.1,
      maximum: 1.8,
      step: 0.05,
      value: profile.secondary.dampingRatio,
      format: (value) => value.toFixed(2),
      update: (current, value) => ({
        ...current,
        secondary: { ...current.secondary, dampingRatio: value },
      }),
    },
    {
      key: 'secondary-response',
      label: labels.motionSpringResponse,
      minimum: 0,
      maximum: 1.5,
      step: 0.05,
      value: profile.secondary.response,
      format: (value) => value.toFixed(2),
      update: (current, value) => ({
        ...current,
        secondary: { ...current.secondary, response: value },
      }),
    },
  ]

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      await onSaveProfile(profile)
      setDirty(false)
      setSaved(true)
    } catch {
      setSaved(false)
    } finally {
      setSaving(false)
    }
  }

  const renderRanges = (items: RangeDefinition[]) =>
    items.map((range) => (
      <SliderItem
        key={range.key}
        itemKey={range.key}
        label={range.label}
        value={range.value}
        min={range.minimum}
        max={range.maximum}
        step={range.step}
        formatValue={range.format}
        onChange={(value) => apply(range.update(profile, value))}
        layout="vertical"
      />
    ))

  const renderSaveActions = (suffix = '') => (
    <>
      <ButtonItem
        itemKey={`motion-reset${suffix}`}
        label={labels.motionReset}
        buttonText={labels.motionReset}
        onClick={() => apply(createDefaultMotionProfile(manifest))}
        layout="horizontal"
      />
      <ButtonItem
        itemKey={`motion-save${suffix}`}
        label={labels.motionSave}
        buttonText={
          saving
            ? labels.motionSaving
            : saved
              ? labels.motionSaved
              : labels.motionSave
        }
        onClick={() => void save()}
        disabled={!dirty || saving}
        loading={saving}
        layout="horizontal"
      />
    </>
  )

  return (
    <>
      <SettingGroup
        title={labels.essentials}
        description={labels.essentialsDescription}
        id="life-motion-essentials"
      >
        {essentialsLead}
        <ButtonItem
          itemKey="motion-review"
          label={labels.motionReviewEnter}
          description={labels.motionReviewDescription}
          buttonText={labels.motionReviewEnter}
          onClick={() => {
            onReviewModeChange(true)
            if (selectedClip) onPreviewClip(selectedClip.id)
          }}
          layout="horizontal"
        />
        <InputItem
          itemKey="see-through-hf-token"
          label={labels.motionSeeThroughToken}
          labelAccessory={
            <a
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noreferrer"
            >
              {labels.motionSeeThroughTokenCreate}
            </a>
          }
          description={labels.motionSeeThroughTokenDescription}
          value={
            seeThroughTokenDraft ||
            (seeThroughTokenConfigured ? '••••••••' : '')
          }
          onChange={(value) => {
            setSeeThroughTokenDraft(value)
            setSeeThroughTokenError(undefined)
          }}
          inputType="password"
          autoComplete="off"
          placeholder="hf_…"
          variant="clickToEdit"
          emptyLabel={labels.motionSeeThroughTokenMissing}
          editLabel={labels.motionSeeThroughTokenEdit}
          saveLabel={labels.motionSeeThroughTokenSave}
          cancelLabel={labels.motionSeeThroughTokenCancel}
          onCommit={saveSeeThroughToken}
          error={seeThroughTokenError}
          clearable={false}
        />
        <InfoActionCard
          copyable={false}
          tone={
            rigImportError ? 'danger' : rigPreflight ? 'info' : 'default'
          }
          title={labels.motionPsd}
          empty={!rigPreflight && !rigImportResult}
          emptyText={labels.motionPsdDescription}
          actions={[
            {
              key: 'see-through',
              label: rigImportOperation === 'decompose'
                ? labels.motionSeeThroughGenerating
                : labels.motionSeeThroughGenerate,
              disabled:
                importingRig ||
                !sourceMasterAssetId ||
                !seeThroughTokenConfigured,
              loading: rigImportOperation === 'decompose',
              onClick: () => void decomposeRigPsd(),
            },
            {
              key: 'preflight',
              label: rigImportOperation === 'manual'
                ? labels.motionPsdValidating
                : labels.motionPsdPreflight,
              disabled: importingRig || !sourceMasterAssetId,
              loading: rigImportOperation === 'manual',
              onClick: () => rigPsdInputRef.current?.click(),
            },
            ...(rigPreflight
              ? [
                  {
                    key: 'commit',
                    label: labels.motionPsdCommit,
                    disabled:
                      importingRig ||
                      preflightRegressions.length > 0 ||
                      rigPreflight.report.issues.some(
                        (item) => item.severity === 'error',
                      ),
                    loading: rigImportOperation === 'commit',
                    onClick: () => void commitRigPsd(),
                  },
                ]
              : []),
          ]}
          footer={
            <>
              <input
                ref={rigPsdInputRef}
                type="file"
                accept=".psd,image/vnd.adobe.photoshop"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (file) void preflightRigPsd(file)
                }}
              />
              {rigImportOperation === 'decompose' &&
              !rigImportStage &&
              !rigImportResult &&
              !rigImportError ? (
                <p className="life-motion-home__help" role="status">
                  {labels.motionSeeThroughGenerating}
                </p>
              ) : null}
              {rigImportStage && !rigImportResult && !rigImportError ? (
                <p className="life-motion-home__help" role="status">
                  {rigImportStage.stage} · {rigImportStage.status}
                </p>
              ) : null}
              {rigImportResult ? (
                <p className="life-motion-home__help" role="status">
                  {rigImportResult}
                </p>
              ) : null}
              {rigPreflight?.report.profile === 'anime25d' ? (
                <p className="life-motion-home__help" role="status">
                  Anime2.5DRig mainline: blink, mouth, hair, breath/chest,
                  depth turn and whole-layer handwear are acceptance gates.
                </p>
              ) : null}
              {preflightRegressions.length > 0 ? (
                <p className="life-motion-home__help" role="alert">
                  Candidate would remove current capabilities:{' '}
                  {preflightRegressions.join(', ')}
                </p>
              ) : null}
              {rigPreflight && rigPreflight.report.issues.length > 0 ? (
                <ul>
                  {rigPreflight.report.issues.slice(0, 6).map((item) => (
                    <li
                      key={`${item.code}:${item.clipId || item.boneId || ''}`}
                    >
                      {item.severity}: {item.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {rigImportError ? (
                <p className="life-motion-home__help" role="alert">
                  {rigImportError}
                </p>
              ) : null}
            </>
          }
        />
        <SwitchItem
          itemKey="motion-secondary"
          label={labels.motionSecondary}
          value={profile.secondary.enabled}
          onChange={(enabled) =>
            apply({
              ...profile,
              secondary: {
                ...profile.secondary,
                enabled,
              },
            })
          }
        />
        {renderRanges(essentialRanges)}
        {renderSaveActions()}
      </SettingGroup>
      <SettingGroup
        title={labels.details}
        description={labels.detailsDescription}
        id="life-motion-details"
        collapsible
        defaultExpanded={false}
      >
          <SettingGroup
            title={labels.motionSpring}
            id="life-motion-springs"
            toc={false}
          >
            {renderRanges(detailRanges)}
          </SettingGroup>
        <SettingGroup
          title={labels.motionRuntimeSignals}
          id="life-motion-signals"
          toc={false}
        >
          <InfoActionCard
            embedded
            copyable={false}
            fields={[
              {
                key: 'restStillness',
                label: 'restStillness',
                value: (
                  <output data-motion-signal="restStillness">
                    {runtimeSignals.restStillness.toFixed(3)}
                  </output>
                ),
              },
              {
                key: 'breathAmplitudeScale',
                label: 'breathAmplitudeScale',
                value: (
                  <output data-motion-signal="breathAmplitudeScale">
                    {runtimeSignals.breathAmplitudeScale.toFixed(3)}
                  </output>
                ),
              },
              {
                key: 'breathPhase',
                label: 'breathPhase',
                value: (
                  <output data-motion-signal="breathPhase">
                    {runtimeSignals.breathPhase.toFixed(3)}
                  </output>
                ),
              },
              {
                key: 'nextBlinkSafe',
                label: 'nextBlinkSafe',
                value: (
                  <output
                    data-motion-signal="nextBlinkSafe"
                    data-active={runtimeSignals.nextBlinkSafe}
                  >
                    {runtimeSignals.nextBlinkSafe ? 'safe' : 'hold'}
                  </output>
                ),
              },
              {
                key: 'blinkClosure',
                label: 'blinkClosure',
                value: (
                  <output
                    data-motion-signal="blinkClosure"
                    data-active={runtimeSignals.blinkClosure > 0.01}
                  >
                    {runtimeSignals.blinkClosure.toFixed(3)}
                  </output>
                ),
              },
              {
                key: 'locksIdle',
                label: 'locksIdle',
                value: (
                  <output
                    data-motion-signal="locksIdle"
                    data-active={runtimeSignals.locksIdle}
                  >
                    {runtimeSignals.locksIdle
                      ? labels.motionSignalLocked
                      : labels.motionSignalOpen}
                  </output>
                ),
              },
              {
                key: 'idleGlance',
                label: 'idleGlance',
                value: (
                  <output
                    data-motion-signal="idleGlance"
                    data-active={
                      Math.abs(runtimeSignals.idleGlance.x) > 0.0001 ||
                      Math.abs(runtimeSignals.idleGlance.y) > 0.0001
                    }
                  >
                    {formatSignedSignal(runtimeSignals.idleGlance.x)},{' '}
                    {formatSignedSignal(runtimeSignals.idleGlance.y)}
                  </output>
                ),
              },
              {
                key: 'gazeSource',
                label: 'gazeSource',
                value: (
                  <output
                    data-motion-signal="gazeSource"
                    data-gaze-source={runtimeSignals.gazeSource}
                    data-gaze-source-revealed={
                      runtimeSignals.gazeSource !== 'none'
                    }
                  >
                    {runtimeSignals.gazeSource}
                  </output>
                ),
              },
            ]}
          />
        </SettingGroup>
        <SettingGroup
          title={labels.motionPreview}
          id="life-motion-intents"
          toc={false}
        >
          <div className="life-motion-home__chips">
            <div>
              {RIG_PREVIEW_INTENTS.map((intent) => (
                <SettingsButton
                  key={intent}
                  type="button"
                  size="sm"
                  onClick={() => onPreviewIntent(intent)}
                >
                  {labels[
                    `motionIntent${capitalize(intent)}` as keyof typeof labels
                  ] || intent}
                </SettingsButton>
              ))}
            </div>
          </div>
        </SettingGroup>
        <PerformanceDemoSection
          labels={labels}
          sequences={performanceSequences}
          activePerformanceId={activePerformanceId}
          onPreview={previewPerformance}
          onStop={stopPerformance}
        />
        <GeneratedMotionLab
          labels={labels}
          instance={generatedInstance}
          phase={variantPhase}
          seed={variantSeed}
          onRegenerate={() => {
            const next = variantSeed + 1
            setVariantSeed(next)
            previewGeneratedVariant(next)
          }}
          onPhaseChange={(phase) => {
            setVariantPhase(phase)
            previewGeneratedVariant(variantSeed, phase)
          }}
          onPreviewPhrase={previewGeneratedPhrase}
        />
        {actionPresetGroups.length > 0 ? (
          <ActionPresetLibrary
            labels={labels}
            groups={actionPresetGroups}
            clipCount={clips.length}
            selectedClipId={selectedClip?.id || selectedClipId}
            onPreview={(clipId) => {
              selectClip(clipId)
              onPreviewClip(clipId)
            }}
          />
        ) : null}
        <SettingGroup
          title={labels.motionTimeline}
          description={labels.motionTimelineDescription}
          id="life-motion-timeline"
          toc={false}
        >
          <MotionTimelineEditor
            labels={labels}
            clips={clips}
            selectedClip={selectedClip}
            selectedTrack={selectedTrack}
            selectedFrame={selectedFrame}
            selectedFrameIndex={selectedFrameIndex}
            clipsDirty={clipsDirty}
            savingClips={savingClips}
            canAuthorPresentation={canAuthorPresentationEnvelope}
            onSelectClip={selectClip}
            onSelectBone={selectBone}
            onSelectFrame={setSelectedFrameIndex}
            onPreviewClip={() => {
              setActivePerformanceId(null)
              setDemoRunning(false)
              if (selectedClip) onPreviewClip(selectedClip.id)
            }}
            onChangeFrame={updateFrame}
            onAddFrame={addFrame}
            onRemoveFrame={removeFrame}
            onSaveClips={() => void saveClips()}
            onAuthorPresentation={authorClipPresentationEnvelope}
          />
        </SettingGroup>
        <SettingGroup
          title={labels.motionRigDiagnostics}
          id="life-motion-diagnostics"
          toc={false}
        >
          <InfoActionCard
            embedded
            copyable={false}
            tone={
              diagnostic.score >= 80
                ? 'success'
                : diagnostic.score >= 55
                  ? 'warn'
                  : 'danger'
            }
            fields={[
              {
                key: 'score',
                label: labels.motionRigDiagnostics,
                value: `${diagnostic.score}/100`,
              },
            ]}
            actions={[
              {
                key: 'migrate',
                label: migrating
                  ? labels.motionMigrating
                  : migrationComplete
                    ? labels.motionMigrationComplete
                    : labels.motionMigrateRig,
                disabled: migrating,
                loading: migrating,
                onClick: () => {
                  setMigrating(true)
                  void onMigrateRig()
                    .then(() => setMigrationComplete(true))
                    .finally(() => setMigrating(false))
                },
              },
            ]}
            footer={
              <>
            <div className="dlc-rig-diagnostics__capabilities">
              {Object.entries(diagnostic.capabilities)
                .map(([name, enabled]) => {
                const abandoned =
                  diagnostic.profile === 'anime25d' &&
                  anime25DAbandonsCapability(name as RigCapability)
                return (
                  <span
                    key={name}
                    className={enabled ? 'is-ready' : ''}
                    data-status={abandoned ? 'abandoned' : undefined}
                  >
                    {enabled ? '✓' : abandoned ? 'abandoned' : '–'} {name}
                  </span>
                )
              })}
            </div>
            {diagnostic.issues.length > 0 && (
              <ul>
                {diagnostic.issues.slice(0, 5).map((item, index) => (
                  <li
                    key={`${item.code}-${item.clipId || ''}-${item.boneId || ''}-${index}`}
                    data-severity={item.severity}
                  >
                    <span>{item.severity}</span>
                    {item.message}
                    {(item.clipId || item.boneId) && (
                      <small>
                        {[item.clipId, item.boneId].filter(Boolean).join(' / ')}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            )}
              </>
            }
          />
        </SettingGroup>
        <SettingGroup
          title={labels.motionRegression}
          id="life-motion-regression"
          toc={false}
        >
          <InfoActionCard
            embedded
            copyable={false}
            tone={
              regression
                ? regression.passed
                  ? 'success'
                  : 'danger'
                : 'muted'
            }
            fields={
              regression
                ? [
                    {
                      key: 'delta',
                      label: labels.motionRegression,
                      value: `${(regression.changedRatio * 100).toFixed(1)}% Δ`,
                    },
                    {
                      key: 'detail',
                      label: labels.motionCompareFrame,
                      value: `floor ${(regression.floorShift * 100).toFixed(1)}% · center ${(regression.silhouetteShift * 100).toFixed(1)}% · detached ${(regression.detachedRatio * 100).toFixed(1)}%`,
                    },
                  ]
                : undefined
            }
            empty={!regression}
            emptyText={labels.motionRegression}
            actions={[
              {
                key: 'baseline',
                label: labels.motionCaptureBaseline,
                onClick: captureBaseline,
              },
              {
                key: 'compare',
                label: labels.motionCompareFrame,
                disabled: !baselineFrame,
                onClick: () => void compareFrame(),
              },
            ]}
            footer={
              baselineFrame || candidateFrame ? (
                <div className="dlc-motion-regression__frames">
                  {baselineFrame ? (
                    <img src={baselineFrame} alt={labels.motionBaseline} />
                  ) : null}
                  {candidateFrame ? (
                    <img src={candidateFrame} alt={labels.motionCandidate} />
                  ) : null}
                </div>
              ) : null
            }
          />
        </SettingGroup>
        {renderSaveActions('-details')}
      </SettingGroup>
        {reviewMode && selectedClip
          ? reviewDock
            ? createPortal(
                <MotionReviewBar
                  labels={labels}
                  activePerformance={activePerformance}
                  activeGeneratedPhraseId={activeGeneratedPhraseId}
                  performanceProgress={performanceProgress}
                  selectedClip={selectedClip}
                  selectedReviewIndex={selectedReviewIndex}
                  reviewClipCount={demoClips.length}
                  demoRunning={demoRunning}
                  onExit={() => {
                    if (activePerformance || activeGeneratedPhraseId)
                      stopPerformance()
                    onReviewModeChange(false)
                  }}
                  onReplayPerformance={() => {
                    if (activePerformance) {
                      setPerformanceProgress(
                        performancePlaybackState(activePerformance, 0, true),
                      )
                      onPreviewPerformance(
                        activePerformance,
                        updatePerformanceProgress,
                      )
                    } else if (activeGeneratedPhraseId) {
                      onPreviewMotionPlan(
                        generateMotionPhrase(
                          activeGeneratedPhraseId,
                          motionState,
                          variantSeed,
                        ),
                      )
                    }
                  }}
                  onStopPerformance={stopPerformance}
                  onPrevious={() => previewReviewClip(selectedReviewIndex - 1)}
                  onReplayClip={() => onPreviewClip(selectedClip.id)}
                  onNext={() => previewReviewClip(selectedReviewIndex + 1)}
                  onToggleDemo={() => {
                    if (demoRunning) {
                      setDemoRunning(false)
                    } else {
                      stopPerformance()
                      setDemoIndex(selectedReviewIndex)
                      setDemoRunning(true)
                    }
                  }}
                />,
                reviewDock,
              )
            : (
                <MotionReviewBar
                  labels={labels}
                  activePerformance={activePerformance}
                  activeGeneratedPhraseId={activeGeneratedPhraseId}
                  performanceProgress={performanceProgress}
                  selectedClip={selectedClip}
                  selectedReviewIndex={selectedReviewIndex}
                  reviewClipCount={demoClips.length}
                  demoRunning={demoRunning}
                  onExit={() => {
                    if (activePerformance || activeGeneratedPhraseId)
                      stopPerformance()
                    onReviewModeChange(false)
                  }}
                  onReplayPerformance={() => {
                    if (activePerformance) {
                      setPerformanceProgress(
                        performancePlaybackState(activePerformance, 0, true),
                      )
                      onPreviewPerformance(
                        activePerformance,
                        updatePerformanceProgress,
                      )
                    } else if (activeGeneratedPhraseId) {
                      onPreviewMotionPlan(
                        generateMotionPhrase(
                          activeGeneratedPhraseId,
                          motionState,
                          variantSeed,
                        ),
                      )
                    }
                  }}
                  onStopPerformance={stopPerformance}
                  onPrevious={() => previewReviewClip(selectedReviewIndex - 1)}
                  onReplayClip={() => onPreviewClip(selectedClip.id)}
                  onNext={() => previewReviewClip(selectedReviewIndex + 1)}
                  onToggleDemo={() => {
                    if (demoRunning) {
                      setDemoRunning(false)
                    } else {
                      stopPerformance()
                      setDemoIndex(selectedReviewIndex)
                      setDemoRunning(true)
                    }
                  }}
                />
              )
          : null}
    </>
  )
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
