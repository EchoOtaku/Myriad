import type { OnboardingHeaderChrome, StructuredPersona } from '../onboardingTypes'
import { LuCheck, LuEdit3, LuX } from '@lib/icons'
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import { joinList, parseList } from '../onboardingTypes'
import { ActionBar, GhostButton, PrimaryButton, StepBody } from '../ui/Chrome'
import { ErrorNote } from '../ui/Feedback'
import { TextArea, TextInput } from '../ui/Field'

interface Props {
  persona: StructuredPersona
  busy: boolean
  generating: boolean
  onHeaderChange?: (chrome: OnboardingHeaderChrome) => void
  onRegenerate: () => Promise<void>
  onSave: (persona: StructuredPersona) => Promise<void>
}

type PersonaFieldKey =
  | 'temperament'
  | 'likes'
  | 'drives'
  | 'socialStyle'
  | 'voice'
  | 'summary'

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function keepText(next: unknown, fallback: string): string {
  return text(next).trim() || fallback
}

export default function PersonaEditStep({
  persona,
  busy,
  generating,
  onHeaderChange,
  onRegenerate,
  onSave,
}: Props) {
  const { t } = useI18n()
  const o = t.life.onboarding
  const [summary, setSummary] = useState(() => persona.summary)
  const [temperament, setTemperament] = useState(() =>
    joinList(persona.temperament),
  )
  const [likes, setLikes] = useState(() => joinList(persona.likes))
  const [drives, setDrives] = useState(() => joinList(persona.drives))
  const [socialStyle, setSocialStyle] = useState(() => persona.socialStyle)
  const [voice, setVoice] = useState(() => persona.speechStyle)
  const [draftSource, setDraftSource] = useState(
    () => persona.draftSource || 'seed',
  )
  const [error, setError] = useState('')
  const [editingField, setEditingField] = useState<PersonaFieldKey | null>(null)
  const [draft, setDraft] = useState('')
  const [regenBusy, setRegenBusy] = useState(false)

  const applyDraft = useCallback((next: StructuredPersona) => {
    setSummary((current) => keepText(next.summary, current))
    setTemperament((current) => joinList(next.temperament) || current)
    setLikes((current) => joinList(next.likes) || current)
    setDrives((current) => joinList(next.drives) || current)
    setSocialStyle((current) => keepText(next.socialStyle, current))
    setVoice((current) => keepText(next.speechStyle, current))
    setDraftSource(next.draftSource || 'lite')
  }, [])

  useEffect(() => {
    applyDraft(persona)
  }, [applyDraft, persona])

  const generatePersona = useCallback(async () => {
    if (regenBusy) return
    setRegenBusy(true)
    setError('')
    try {
      await onRegenerate()
      setEditingField(null)
      setDraft('')
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : o.regeneratePersonaFailed,
      )
    } finally {
      setRegenBusy(false)
    }
  }, [o.regeneratePersonaFailed, onRegenerate, regenBusy])

  const values: Record<PersonaFieldKey, string> = {
    temperament,
    likes,
    drives,
    socialStyle,
    voice,
    summary,
  }
  const setters: Record<PersonaFieldKey, (next: string) => void> = {
    temperament: setTemperament,
    likes: setLikes,
    drives: setDrives,
    socialStyle: setSocialStyle,
    voice: setVoice,
    summary: setSummary,
  }
  const optionalFields = new Set<PersonaFieldKey>([
    'likes',
    'drives',
    'socialStyle',
    'voice',
  ])
  const rows: Array<{
    key: PersonaFieldKey
    label: string
    multiline?: boolean
  }> = [
    { key: 'temperament', label: o.fieldTemperament },
    { key: 'likes', label: o.fieldLikes },
    { key: 'drives', label: o.fieldDrives },
    { key: 'socialStyle', label: o.fieldSocial },
    { key: 'voice', label: o.fieldVoice },
    { key: 'summary', label: o.fieldSummary, multiline: true },
  ]

  const shownValue = (key: PersonaFieldKey) => {
    const raw = values[key].trim()
    if (raw) return raw
    return generating || regenBusy ? o.personaFieldGenerating : ''
  }

  const visibleRows = rows.filter((row) => {
    if (!optionalFields.has(row.key)) return true
    return Boolean(shownValue(row.key))
  })

  const startEdit = (key: PersonaFieldKey) => {
    setEditingField(key)
    setDraft(values[key])
  }
  const cancelEdit = () => {
    setEditingField(null)
    setDraft('')
  }
  const commitEdit = () => {
    if (!editingField) return
    setters[editingField](draft)
    setEditingField(null)
    setDraft('')
  }

  const blocked = busy || generating || regenBusy || editingField !== null
  const incomplete = generating || regenBusy || draftSource === 'fallback'
  const headerDescription =
    generating || regenBusy
      ? o.step3LeadPending
      : draftSource === 'fallback'
        ? o.personaNotCompleteIncomplete
        : o.step3Lead

  useEffect(() => {
    onHeaderChange?.({
      description: headerDescription,
      tone: draftSource === 'fallback' && !generating && !regenBusy
        ? 'warning'
        : 'default',
      action: {
        label:
          generating || regenBusy
            ? o.regeneratingPersona
            : o.regeneratePersona,
        busy: generating || regenBusy,
        disabled: blocked,
        onClick: () => void generatePersona(),
      },
    })
  }, [
    blocked,
    draftSource,
    generatePersona,
    generating,
    headerDescription,
    o.regeneratePersona,
    o.regeneratingPersona,
    onHeaderChange,
    regenBusy,
  ])

  return (
    <section aria-label={o.step3Title}>
      <StepBody>
        <div
          className={`life-ob-persona-groups${incomplete ? ' is-incomplete' : ''}`}
        >
          <section
            className="life-ob-persona-group"
            aria-label={o.personaGroupCharacter}
          >
            <h2 className="life-ob-persona-group__title">
              {o.personaGroupCharacter}
              {incomplete ? (
                <span className="life-ob-persona-group__draft">
                  {o.personaDraftLabel}
                </span>
              ) : null}
            </h2>
            <dl className="life-ob-persona-view">
              {visibleRows.map((row) => {
                const isEditing = editingField === row.key
                const display = shownValue(row.key)
                return (
                  <div
                    key={row.key}
                    className={`life-ob-persona-view__row${isEditing ? ' is-editing' : ''}`}
                  >
                    {isEditing ? (
                      <div className="life-ob-persona-view__editor">
                        <dt>{row.label}</dt>
                        {row.multiline ? (
                          <TextArea
                            rows={3}
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
                        ) : (
                          <TextInput
                            value={draft}
                            autoFocus
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                commitEdit()
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                cancelEdit()
                              }
                            }}
                          />
                        )}
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
                          <dd
                            className={
                              display === o.personaFieldGenerating
                                ? 'is-pending'
                                : undefined
                            }
                          >
                            {display}
                          </dd>
                        </div>
                        <button
                          type="button"
                          className="life-ob-persona-view__edit"
                          disabled={blocked}
                          title={o.editPersona}
                          aria-label={`${o.editPersona} · ${row.label}`}
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
          </section>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </StepBody>
      <ActionBar>
        <PrimaryButton
          label={busy ? o.saving : o.saveAndContinue}
          busy={busy}
          disabled={
            generating ||
            regenBusy ||
            editingField !== null ||
            !summary.trim() ||
            parseList(temperament).length === 0
          }
          onClick={() => {
            setError('')
            void onSave({
              summary: summary.trim(),
              temperament: parseList(temperament),
              likes: parseList(likes),
              drives: parseList(drives),
              socialStyle: socialStyle.trim(),
              speechStyle: voice.trim(),
              draftSource,
            }).catch((reason) => {
              setError(reason instanceof Error ? reason.message : o.saveFailed)
            })
          }}
        />
      </ActionBar>
    </section>
  )
}
