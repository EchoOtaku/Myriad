import type { LifeGender, OnboardingHeaderChrome } from '../onboardingTypes'
import { LuLoader2, LuShuffle } from '@lib/icons'
import { useEffect, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import { agentService } from '../../../../services/agent'
import { ActionBar, PrimaryButton, StepBody } from '../ui/Chrome'
import { ErrorNote } from '../ui/Feedback'
import { Field, FieldGroup, TextArea, TextInput } from '../ui/Field'
import GenderPicker from '../ui/GenderPicker'

interface Props {
  displayName: string
  gender: LifeGender | null
  extraRequirements: string
  selectedTags: string[]
  busy: boolean
  onDisplayName: (value: string) => void
  onGender: (value: LifeGender) => void
  onExtra: (value: string) => void
  onSubmit: () => Promise<void>
  onHeaderChange?: (chrome: OnboardingHeaderChrome) => void
}

export default function BasicsStep({
  displayName,
  gender,
  extraRequirements,
  selectedTags,
  busy,
  onDisplayName,
  onGender,
  onExtra,
  onSubmit,
  onHeaderChange,
}: Props) {
  const { t } = useI18n()
  const o = t.life.onboarding
  const [localError, setLocalError] = useState('')
  const [nameError, setNameError] = useState('')
  const [rollingName, setRollingName] = useState(false)

  useEffect(() => {
    onHeaderChange?.({ description: o.step2Lead })
  }, [o.step2Lead, onHeaderChange])

  const rollDisplayName = () => {
    if (busy || rollingName) return
    setNameError('')
    setRollingName(true)
    const tags = selectedTags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 28)
    void agentService
      .suggestPersonaName({
        selectedTags: tags,
        gender: gender ?? undefined,
        avoidName: displayName.trim() || undefined,
      })
      .then((response) => {
        if (!response.name?.trim() || response.tier === 'fallback') {
          throw new Error(o.randomNameFailed)
        }
        onDisplayName(response.name)
        setNameError('')
      })
      .catch((reason) => {
        setNameError(
          reason instanceof Error ? reason.message : o.randomNameFailed,
        )
      })
      .finally(() => setRollingName(false))
  }

  return (
    <section className="life-ob-basics" aria-label={o.step2Title}>
      <StepBody>
        <Field label={o.nameLabel} hint={o.nameHint}>
          <div className="life-ob-name-row">
            <TextInput
              value={displayName}
              maxLength={40}
              placeholder={o.namePlaceholder}
              disabled={busy || rollingName}
              onChange={(event) => onDisplayName(event.target.value)}
              aria-label={o.nameLabel}
            />
            <button
              type="button"
              className="life-ob-name-roll"
              disabled={busy || rollingName}
              title={rollingName ? o.randomNameBusy : o.randomName}
              aria-label={rollingName ? o.randomNameBusy : o.randomName}
              onClick={rollDisplayName}
            >
              {rollingName ? (
                <LuLoader2 className="life-ob-name-roll__spin" aria-hidden />
              ) : (
                <LuShuffle aria-hidden />
              )}
            </button>
          </div>
          {nameError ? (
            <small className="life-ob-field__hint" role="alert">
              {nameError}
            </small>
          ) : null}
        </Field>

        <FieldGroup label={o.genderLabel}>
          <GenderPicker
            label={o.genderLabel}
            value={gender}
            labels={o.gender}
            disabled={busy}
            onChange={onGender}
          />
        </FieldGroup>

        <Field
          label={o.extraLabel}
          optional
          optionalLabel={o.optional}
          hint={o.extraHint}
        >
          <TextArea
            value={extraRequirements}
            maxLength={500}
            rows={3}
            placeholder={o.extraPlaceholder}
            onChange={(event) => onExtra(event.target.value)}
          />
        </Field>

        {localError && <ErrorNote>{localError}</ErrorNote>}
      </StepBody>
      <ActionBar>
        <PrimaryButton
          label={busy ? o.creating : o.createAndContinue}
          busy={busy}
          onClick={() => {
            setLocalError('')
            if (!gender) {
              setLocalError(o.genderRequired)
              return
            }
            void onSubmit().catch((reason) => {
              setLocalError(
                reason instanceof Error ? reason.message : o.createFailed,
              )
            })
          }}
        />
      </ActionBar>
    </section>
  )
}
