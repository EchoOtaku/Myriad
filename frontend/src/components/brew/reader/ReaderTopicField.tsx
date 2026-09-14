import { LuSparkles, LuTag } from '@lib/icons'
import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import {
  listSubscriptionTopics,
  setItemTopic,
  suggestItemTopic,
} from '../../../services/brewApi'
import { showToast } from '../../../utils/toastManager'
import { userFacingError } from '../../../utils/userFacingError'
import {
  normalizeTopicName,
  topicDisplayName,
} from '../logic/topics'

interface ReaderTopicFieldProps {
  itemId: number
  topic: string | null | undefined
  canEdit: boolean
  onTopicChange?: (topic: string | null) => void
}

export function ReaderTopicField({
  itemId,
  topic,
  canEdit,
  onTopicChange,
}: ReaderTopicFieldProps) {
  const { t } = useI18n()
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [choices, setChoices] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const label = topic
    ? topicDisplayName({ key: topic }, t.brew)
    : t.brew.topicNone

  useEffect(() => {
    if (!open) return
    let live = true
    void listSubscriptionTopics()
      .then((names) => {
        if (live) setChoices(names)
      })
      .catch(() => {
        if (live) setChoices([])
      })
    return () => {
      live = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!canEdit && !topic) return null

  const commit = async (next: string | null) => {
    const name = next === null ? null : normalizeTopicName(next)
    setBusy(true)
    try {
      const saved = await setItemTopic(itemId, name)
      onTopicChange?.(saved)
      setDraft('')
      setOpen(false)
    } catch (error) {
      showToast(userFacingError(error, t.brew.topicSaveFailed), 'error')
    } finally {
      setBusy(false)
    }
  }

  const recommend = async () => {
    setBusy(true)
    try {
      const saved = await suggestItemTopic(itemId)
      onTopicChange?.(saved)
      setDraft('')
      setOpen(false)
    } catch (error) {
      showToast(userFacingError(error, t.brew.topicRecommendFailed), 'error')
    } finally {
      setBusy(false)
    }
  }

  const options = [...choices]
  if (topic && !options.includes(topic)) options.unshift(topic)

  return (
    <div className="brew-reader-topic" ref={rootRef}>
      {canEdit ? (
        <button
          type="button"
          className="brew-reader-topic__chip"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={busy}
          onClick={() => setOpen((current) => !current)}
        >
          <LuTag />
          <span>{label}</span>
        </button>
      ) : (
        <span className="brew-reader-topic__chip is-static">
          <LuTag />
          <span>{label}</span>
        </span>
      )}
      {canEdit && open ? (
        <div className="brew-reader-topic__pop" id={panelId} role="dialog">
          <input
            className="brew-reader-topic__input"
            value={draft}
            disabled={busy}
            placeholder={t.brew.topicInputPlaceholder}
            aria-label={t.brew.topicNone}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const name = normalizeTopicName(draft)
              if (name) void commit(name)
            }}
          />
          {options.length > 0 ? (
            <div className="brew-reader-topic__choices">
              {options.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={
                    name === topic
                      ? 'brew-reader-topic__choice is-current'
                      : 'brew-reader-topic__choice'
                  }
                  disabled={busy}
                  onClick={() => void commit(name)}
                >
                  {topicDisplayName({ key: name }, t.brew)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="brew-reader-topic__actions">
            <button
              type="button"
              className="brew-reader-topic__action"
              disabled={busy}
              onClick={() => void recommend()}
            >
              <LuSparkles />
              {t.brew.topicRecommend}
            </button>
            {topic ? (
              <button
                type="button"
                className="brew-reader-topic__action"
                disabled={busy}
                onClick={() => void commit(null)}
              >
                {t.brew.topicClear}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
