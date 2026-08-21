import type { TranslationKeys } from '../../../i18n'
import type { RigClip, RigKeyframe, RigTrack } from './types'
import { SettingsButton } from '../../../components/settings'
import { labelMotionId } from './actionCatalog'

type Labels = TranslationKeys['companion']

interface Props {
  labels: Labels
  clips: readonly RigClip[]
  selectedClip: RigClip | undefined
  selectedTrack: RigTrack | undefined
  selectedFrame: RigKeyframe | undefined
  selectedFrameIndex: number
  clipsDirty: boolean
  savingClips: boolean
  canAuthorPresentation: boolean
  onSelectClip: (clipId: string) => void
  onSelectBone: (boneId: string) => void
  onSelectFrame: (index: number) => void
  onPreviewClip: () => void
  onChangeFrame: (update: (frame: RigKeyframe) => RigKeyframe) => void
  onAddFrame: () => void
  onRemoveFrame: () => void
  onSaveClips: () => void
  onAuthorPresentation: () => void
}

export function MotionTimelineEditor({
  labels,
  clips,
  selectedClip,
  selectedTrack,
  selectedFrame,
  selectedFrameIndex,
  clipsDirty,
  savingClips,
  canAuthorPresentation,
  onSelectClip,
  onSelectBone,
  onSelectFrame,
  onPreviewClip,
  onChangeFrame,
  onAddFrame,
  onRemoveFrame,
  onSaveClips,
  onAuthorPresentation,
}: Props) {
  const frameCount = selectedTrack?.keyframes.length ?? 0
  const duration = selectedClip?.duration ?? 0

  return (
    <section className="dlc-motion-timeline" aria-label={labels.motionTimeline}>
      <div className="dlc-motion-timeline__toolbar">
        <label className="dlc-motion-timeline__field">
          <span>{labels.motionClip}</span>
          <select
            value={selectedClip?.id || ''}
            onChange={(event) => onSelectClip(event.currentTarget.value)}
          >
            {clips.map((clip) => (
              <option key={clip.id} value={clip.id}>
                {labelMotionId(clip.id)} · {clip.duration.toFixed(2)}s
              </option>
            ))}
          </select>
        </label>
        <label className="dlc-motion-timeline__field">
          <span>{labels.motionLayer}</span>
          <select
            value={selectedTrack?.boneId || ''}
            disabled={!selectedClip}
            onChange={(event) => onSelectBone(event.currentTarget.value)}
          >
            {(selectedClip?.tracks || []).map((track) => (
              <option key={track.boneId} value={track.boneId}>
                {labelMotionId(track.boneId)}
              </option>
            ))}
          </select>
        </label>
        <div className="dlc-motion-timeline__actions">
          <SettingsButton
            type="button"
            size="sm"
            disabled={!selectedClip}
            onClick={onPreviewClip}
          >
            {labels.motionPlayClip}
          </SettingsButton>
          <SettingsButton
            type="button"
            size="sm"
            variant="primary"
            disabled={!clipsDirty || savingClips}
            loading={savingClips}
            onClick={onSaveClips}
          >
            {savingClips ? labels.motionSaving : labels.motionSaveClips}
          </SettingsButton>
        </div>
      </div>

      {selectedClip && selectedTrack ? (
        <>
          <p className="dlc-motion-timeline__status">
            {labels.motionKeyframeCurrent
              .replace('{current}', String(selectedFrameIndex + 1))
              .replace('{total}', String(frameCount))}
            {selectedFrame
              ? ` · ${selectedFrame.time.toFixed(2)}s / ${duration.toFixed(2)}s`
              : ''}
          </p>
          <div
            className="dlc-motion-timeline__rail"
            role="listbox"
            aria-label={labels.motionKeyframes}
          >
            <span className="dlc-motion-timeline__rail-end is-start">0.0s</span>
            {selectedTrack.keyframes.map((frame, index) => (
              <button
                type="button"
                key={`${frame.time}-${index}`}
                role="option"
                aria-selected={selectedFrameIndex === index}
                className={selectedFrameIndex === index ? 'is-active' : ''}
                style={{
                  left: `${duration > 0 ? (frame.time / duration) * 100 : 0}%`,
                }}
                title={`${frame.time.toFixed(2)}s`}
                onClick={() => onSelectFrame(index)}
              >
                <span>{index + 1}</span>
              </button>
            ))}
            <span className="dlc-motion-timeline__rail-end">
              {duration.toFixed(2)}s
            </span>
          </div>
        </>
      ) : (
        <p className="dlc-motion-timeline__status">{labels.motionKeyframeEmpty}</p>
      )}

      {selectedClip && selectedFrame ? (
        <div className="dlc-motion-timeline__editor">
          <TimelineField
            label={labels.motionKeyframeTime}
            value={selectedFrame.time}
            min={0}
            max={duration}
            step={0.01}
            onChange={(value) =>
              onChangeFrame((frame) => ({ ...frame, time: value }))
            }
          />
          <TimelineField
            label={labels.motionTranslateX}
            value={selectedFrame.transform.translation.x}
            min={-0.25}
            max={0.25}
            step={0.001}
            onChange={(value) =>
              onChangeFrame((frame) => ({
                ...frame,
                transform: {
                  ...frame.transform,
                  translation: { ...frame.transform.translation, x: value },
                },
              }))
            }
          />
          <TimelineField
            label={labels.motionTranslateY}
            value={selectedFrame.transform.translation.y}
            min={-0.25}
            max={0.25}
            step={0.001}
            onChange={(value) =>
              onChangeFrame((frame) => ({
                ...frame,
                transform: {
                  ...frame.transform,
                  translation: { ...frame.transform.translation, y: value },
                },
              }))
            }
          />
          <TimelineField
            label={labels.motionRotation}
            value={selectedFrame.transform.rotation}
            min={-1.2}
            max={1.2}
            step={0.01}
            onChange={(value) =>
              onChangeFrame((frame) => ({
                ...frame,
                transform: { ...frame.transform, rotation: value },
              }))
            }
          />
          <TimelineField
            label={labels.motionScaleX}
            value={selectedFrame.transform.scale.x}
            min={0.2}
            max={2}
            step={0.01}
            onChange={(value) =>
              onChangeFrame((frame) => ({
                ...frame,
                transform: {
                  ...frame.transform,
                  scale: { ...frame.transform.scale, x: value },
                },
              }))
            }
          />
          <TimelineField
            label={labels.motionScaleY}
            value={selectedFrame.transform.scale.y}
            min={0.2}
            max={2}
            step={0.01}
            onChange={(value) =>
              onChangeFrame((frame) => ({
                ...frame,
                transform: {
                  ...frame.transform,
                  scale: { ...frame.transform.scale, y: value },
                },
              }))
            }
          />
        </div>
      ) : null}

      <div className="dlc-motion-timeline__footer">
        <SettingsButton
          type="button"
          size="sm"
          disabled={!selectedTrack}
          onClick={onAddFrame}
        >
          {labels.motionAddKeyframe}
        </SettingsButton>
        <SettingsButton
          type="button"
          size="sm"
          disabled={!selectedTrack || frameCount <= 1}
          onClick={onRemoveFrame}
        >
          {labels.motionRemoveKeyframe}
        </SettingsButton>
        {canAuthorPresentation ? (
          <SettingsButton
            type="button"
            size="sm"
            title={labels.motionAuthorPresentationDescription}
            onClick={onAuthorPresentation}
          >
            {labels.motionAuthorPresentation}
          </SettingsButton>
        ) : null}
      </div>
    </section>
  )
}

function TimelineField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="dlc-motion-timeline__field">
      <span>{label}</span>
      <input
        type="number"
        value={Number(value.toFixed(4))}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number.parseFloat(event.target.value) || 0)}
      />
    </label>
  )
}
