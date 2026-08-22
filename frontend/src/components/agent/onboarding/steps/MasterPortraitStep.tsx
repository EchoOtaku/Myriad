import type { OnboardingHeaderChrome } from '../onboardingTypes'
import { LuImage } from '@lib/icons'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import {
  generateSitePortrait,
  getSiteFace,
} from '../../../../features/digital-life-companion/api'
import { notifyFaceUpdated } from '../../../../features/digital-life-companion/events'
import {
  generationFailureMessage,
  isGenerationTimeout,
  isPortraitInProgress,
} from '../generationError'
import { ActionBar, GhostButton, PrimaryButton, StepBody } from '../ui/Chrome'
import { ErrorNote } from '../ui/Feedback'
import { Field, TextArea } from '../ui/Field'

interface Props {
  characterName: string
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onHeaderChange: (chrome: OnboardingHeaderChrome) => void
  onFinished: () => void
}

export default function MasterPortraitStep({
  characterName,
  busy,
  onBusyChange,
  onHeaderChange,
  onFinished,
}: Props) {
  const { t } = useI18n()
  const o = t.life.onboarding
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [requirements, setRequirements] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const generatingRef = useRef(false)
  const portraitUrlRef = useRef(portraitUrl)
  portraitUrlRef.current = portraitUrl

  const portraitErrors = {
    pro_unavailable: o.proUnavailable,
    visual_design_required: o.visualDesignRequired,
    image_provider_unconfigured: o.imageProviderUnconfigured,
    portrait_generation_in_progress: o.portraitInProgress,
    character_visual_inputs_changed: o.portraitInputsChanged,
    portrait_generation_failed: o.portraitGenerateFailed,
    portrait_edit_notes_required: o.portraitEditNeedsNotes,
    portrait_required_for_edit: o.portraitEmpty,
    portrait_edit_failed: o.portraitEditFailed,
  }

  const recoverPortrait = useCallback(
    async (previousUrl: string | null) => {
      for (const waitMs of [0, 2000, 3000, 4000, 5000]) {
        if (waitMs) {
          await new Promise((resolve) => window.setTimeout(resolve, waitMs))
        }
        try {
          const face = await getSiteFace()
          if (face.portraitUrl && face.portraitUrl !== previousUrl) {
            setPortraitUrl(face.portraitUrl)
            notifyFaceUpdated()
            return true
          }
        } catch {
          /* keep polling the public face */
        }
      }
      return false
    },
    [],
  )

  const generate = useCallback(async (edit = false) => {
    if (busy || generatingRef.current) return
    if (edit && !requirements.trim()) {
      setError(o.portraitEditNeedsNotes)
      return
    }
    generatingRef.current = true
    const previousUrl = portraitUrlRef.current
    setError('')
    setEditing(edit)
    setGenerating(true)
    onBusyChange(true)
    try {
      const result = await generateSitePortrait(
        requirements.trim() || undefined,
        { edit },
      )
      if (!result.portraitUrl) {
        throw new Error(edit ? o.portraitEditFailed : o.portraitGenerateFailed)
      }
      setPortraitUrl(result.portraitUrl)
      notifyFaceUpdated()
    } catch (reason) {
      if (
        (isPortraitInProgress(reason) || isGenerationTimeout(reason)) &&
        (await recoverPortrait(previousUrl))
      ) {
        return
      }
      setError(
        generationFailureMessage(
          reason,
          edit ? o.portraitEditFailed : o.portraitGenerateFailed,
          o.generationTimeout,
          portraitErrors,
        ),
      )
    } finally {
      generatingRef.current = false
      setGenerating(false)
      setEditing(false)
      onBusyChange(false)
    }
  }, [
    busy,
    o.generationTimeout,
    o.imageProviderUnconfigured,
    o.portraitEditFailed,
    o.portraitEditNeedsNotes,
    o.portraitGenerateFailed,
    o.portraitInProgress,
    o.portraitInputsChanged,
    o.proUnavailable,
    o.visualDesignRequired,
    onBusyChange,
    recoverPortrait,
    requirements,
  ])

  useEffect(() => {
    let cancelled = false
    void getSiteFace()
      .then((face) => {
        if (!cancelled) setPortraitUrl(face.portraitUrl)
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : o.portraitLoadFailed,
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [o.portraitLoadFailed])

  const blocked = busy || generating || loading

  useLayoutEffect(() => {
    onHeaderChange({
      description:
        generating && !portraitUrl
          ? editing
            ? o.portraitEditing
            : o.portraitGenerating
          : o.step5Lead,
      action: {
        label: generating
          ? editing
            ? o.portraitEditing
            : o.portraitGenerating
          : portraitUrl
            ? o.portraitRegenerate
            : o.portraitGenerate,
        busy: generating,
        disabled: blocked,
        onClick: () => void generate(false),
      },
    })
  }, [
    blocked,
    generate,
    generating,
    editing,
    o.portraitEditing,
    o.portraitGenerate,
    o.portraitGenerating,
    o.portraitRegenerate,
    o.step5Lead,
    onHeaderChange,
    portraitUrl,
  ])

  return (
    <section className="life-ob-master" aria-label={o.step5Title}>
      <StepBody>
        <div className="life-ob-master__layout">
          <div
            className={`life-ob-master__preview${portraitUrl ? '' : ' is-empty'}`}
          >
            {portraitUrl ? (
              <img src={portraitUrl} alt={characterName} decoding="async" />
            ) : loading || generating ? (
              <div className="life-ob-master__placeholder">
                <span className="life-loading__orb" aria-hidden />
                <span>
                  {generating
                    ? editing
                      ? o.portraitEditing
                      : o.portraitGenerating
                    : o.portraitLoading}
                </span>
              </div>
            ) : (
              <div className="life-ob-master__placeholder">
                <LuImage aria-hidden />
                <span>{o.portraitEmpty}</span>
              </div>
            )}
          </div>

          <div className="life-ob-master__controls">
            <Field
              label={o.portraitRequirements}
              optional
              optionalLabel={o.optional}
            >
              <TextArea
                value={requirements}
                rows={3}
                maxLength={2_000}
                disabled={blocked}
                placeholder={o.portraitRequirementsPlaceholder}
                onChange={(event) => setRequirements(event.target.value)}
              />
            </Field>
            {portraitUrl ? (
              <GhostButton
                label={editing ? o.portraitEditing : o.portraitEdit}
                disabled={blocked || !requirements.trim()}
                onClick={() => void generate(true)}
              />
            ) : null}
          </div>
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </StepBody>
      <ActionBar>
        <PrimaryButton
          label={
            generating
              ? editing
                ? o.portraitEditing
                : o.portraitGenerating
              : loading
                ? o.portraitLoading
                : portraitUrl
                  ? o.portraitFinish
                  : o.portraitGenerate
          }
          busy={generating || loading}
          disabled={loading || (Boolean(portraitUrl) && generating)}
          onClick={() => {
            if (blocked) return
            if (portraitUrl) onFinished()
            else void generate(false)
          }}
        />
      </ActionBar>
    </section>
  )
}
