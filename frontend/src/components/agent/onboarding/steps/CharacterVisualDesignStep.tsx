import type {
  OnboardingHeaderChrome,
  UpperBodyVisualIdentity,
  UpperBodyVisualIdentityKey,
} from '../onboardingTypes'
import { LuCheck, LuEdit3, LuX } from '@lib/icons'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import { agentService } from '../../../../services/agent'
import { generationFailureMessage } from '../generationError'
import {
  parseUpperBodyVisualIdentity,
  UPPER_BODY_VISUAL_IDENTITY_LIMITS,
} from '../onboardingTypes'
import { ActionBar, PrimaryButton, StepBody } from '../ui/Chrome'
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
  const [editingField, setEditingField] =
    useState<UpperBodyVisualIdentityKey | null>(null)
  const [draft, setDraft] = useState('')
  const generatingRef = useRef(false)
  const identityRef = useRef(identity)
  identityRef.current = identity

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

  const generate = useCallback(
    async (regenerate: boolean) => {
      if (busy || generatingRef.current) return
      generatingRef.current = true
      setError('')
      setGenerating(true)
      onBusyChange(true)
      try {
        const response = await agentService.suggestPersonaVisualDesign({
          visualRequirements: requirements.trim() || undefined,
          regenerate,
          existingVisualIdentity:
            regenerate && identityRef.current ? identityRef.current : undefined,
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
            {
              pro_unavailable: o.proUnavailable,
              visual_design_language: o.visualDesignLanguageFailed,
              visual_design_failed: o.visualDesignFailed,
              visual_identity_invalid: o.visualDesignFailed,
            },
          ),
        )
      } finally {
        generatingRef.current = false
        setGenerating(false)
        onBusyChange(false)
      }
    },
    [
      busy,
      o.generationTimeout,
      o.proUnavailable,
      o.visualDesignFailed,
      o.visualDesignLanguageFailed,
      onBusyChange,
      onIdentity,
      requirements,
    ],
  )

  const startEdit = (key: UpperBodyVisualIdentityKey) => {
    if (!identity) return
    setEditingField(key)
    setDraft(identity[key])
  }
  const cancelEdit = () => {
    setEditingField(null)
    setDraft('')
  }
  const commitEdit = () => {
    if (!identity || !editingField) return
    const next = draft.trim()
    if (!next) {
      cancelEdit()
      return
    }
    onIdentity({ ...identity, [editingField]: next })
    setEditingField(null)
    setDraft('')
  }

  const blocked = busy || generating || editingField !== null

  useLayoutEffect(() => {
    onHeaderChange({
      description: generating && !identity ? o.visualDesignGenerating : o.step4Lead,
      action: {
        label: generating
          ? o.visualDesignGenerating
          : identity
            ? o.visualDesignRegenerate
            : o.visualDesignGenerate,
        busy: generating,
        disabled: blocked,
        onClick: () => void generate(true),
      },
    })
  }, [
    blocked,
    generate,
    generating,
    identity,
    o.step4Lead,
    o.visualDesignGenerate,
    o.visualDesignGenerating,
    o.visualDesignRegenerate,
    onHeaderChange,
  ])

  return (
    <section className="life-ob-visual" aria-label={o.step4Title}>
      <StepBody>
        <Field
          label={o.visualRequirements}
          optional
          optionalLabel={o.optional}
        >
          <TextArea
            value={requirements}
            rows={2}
            maxLength={500}
            disabled={blocked}
            placeholder={o.visualRequirementsPlaceholder}
            onChange={(event) => {
              onRequirements(event.target.value)
            }}
          />
        </Field>

        {identity ? (
          <dl className="life-ob-persona-view" aria-label={o.step4Title}>
            {rows.map((row) => {
              const isEditing = editingField === row.key
              return (
                <div
                  key={row.key}
                  className={`life-ob-persona-view__row${isEditing ? ' is-editing' : ''}`}
                >
                  {isEditing ? (
                    <div className="life-ob-persona-view__editor">
                      <dt>{row.label}</dt>
                      <TextArea
                        rows={4}
                        maxLength={UPPER_BODY_VISUAL_IDENTITY_LIMITS[row.key]}
                        value={draft}
                        autoFocus
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            (event.metaKey || event.ctrlKey) &&
                            event.key === 'Enter'
                          ) {
                            event.preventDefault()
                            commitEdit()
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelEdit()
                          }
                        }}
                      />
                      <div className="life-ob-persona-view__actions">
                        <button
                          type="button"
                          className="life-ob-persona-view__action is-cancel"
                          disabled={busy}
                          title={o.cancelEdit}
                          aria-label={o.cancelEdit}
                          onClick={cancelEdit}
                        >
                          <LuX aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="life-ob-persona-view__action is-save"
                          disabled={busy}
                          title={o.doneEditing}
                          aria-label={o.doneEditing}
                          onClick={commitEdit}
                        >
                          <LuCheck aria-hidden />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="life-ob-persona-view__copy">
                        <dt>{row.label}</dt>
                        <dd>{identity[row.key]}</dd>
                      </div>
                      <button
                        type="button"
                        className="life-ob-persona-view__edit"
                        disabled={busy || generating}
                        title={o.editVisual}
                        aria-label={`${o.editVisual} · ${row.label}`}
                        onClick={() => startEdit(row.key)}
                      >
                        <LuEdit3 aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </dl>
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
            generating
              ? o.visualDesignGenerating
              : identity
                ? busy
                  ? o.saving
                  : o.next
                : o.visualDesignGenerate
          }
          busy={generating || (busy && Boolean(identity))}
          disabled={editingField !== null || (Boolean(identity) && generating)}
          onClick={() => {
            if (blocked) return
            if (!identity) {
              void generate(false)
              return
            }
            setError('')
            void onConfirm().catch((reason) => {
              setError(
                generationFailureMessage(
                  reason,
                  o.visualDesignSaveFailed,
                  o.generationTimeout,
                  {
                    persona_contract_invalid: o.saveFailed,
                    visual_profile_invalid: o.visualDesignSaveFailed,
                  },
                ),
              )
            })
          }}
        />
      </ActionBar>
    </section>
  )
}
