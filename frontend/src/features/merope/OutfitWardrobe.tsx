import type {
  ClothingStyle,
  PersonaGender,
  UpperBodyVisualIdentity,
} from '../../components/agent/onboarding/onboardingTypes'
import { useState } from 'react'
import { generationFailureMessage } from '../../components/agent/onboarding/generationError'
import {
  CLOTHING_STYLE_OPTIONS,
  clothingStylePreview,
  parseUpperBodyVisualIdentity,
} from '../../components/agent/onboarding/onboardingTypes'
import { Field, TextArea } from '../../components/agent/onboarding/ui/Field'
import { SettingsButton } from '../../components/settings'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import {
  applyOutfit,
  MAX_WARDROBE_ITEMS,
  newWardrobeId,
  sortWardrobe,
} from './wardrobe'
import type { WardrobeItem } from './wardrobe'
import '../../components/agent/PersonaOnboarding.css'

interface Props {
  identity: UpperBodyVisualIdentity | null
  gender: PersonaGender | null
  language: string
  items: WardrobeItem[]
  activeId: string | null
  busy: boolean
  onApply: (item: WardrobeItem, identity: UpperBodyVisualIdentity) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onCreated: (item: WardrobeItem, identity: UpperBodyVisualIdentity) => Promise<void>
}

function Hanger() {
  return (
    <svg
      className="merope-wardrobe__hanger"
      viewBox="0 0 72 22"
      aria-hidden
    >
      <path
        d="M36 3.2c0-1.6 1.2-2.7 2.6-2.7 1.3 0 2.4 1 2.4 2.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M36 3.4v4.2L6 19.5h60L36 7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function OutfitWardrobe({
  identity,
  gender,
  language,
  items,
  activeId,
  busy,
  onApply,
  onDelete,
  onCreated,
}: Props) {
  const { t } = useI18n()
  const labels = t.merope
  const styleNames = t.agentPersona.onboarding.clothingStyle
  const o = t.agentPersona.onboarding
  const [composing, setComposing] = useState(false)
  const [style, setStyle] = useState<ClothingStyle | null>(null)
  const [requirements, setRequirements] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const blocked = busy || generating
  const full = items.length >= MAX_WARDROBE_ITEMS
  const canGenerate = Boolean(identity && gender && style) && !full
  const rack = sortWardrobe(items)

  const generate = async () => {
    if (!identity || !gender || !style || blocked || full) return
    setGenerating(true)
    setError('')
    try {
      const response = await agentService.suggestPersonaVisualDesign({
        gender,
        language,
        clothingStyle: style,
        visualRequirements: requirements.trim() || undefined,
        keepCharacter: true,
        existingVisualIdentity: identity,
      })
      const generated = parseUpperBodyVisualIdentity(response.visualIdentity)
      if (!generated) throw new Error(o.visualDesignFailed)
      const nextIdentity = applyOutfit(identity, {
        id: 'next',
        clothingStyle: style,
        outfit: generated.outfit,
      })
      const item: WardrobeItem = {
        id: newWardrobeId(),
        clothingStyle: style,
        outfit: generated.outfit,
      }
      await onCreated(item, nextIdentity)
      setComposing(false)
      setStyle(null)
      setRequirements('')
    } catch (reason) {
      setError(
        generationFailureMessage(
          reason,
          o.visualDesignFailed,
          o.generationTimeout,
          {
            pro_unavailable: o.proUnavailable,
            visual_design_language: o.visualDesignLanguageFailed,
            visual_language_required: o.visualDesignLanguageFailed,
            visual_design_unusable: o.visualDesignUnusable,
            visual_identity_invalid: o.visualDesignFailed,
            clothing_style_required: o.clothingStyleRequired,
            gender_required: o.genderRequired,
          },
        ),
      )
    } finally {
      setGenerating(false)
    }
  }

  return (
    <section className="merope-wardrobe" aria-label={labels.wardrobeTitle}>
      <div className="merope-wardrobe__case">
        <div className="merope-wardrobe__rail" aria-hidden />
        <div
          className="merope-wardrobe__rack"
          role="list"
          aria-label={labels.wardrobeTitle}
        >
          {rack.length === 0
            ? [0, 1, 2].map((index) => (
                <div
                  key={`ghost-${index}`}
                  className={`merope-wardrobe__hang is-ghost${index % 2 ? ' is-tilt-r' : ' is-tilt-l'}`}
                  aria-hidden
                >
                  <Hanger />
                  <div className="merope-wardrobe__garment merope-wardrobe__garment--ghost" />
                </div>
              ))
            : null}
          {rack.map((item, index) => {
              const selected = item.id === activeId
              return (
                <div
                  key={item.id}
                  className={`merope-wardrobe__hang${selected ? ' is-on' : ''}${index % 2 ? ' is-tilt-r' : ' is-tilt-l'}`}
                  role="listitem"
                >
                  <Hanger />
                  <button
                    type="button"
                    className="merope-wardrobe__garment"
                    disabled={blocked || selected}
                    aria-pressed={selected}
                    aria-label={styleNames[item.clothingStyle]}
                    onClick={() => {
                      if (!identity || selected) return
                      setError('')
                      void onApply(item, applyOutfit(identity, item)).catch(
                        (reason) => {
                          setError(
                            generationFailureMessage(
                              reason,
                              labels.wardrobeApplyFailed,
                              o.generationTimeout,
                            ),
                          )
                        },
                      )
                    }}
                  >
                    <img
                      src={clothingStylePreview(item.clothingStyle)}
                      alt=""
                      draggable={false}
                    />
                  </button>
                  <div className="merope-wardrobe__tag">
                    <span>{styleNames[item.clothingStyle]}</span>
                    {selected ? (
                      <i className="merope-wardrobe__wearing">
                        {labels.wardrobeWearing}
                      </i>
                    ) : null}
                    {rack.length > 1 ? (
                      <button
                        type="button"
                        className="merope-wardrobe__remove"
                        disabled={blocked}
                        aria-label={t.common.delete}
                        onClick={() => {
                          setError('')
                          void onDelete(item.id).catch((reason) => {
                            setError(
                              generationFailureMessage(
                                reason,
                                labels.wardrobeDeleteFailed,
                                o.generationTimeout,
                              ),
                            )
                          })
                        }}
                      >
                        {t.common.delete}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          {!composing && !full && identity && gender ? (
            <div className="merope-wardrobe__hang is-add" role="listitem">
              <Hanger />
              <button
                type="button"
                className="merope-wardrobe__garment merope-wardrobe__garment--empty"
                disabled={blocked}
                onClick={() => {
                  setError('')
                  setComposing(true)
                }}
              >
                <span className="merope-wardrobe__add-mark" aria-hidden>
                  +
                </span>
                <span>{labels.wardrobeNew}</span>
              </button>
            </div>
          ) : null}
        </div>
        {!identity ? (
          <p className="merope-wardrobe__caption">{labels.wardrobeNeedCharacter}</p>
        ) : rack.length === 0 && !composing ? (
          <p className="merope-wardrobe__caption">{labels.wardrobeEmpty}</p>
        ) : null}
      </div>
      {composing ? (
        <div className="merope-wardrobe__drawer">
          <p className="merope-wardrobe__drawer-label">{o.clothingStyleLabel}</p>
          <div
            className="merope-wardrobe__families"
            role="radiogroup"
            aria-label={o.clothingStyleLabel}
          >
            {CLOTHING_STYLE_OPTIONS.map((option) => {
              const selected = style === option
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`merope-wardrobe__family${selected ? ' is-on' : ''}`}
                  disabled={blocked}
                  onClick={() => setStyle(option)}
                >
                  <img
                    src={clothingStylePreview(option)}
                    alt=""
                    draggable={false}
                  />
                  <span>{styleNames[option]}</span>
                </button>
              )
            })}
          </div>
          <Field
            label={labels.wardrobeRequirements}
            optional
            optionalLabel={o.optional}
            hint={labels.wardrobeRequirementsHint}
          >
            <TextArea
              value={requirements}
              rows={2}
              maxLength={500}
              disabled={blocked}
              placeholder={labels.wardrobeRequirementsPlaceholder}
              onChange={(event) => setRequirements(event.target.value)}
            />
          </Field>
          <div className="merope-wardrobe__actions">
            <SettingsButton
              type="button"
              size="sm"
              disabled={!canGenerate}
              loading={generating}
              onClick={() => void generate()}
            >
              {generating ? o.visualDesignGenerating : labels.wardrobeGenerate}
            </SettingsButton>
            <SettingsButton
              type="button"
              size="sm"
              variant="secondary"
              disabled={generating}
              onClick={() => {
                setComposing(false)
                setError('')
              }}
            >
              {t.common.cancel}
            </SettingsButton>
          </div>
        </div>
      ) : full ? (
        <p className="merope-motion-home__help">{labels.wardrobeFull}</p>
      ) : null}
      {error ? (
        <p className="merope-motion-home__help" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
