import type {
  OnboardingHeaderChrome,
  UpperBodyVisualIdentity,
  UpperBodyVisualIdentityKey,
} from '../onboardingTypes'
import { useLayoutEffect, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import { agentService } from '../../../../services/agent'
import { generationFailureMessage } from '../generationError'
import { parseUpperBodyVisualIdentity } from '../onboardingTypes'
import { ActionBar, GhostButton, PrimaryButton, StepBody } from '../ui/Chrome'
import { ErrorNote } from '../ui/Feedback'
import { Field, TextArea } from '../ui/Field'

interface Props {
  identity: UpperBodyVisualIdentity | null
  requirements: string
  busy: boolean
  onIdentity: (identity: UpperBodyVisualIdentity | null) => void
  onRequirements: (requirements: string) => void
  onBusyChange: (busy: boolean) => void
  onHeaderChange: (chrome: OnboardingHeaderChrome) => void
  onConfirm: () => Promise<void>
}

export default function CharacterVisualDesignStep({
  identity,
  requirements,
  busy,
  onIdentity,
  onRequirements,
  onBusyChange,
  onHeaderChange,
  onConfirm,
}: Props) {
  const { t } = useI18n()
  const o = t.life.onboarding
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useLayoutEffect(() => {
    onHeaderChange({ description: o.step4Lead })
  }, [o.step4Lead, onHeaderChange])

  const rows: Array<{
    key: UpperBodyVisualIdentityKey
    label: string
  }> = [
    { key: 'faceDesign', label: o.visualFaceDesign },
    { key: 'eyeDesign', label: o.visualEyeDesign },
    { key: 'hairShape', label: o.visualHairShape },
    { key: 'hairLayerPlan', label: o.visualHairLayers },
    { key: 'upperBodySilhouette', label: o.visualUpperBodySilhouette },
    { key: 'outfitConstruction', label: o.visualOutfitConstruction },
    { key: 'sleeveArmDesign', label: o.visualSleeveArmDesign },
    { key: 'materialPlan', label: o.visualMaterialPlan },
    { key: 'heroAccessory', label: o.visualHeroAccessory },
    { key: 'paletteHint', label: o.visualPalette },
    { key: 'motif', label: o.visualMotif },
  ]

  const generate = async (regenerate: boolean) => {
    if (busy || generating) return
    setError('')
    setGenerating(true)
    onBusyChange(true)
    try {
      const response = await agentService.suggestPersonaVisualDesign({
        visualRequirements: requirements.trim() || undefined,
        regenerate,
        existingVisualIdentity: regenerate && identity ? identity : undefined,
      })
      const generated = parseUpperBodyVisualIdentity(response.visualIdentity)
      if (!generated) throw new Error(o.visualDesignFailed)
      onIdentity(generated)
    } catch (reason) {
      setError(
        generationFailureMessage(
          reason,
          o.visualDesignFailed,
          o.generationTimeout,
        ),
      )
    } finally {
      setGenerating(false)
      onBusyChange(false)
    }
  }

  const blocked = busy || generating

  return (
    <section className="life-ob-visual" aria-label={o.step4Title}>
      <StepBody>
        <div className="life-ob-visual__intro">
          <strong>{o.visualDesignScopeTitle}</strong>
          <p>{o.visualDesignScopeHint}</p>
        </div>
        <Field
          label={o.visualRequirements}
          hint={o.visualRequirementsHint}
          optional
          optionalLabel={o.optional}
        >
          <TextArea
            value={requirements}
            rows={3}
            maxLength={500}
            disabled={blocked}
            placeholder={o.visualRequirementsPlaceholder}
            onChange={(event) => {
              onRequirements(event.target.value)
              if (identity) onIdentity(null)
            }}
          />
        </Field>

        {identity ? (
          <section
            className="life-ob-visual__design"
            aria-label={o.visualDesignPreview}
          >
            <header className="life-ob-visual__design-head">
              <h2>{o.visualDesignPreview}</h2>
              <GhostButton
                label={
                  generating ? o.visualDesignGenerating : o.visualDesignRegenerate
                }
                disabled={blocked}
                onClick={() => void generate(true)}
              />
            </header>
            <dl className="life-ob-visual__grid">
              {rows.map((row) => (
                <div key={row.key} className="life-ob-visual__row">
                  <dt>{row.label}</dt>
                  <dd>{identity[row.key]}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : generating ? (
          <div className="life-ob-visual__pending">
            <span className="life-loading__orb" aria-hidden />
            <span>{o.visualDesignGenerating}</span>
          </div>
        ) : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </StepBody>
      <ActionBar>
        <PrimaryButton
          label={
            identity
              ? o.visualDesignConfirm
              : generating
                ? o.visualDesignGenerating
                : o.visualDesignGenerate
          }
          busy={generating || (busy && Boolean(identity))}
          disabled={busy && !generating}
          onClick={() => {
            if (!identity) {
              void generate(false)
              return
            }
            setError('')
            void onConfirm().catch((reason) => {
              setError(
                reason instanceof Error ? reason.message : o.visualDesignSaveFailed,
              )
            })
          }}
        />
      </ActionBar>
    </section>
  )
}
