import type { OnboardingHeaderChrome } from '../onboardingTypes'
import { LuImage } from '@lib/icons'
import { useEffect, useLayoutEffect, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import {
  generateSitePortrait,
  getSiteFace,
} from '../../../../features/digital-life-companion/api'
import { notifyFaceUpdated } from '../../../../features/digital-life-companion/events'
import { generationFailureMessage } from '../generationError'
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
  const [requirementsDirty, setRequirementsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useLayoutEffect(() => {
    onHeaderChange({ description: o.step5Lead })
  }, [o.step5Lead, onHeaderChange])

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

  const generate = async () => {
    if (busy || generating) return
    setError('')
    setGenerating(true)
    onBusyChange(true)
    try {
      const result = await generateSitePortrait(
        requirements.trim() || undefined,
      )
      if (!result.portraitUrl) throw new Error(o.portraitGenerateFailed)
      setPortraitUrl(result.portraitUrl)
      setRequirementsDirty(false)
      notifyFaceUpdated()
    } catch (reason) {
      setError(
        generationFailureMessage(
          reason,
          o.portraitGenerateFailed,
          o.generationTimeout,
        ),
      )
    } finally {
      setGenerating(false)
      onBusyChange(false)
    }
  }

  const blocked = busy || generating || loading

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
                  {generating ? o.portraitGenerating : o.portraitLoading}
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
            <div className="life-ob-master__contract">
              <strong>{o.portraitContractTitle}</strong>
              <p>{o.portraitContractHint}</p>
            </div>
            <Field
              label={o.portraitRequirements}
              hint={o.portraitRequirementsHint}
              optional
              optionalLabel={o.optional}
            >
              <TextArea
                value={requirements}
                rows={4}
                maxLength={2_000}
                disabled={blocked}
                placeholder={o.portraitRequirementsPlaceholder}
                onChange={(event) => {
                  setRequirements(event.target.value)
                  setRequirementsDirty(true)
                }}
              />
            </Field>
            {portraitUrl ? (
              <GhostButton
                label={generating ? o.portraitGenerating : o.portraitRegenerate}
                disabled={blocked}
                onClick={() => void generate()}
              />
            ) : null}
          </div>
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </StepBody>
      <ActionBar>
        <PrimaryButton
          label={
            portraitUrl && !requirementsDirty
              ? o.portraitFinish
              : generating
                ? o.portraitGenerating
                : o.portraitGenerate
          }
          busy={generating}
          disabled={loading || (busy && !generating)}
          onClick={() => {
            if (portraitUrl && !requirementsDirty) onFinished()
            else void generate()
          }}
        />
      </ActionBar>
    </section>
  )
}
