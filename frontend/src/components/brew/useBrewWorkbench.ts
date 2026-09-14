import type { MediaAsset } from '../../services/mediaApi'
import type { BrewNoteDoc } from '../../types/brew'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as brewApi from '../../services/brewApi'
import * as mediaApi from '../../services/mediaApi'
import { userFacingError } from '../../utils/userFacingError'
import { RequestTurn } from './logic/requestTurn'

export function useBrewWorkbench(
  enabled: boolean,
  docsEpoch: number,
  labels: {
    loadFailed: string
    noteDeleteFailed: string
    unscheduleFailed: string
    mediaLoadFailed: string
    mediaUploadFailed: string
    mediaDeleteFailed: string
  },
  setError: (message: string) => void,
) {
  const [docs, setDocs] = useState<BrewNoteDoc[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [mediaLoading, setMediaLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const notesTurn = useRef(new RequestTurn())
  const mediaTurn = useRef(new RequestTurn())
  const labelsRef = useRef(labels)
  labelsRef.current = labels

  const loadNotes = useCallback(async () => {
    if (!enabled) {
      setDocs([])
      setNotesLoading(false)
      return
    }
    const signal = notesTurn.current.begin()
    setNotesLoading(true)
    try {
      const next = await brewApi.listNoteDocs(signal)
      if (!signal.aborted) setDocs(next)
    } catch (err) {
      if (signal.aborted) return
      setError(userFacingError(err, labelsRef.current.loadFailed))
      setDocs([])
    } finally {
      if (!signal.aborted) setNotesLoading(false)
    }
  }, [enabled, setError])

  const loadMedia = useCallback(async () => {
    if (!enabled) {
      setMedia([])
      setMediaLoading(false)
      return
    }
    const signal = mediaTurn.current.begin()
    setMediaLoading(true)
    try {
      const next = await mediaApi.listMedia(signal)
      if (!signal.aborted) setMedia(next)
    } catch (err) {
      if (signal.aborted) return
      setError(userFacingError(err, labelsRef.current.mediaLoadFailed))
      setMedia([])
    } finally {
      if (!signal.aborted) setMediaLoading(false)
    }
  }, [enabled, setError])

  useEffect(() => {
    void loadNotes()
    return () => notesTurn.current.cancel()
  }, [docsEpoch, loadNotes])

  useEffect(() => {
    void loadMedia()
    return () => mediaTurn.current.cancel()
  }, [docsEpoch, loadMedia])

  const removeNotes = useCallback(
    async (docs: BrewNoteDoc[]) => {
      if (docs.length === 0) return
      setBusy(true)
      try {
        const results = await Promise.allSettled(
          docs.map(async (doc) => {
            if (doc.item_id != null) await brewApi.deleteNote(doc.item_id)
            else await brewApi.deleteNoteDoc(doc.id)
            return doc.id
          }),
        )
        const dropped = new Set(
          results.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : [],
          ),
        )
        if (dropped.size > 0) {
          setDocs((prev) => prev.filter((row) => !dropped.has(row.id)))
        }
        if (results.some((result) => result.status === 'rejected')) {
          const failed = results.find((result) => result.status === 'rejected')
          setError(
            userFacingError(
              failed && failed.status === 'rejected' ? failed.reason : null,
              labelsRef.current.noteDeleteFailed,
            ),
          )
        }
      } finally {
        setBusy(false)
      }
    },
    [setError],
  )

  const removeNote = useCallback(
    async (doc: BrewNoteDoc) => removeNotes([doc]),
    [removeNotes],
  )

  const unschedule = useCallback(
    async (id: number) => {
      setBusy(true)
      try {
        const next = await brewApi.unscheduleNoteDoc(id)
        setDocs((prev) => prev.map((row) => (row.id === id ? next : row)))
      } catch (err) {
        setError(userFacingError(err, labelsRef.current.unscheduleFailed))
      } finally {
        setBusy(false)
      }
    },
    [setError],
  )

  const upload = useCallback(
    async (file: File) => {
      setBusy(true)
      try {
        const item = await mediaApi.uploadMedia(file)
        setMedia((prev) => [item, ...prev.filter((row) => row.id !== item.id)])
      } catch (err) {
        setError(userFacingError(err, labelsRef.current.mediaUploadFailed))
      } finally {
        setBusy(false)
      }
    },
    [setError],
  )

  const removeMedia = useCallback(
    async (id: number) => {
      setBusy(true)
      try {
        await mediaApi.deleteMedia(id)
        setMedia((prev) => prev.filter((row) => row.id !== id))
      } catch (err) {
        setError(userFacingError(err, labelsRef.current.mediaDeleteFailed))
      } finally {
        setBusy(false)
      }
    },
    [setError],
  )

  return {
    docs,
    media,
    notesLoading,
    mediaLoading,
    busy,
    removeNote,
    removeNotes,
    unschedule,
    upload,
    removeMedia,
    reloadNotes: loadNotes,
    reloadMedia: loadMedia,
  }
}
