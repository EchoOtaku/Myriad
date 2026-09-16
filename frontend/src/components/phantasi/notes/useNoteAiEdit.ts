import type { NoteAiDocument, NoteAiRequest, NoteAiSelection } from './noteAiEdit'
import { useEffect, useRef, useState } from 'react'
import { buildNoteAiRequest, sameNoteAiDocument } from './noteAiEdit'

export interface NoteAiResult { content_md: string; html: string }
interface Snapshot { document: NoteAiDocument; selection: NoteAiSelection | null }

export function useNoteAiEdit(host: {
  current: NoteAiDocument
  locale: string
  request: (input: NoteAiRequest, signal: AbortSignal) => Promise<NoteAiResult>
  apply: (value: string) => void
}) {
  const live = useRef(host)
  live.current = host
  const [isOpen, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const [scope, setScope] = useState<'document' | 'selection'>('document')
  const [selectionUnavailable, setSelectionUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<NoteAiResult | null>(null)
  const resultRef = useRef<NoteAiResult | null>(null)
  const [undoSnapshot, setUndoSnapshot] = useState<{ before: NoteAiDocument; after: NoteAiDocument } | null>(null)
  const undoRef = useRef(undoSnapshot)
  const controller = useRef<AbortController | null>(null)

  function cancel() {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
  }
  function clearResult() { resultRef.current = null; setResult(null) }
  function close() {
    cancel()
    setOpen(false)
    clearResult()
  }
  function open(selection: NoteAiSelection | null, unavailable = false) {
    cancel()
    const next = { document: { ...live.current.current }, selection }
    snapshotRef.current = next
    setSnapshot(next)
    setSelectionUnavailable(unavailable)
    setScope(selection || unavailable ? 'selection' : 'document')
    setError(null)
    clearResult()
    setOpen(true)
  }
  useEffect(() => {
    close()
    undoRef.current = null
    setUndoSnapshot(null)
    setSnapshot(null)
    snapshotRef.current = null
    return () => { controller.current?.abort(); controller.current = null }
    // A different document/account invalidates all AI state, including late responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.current.identity])

  const stale = snapshot !== null && !sameNoteAiDocument(snapshot.document, host.current)
  async function generate() {
    const saved = snapshotRef.current
    if (!saved || controller.current || !sameNoteAiDocument(saved.document, live.current.current)) return
    if (scope === 'selection' && (!saved.selection || selectionUnavailable)) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setError(null)
    clearResult()
    try {
      const input = buildNoteAiRequest(saved.document, scope === 'selection' ? saved.selection : null, instruction, live.current.locale)
      const next = await live.current.request(input, active.signal)
      if (controller.current !== active || active.signal.aborted) return
      if (typeof next.content_md !== 'string' || !next.content_md.trim() || typeof next.html !== 'string') {
        throw new Error('note_ai_incomplete')
      }
      resultRef.current = next
      setResult(next)
    } catch (err) {
      if (controller.current === active && !active.signal.aborted) {
        setError(err instanceof Error ? err.message : 'note_ai_failed')
      }
    } finally {
      if (controller.current === active) { controller.current = null; setBusy(false) }
    }
  }
  function applyResult() {
    const saved = snapshotRef.current
    const next = resultRef.current
    if (!saved || !next || !sameNoteAiDocument(saved.document, live.current.current)) return
    clearResult()
    const undo = { before: saved.document, after: { ...saved.document, contentMd: next.content_md } }
    undoRef.current = undo
    setUndoSnapshot(undo)
    live.current.apply(next.content_md)
    setOpen(false)
  }
  function undo() {
    const saved = undoRef.current
    if (!saved || !sameNoteAiDocument(saved.after, live.current.current)) return
    undoRef.current = null
    setUndoSnapshot(null)
    live.current.apply(saved.before.contentMd)
  }
  function changeScope(value: 'document' | 'selection') {
    cancel()
    clearResult()
    setScope(value)
  }
  return {
    isOpen, open, close, cancel, busy, error, result, snapshot, stale, scope,
    setScope: changeScope, instruction, setInstruction, selectionUnavailable,
    generate, applyResult, undo,
    canUndo: undoSnapshot !== null && sameNoteAiDocument(undoSnapshot.after, host.current),
  }
}
