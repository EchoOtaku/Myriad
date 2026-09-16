import type { NoteEditorDefaultView, NoteHistoryEntry } from '../../../services/phantasiApi'
import { useEffect, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { getNoteHistory } from '../../../services/phantasiApi'
import { NoteButton, NoteSection, NoteSelect } from './NoteControls'

export function NoteEditorSettings({ cloudId, defaultView, preferenceBusy, onDefaultView, onRestore, busy }: {
  cloudId: number | null
  defaultView: NoteEditorDefaultView
  preferenceBusy: boolean
  onDefaultView: (view: NoteEditorDefaultView) => Promise<void>
  onRestore: (entry: NoteHistoryEntry) => Promise<void>
  busy: boolean
}) {
  const { t, locale, format } = useI18n()
  const [history, setHistory] = useState<NoteHistoryEntry[]>([])
  const [selected, setSelected] = useState<NoteHistoryEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [restoring, setRestoring] = useState(false)
  useEffect(() => {
    if (cloudId == null) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    void getNoteHistory(cloudId, controller.signal).then((rows) => {
      if (!controller.signal.aborted) setHistory(rows)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [cloudId, refresh])
  const restore = async () => {
    if (!selected || restoring || busy) return
    setRestoring(true)
    setError(false)
    try {
      await onRestore(selected)
      setSelected(null)
      setRefresh((value) => value + 1)
    } catch { setError(true) }
    finally { setRestoring(false) }
  }
  return (
    <>
      <NoteSection title={t.phantasi.noteDefaultView} hint={t.phantasi.noteDefaultViewHint}>
        <NoteSelect
          id="note-default-view"
          aria-label={t.phantasi.noteDefaultView}
          value={defaultView}
          disabled={preferenceBusy}
          options={[
            { value: 'visual', label: t.phantasi.noteTabVisual },
            { value: 'write', label: t.phantasi.noteTabWrite },
            { value: 'preview', label: t.phantasi.noteTabPreview },
          ]}
          onChange={(value) => { void onDefaultView(value as NoteEditorDefaultView) }}
        />
      </NoteSection>
      <NoteSection title={t.phantasi.noteHistory} hint={t.phantasi.noteHistoryHint}>
        <NoteButton onClick={() => setRefresh((value) => value + 1)} disabled={loading || restoring}>
          {t.phantasi.noteHistoryRefresh}
        </NoteButton>
        {loading ? <p role="status">{t.phantasi.noteHistoryLoading}</p> : null}
        {error ? <p role="alert">{t.phantasi.noteHistoryFailed}</p> : null}
        {!loading && !error && history.length === 0 ? <p>{t.phantasi.noteHistoryEmpty}</p> : null}
        <ul className="phantasi-note__history-list">
          {history.map((entry) => (
            <li key={entry.revision}>
              <button type="button" className="phantasi-note__history-entry" aria-pressed={selected?.revision === entry.revision} onClick={() => setSelected(entry)} disabled={restoring}>
                <strong>{entry.snapshot.title || t.phantasi.noteHistoryUntitled}</strong>
                <span>{new Date(entry.saved_at).toLocaleString(locale)}</span>
                <span>{entry.actor_name || t.phantasi.noteHistoryUnknown} · {format(t.phantasi.noteHistoryVersion, { revision: entry.revision })}</span>
              </button>
            </li>
          ))}
        </ul>
        {selected ? (
          <div className="phantasi-note__history-preview">
            <h3>{selected.snapshot.title || t.phantasi.noteHistoryUntitled}</h3>
            {selected.snapshot.topic ? <p>{selected.snapshot.topic}</p> : null}
            <pre>{selected.snapshot.content_md}</pre>
            <p>{t.phantasi.noteHistoryRestoreHint}</p>
            <NoteButton variant="solid" onClick={() => { void restore() }} disabled={busy || restoring}>
              {restoring ? t.phantasi.noteHistoryRestoring : t.phantasi.noteHistoryRestore}
            </NoteButton>
          </div>
        ) : null}
      </NoteSection>
    </>
  )
}
