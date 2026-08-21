import type { TranslationKeys } from '../../../i18n'
import {
  labelMotionId,
  type RigActionPresetGroup,
} from './actionCatalog'
import type {
  GeneratedMotionInstance,
  GeneratedMotionPhase,
} from './generation'
import type {
  RigPerformancePlaybackState,
  RigPerformanceSequence,
} from './performanceTypes'
import type { GeneratedMotionPhraseId } from './planner'
import type { RigClip } from './types'
import {
  CheckboxCard,
  SegmentedControl,
  SettingGroup,
  SettingsButton,
} from '../../../components/settings'

type CompanionLabels = TranslationKeys['companion']

const PERFORMANCE_LABEL_KEYS: Record<
  RigPerformanceSequence['id'],
  | 'motionPerformanceGreeting'
  | 'motionPerformanceExplanation'
  | 'motionPerformanceCelebration'
  | 'motionPerformanceThoughtful'
  | 'motionPerformanceFarewell'
  | 'motionPerformanceEncouragement'
  | 'motionPerformanceApology'
  | 'motionPerformanceDiscovery'
  | 'motionPerformancePlayful'
> = {
  greeting: 'motionPerformanceGreeting',
  explanation: 'motionPerformanceExplanation',
  celebration: 'motionPerformanceCelebration',
  thoughtful: 'motionPerformanceThoughtful',
  farewell: 'motionPerformanceFarewell',
  encouragement: 'motionPerformanceEncouragement',
  apology: 'motionPerformanceApology',
  discovery: 'motionPerformanceDiscovery',
  playful: 'motionPerformancePlayful',
}

export function PerformanceDemoSection({
  labels,
  sequences,
  activePerformanceId,
  onPreview,
  onStop,
}: {
  labels: CompanionLabels
  sequences: readonly RigPerformanceSequence[]
  activePerformanceId: string | null
  onPreview: (sequence: RigPerformanceSequence) => void
  onStop: () => void
}) {
  if (sequences.length === 0) return null
  return (
    <SettingGroup
      title={labels.motionPerformanceDemos}
      id="life-motion-performances"
      toc={false}
      titleExtra={
        activePerformanceId ? (
          <SettingsButton type="button" size="sm" onClick={onStop}>
            {labels.motionStopDemo}
          </SettingsButton>
        ) : null
      }
    >
      <p className="life-motion-home__help">
        {labels.motionPerformanceDescription}
      </p>
      <div className="life-motion-home__cards">
        {sequences.map((sequence) => (
          <CheckboxCard
            key={sequence.id}
            variant="action"
            checked={activePerformanceId === sequence.id}
            label={labels[PERFORMANCE_LABEL_KEYS[sequence.id]]}
            description={`${sequence.cues.length} ${labels.motionPerformanceBeatUnit} · ${sequence.cues.reduce(
              (count, cue) => count + cue.actions.length,
              0,
            )} ${labels.motionPerformanceActionUnit} · ${(sequence.durationMs / 1_000).toFixed(1)}s`}
            onChange={() => onPreview(sequence)}
          />
        ))}
      </div>
    </SettingGroup>
  )
}

export function ActionPresetLibrary({
  labels,
  groups,
  clipCount,
  selectedClipId,
  onPreview,
}: {
  labels: CompanionLabels
  groups: readonly RigActionPresetGroup[]
  clipCount: number
  selectedClipId: string
  onPreview: (clipId: string) => void
}) {
  return (
    <SettingGroup
      title={labels.motionPresetLibrary}
      id="life-motion-presets"
      toc={false}
      titleExtra={
        <span className="life-motion-home__count">
          {clipCount} {labels.motionPresetCount}
        </span>
      }
    >
      {groups.map((group) => (
        <div className="life-motion-home__chips" key={group.label}>
          <strong>{labels[group.label]}</strong>
          <div>
            {group.clipIds.map((clipId) => (
              <SettingsButton
                type="button"
                key={clipId}
                size="sm"
                aria-pressed={selectedClipId === clipId}
                title={clipId}
                onClick={() => onPreview(clipId)}
              >
                {labelMotionId(clipId)}
              </SettingsButton>
            ))}
          </div>
        </div>
      ))}
    </SettingGroup>
  )
}

const GENERATED_PHRASE_LABEL_KEYS: Record<
  GeneratedMotionPhraseId,
  | 'motionPhraseWarmGreeting'
  | 'motionPhraseThoughtfulReply'
  | 'motionPhraseLivelyExplanation'
> = {
  'warm-greeting': 'motionPhraseWarmGreeting',
  'thoughtful-reply': 'motionPhraseThoughtfulReply',
  'lively-explanation': 'motionPhraseLivelyExplanation',
}

export function GeneratedMotionLab({
  labels,
  instance,
  phase,
  seed,
  onPhaseChange,
  onRegenerate,
  onPreviewPhrase,
}: {
  labels: CompanionLabels
  instance: GeneratedMotionInstance
  phase: GeneratedMotionPhase
  seed: number
  onPhaseChange: (phase: GeneratedMotionPhase) => void
  onRegenerate: () => void
  onPreviewPhrase: (phraseId: GeneratedMotionPhraseId) => void
}) {
  return (
    <SettingGroup
      title={labels.motionGenerationLab}
      id="life-motion-generator"
      toc={false}
      titleExtra={
        <SettingsButton type="button" size="sm" onClick={onRegenerate}>
          {labels.motionRegenerateVariant} #{seed}
        </SettingsButton>
      }
    >
      <p className="life-motion-home__help">
        {labels.motionGenerationDescription}
      </p>
      <dl className="life-motion-home__metrics">
        <div>
          <dt>{labels.motionGeneratedTempo}</dt>
          <dd>{instance.tempoScale.toFixed(2)}×</dd>
        </div>
        <div>
          <dt>{labels.motionGeneratedAmplitude}</dt>
          <dd>{instance.amplitudeScale.toFixed(2)}×</dd>
        </div>
        <div>
          <dt>{labels.motionGeneratedFluidity}</dt>
          <dd>{Math.round(instance.fluidity * 100)}%</dd>
        </div>
      </dl>
      <SegmentedControl
        ariaLabel={labels.motionGenerationLab}
        size="sm"
        columns={3}
        value={phase}
        onChange={onPhaseChange}
        options={[
          { value: 'anticipation', label: labels.motionPhaseAnticipation },
          { value: 'action', label: labels.motionPhaseAction },
          { value: 'settle', label: labels.motionPhaseSettle },
        ]}
      />
      <div className="life-motion-home__chips">
        <strong>{labels.motionGeneratedPhrases}</strong>
        <div>
          {(
            Object.keys(GENERATED_PHRASE_LABEL_KEYS) as GeneratedMotionPhraseId[]
          ).map((phraseId) => (
            <SettingsButton
              type="button"
              key={phraseId}
              size="sm"
              onClick={() => onPreviewPhrase(phraseId)}
            >
              {labels[GENERATED_PHRASE_LABEL_KEYS[phraseId]]}
            </SettingsButton>
          ))}
        </div>
      </div>
    </SettingGroup>
  )
}

export function MotionReviewBar({
  labels,
  activePerformance,
  activeGeneratedPhraseId,
  performanceProgress,
  selectedClip,
  selectedReviewIndex,
  reviewClipCount,
  demoRunning,
  onExit,
  onReplayPerformance,
  onStopPerformance,
  onPrevious,
  onReplayClip,
  onNext,
  onToggleDemo,
}: {
  labels: CompanionLabels
  activePerformance: RigPerformanceSequence | undefined
  activeGeneratedPhraseId: GeneratedMotionPhraseId | null
  performanceProgress: RigPerformancePlaybackState | null
  selectedClip: RigClip
  selectedReviewIndex: number
  reviewClipCount: number
  demoRunning: boolean
  onExit: () => void
  onReplayPerformance: () => void
  onStopPerformance: () => void
  onPrevious: () => void
  onReplayClip: () => void
  onNext: () => void
  onToggleDemo: () => void
}) {
  const phaseLabel =
    performanceProgress?.phase === 'action'
      ? labels.motionPhaseAction
      : performanceProgress?.phase === 'settle'
        ? labels.motionPhaseSettle
        : labels.motionPhaseAnticipation

  return (
    <div
      className="life-motion-home__review"
      role="toolbar"
      aria-label={labels.motionReviewEnter}
    >
      <SettingsButton
        type="button"
        size="sm"
        className="life-motion-home__review-exit"
        onClick={onExit}
      >
        {labels.motionReviewExit}
      </SettingsButton>
      <div className="life-motion-home__review-status" aria-live="polite">
        <p>
          {activePerformance && performanceProgress?.running === false
            ? labels.motionPerformanceComplete
            : labels.motionDemoNow}
        </p>
        <strong>
          {activePerformance
            ? labels[PERFORMANCE_LABEL_KEYS[activePerformance.id]]
            : activeGeneratedPhraseId
              ? labels[GENERATED_PHRASE_LABEL_KEYS[activeGeneratedPhraseId]]
              : labelMotionId(selectedClip.id)}
        </strong>
        <span>
          {activePerformance
            ? `${(performanceProgress?.cueIndex ?? 0) + 1}/${activePerformance.cues.length} · ${phaseLabel}`
            : activeGeneratedPhraseId
              ? `3 ${labels.motionPerformanceBeatUnit}`
              : `${selectedReviewIndex + 1}/${reviewClipCount}`}
        </span>
        {activePerformance && performanceProgress ? (
          <progress
            className="life-motion-home__review-progress"
            aria-label={labels.motionPerformanceProgress}
            max={performanceProgress.durationMs}
            value={performanceProgress.elapsedMs}
          />
        ) : null}
      </div>
      <div className="life-motion-home__review-actions">
        {activePerformance || activeGeneratedPhraseId ? (
          <>
            <SettingsButton
              type="button"
              size="sm"
              onClick={onReplayPerformance}
            >
              {labels.motionReviewReplay}
            </SettingsButton>
            <SettingsButton
              type="button"
              size="sm"
              onClick={onStopPerformance}
            >
              {labels.motionStopDemo}
            </SettingsButton>
          </>
        ) : (
          <>
            <SettingsButton type="button" size="sm" onClick={onPrevious}>
              {labels.motionReviewPrevious}
            </SettingsButton>
            <SettingsButton type="button" size="sm" onClick={onReplayClip}>
              {labels.motionReviewReplay}
            </SettingsButton>
            <SettingsButton type="button" size="sm" onClick={onNext}>
              {labels.motionReviewNext}
            </SettingsButton>
            <SettingsButton type="button" size="sm" onClick={onToggleDemo}>
              {demoRunning ? labels.motionStopDemo : labels.motionStartDemo}
            </SettingsButton>
          </>
        )}
      </div>
    </div>
  )
}
