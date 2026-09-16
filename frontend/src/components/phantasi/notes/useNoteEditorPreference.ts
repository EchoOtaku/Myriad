import type { NoteEditorDefaultView } from '../../../services/phantasiApi'
import { useEffect, useRef, useState } from 'react'
import * as phantasiApi from '../../../services/phantasiApi'

export function useNoteEditorPreference(
  userId: number | null,
  onInitial: (view: NoteEditorDefaultView) => void,
  onError: () => void,
  io: Pick<typeof phantasiApi, 'getNoteEditorPreference' | 'saveNoteEditorPreference'> = phantasiApi,
) {
  const [defaultView, setDefaultView] = useState<NoteEditorDefaultView>('visual')
  const [busy, setBusy] = useState(true)
  const generation = useRef(0)
  const callbacks = useRef({ onInitial, onError })
  callbacks.current = { onInitial, onError }
  useEffect(() => {
    const owner = ++generation.current
    const controller = new AbortController()
    setDefaultView('visual')
    setBusy(true)
    if (userId != null) {
      void io.getNoteEditorPreference(controller.signal).then((view) => {
        if (owner !== generation.current) return
        setDefaultView(view)
        callbacks.current.onInitial(view)
      }).catch(() => {
        if (!controller.signal.aborted) callbacks.current.onError()
      }).finally(() => {
        if (owner === generation.current) setBusy(false)
      })
    } else {
      setBusy(false)
    }
    return () => { generation.current++; controller.abort() }
  }, [userId, io])
  const changeDefaultView = async (view: NoteEditorDefaultView) => {
    if (busy || userId == null) return
    const owner = generation.current
    setBusy(true)
    try {
      await io.saveNoteEditorPreference(view)
      if (owner === generation.current) setDefaultView(view)
    } catch {
      if (owner === generation.current) callbacks.current.onError()
    } finally {
      if (owner === generation.current) setBusy(false)
    }
  }
  return { defaultView, busy, changeDefaultView }
}
