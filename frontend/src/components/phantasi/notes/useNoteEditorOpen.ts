import { useEffect } from 'react'
import { userFacingError } from '../../../utils/userFacingError'
import { showNoteNotice } from '../phantasiNotice'
import {
  clearNoteDraft,
  draftDiffersFrom,
  readNoteDraft,
} from './noteDraft'
import { normalizeNoteCover, normalizeNoteTopic } from './noteFields'
import { expandJammedDefinitions } from './noteVisual'
import { openNoteCloudDoc } from './useNoteCloud'
import type { NoteCloudFields } from './useNoteCloudSave'
import type { PhantasiNoteDoc } from '../../../types/phantasi'

export function useNoteEditorOpen({
  noteId,
  docId,
  cloudAck,
  applyServerDoc,
  applyMergedFields,
  setCloudId,
  setSaved,
  setLoading,
  loadFailed,
  scheduleFailed,
}: {
  noteId?: number
  docId?: number
  cloudAck: (server: NoteCloudFields) => void
  applyServerDoc: (doc: PhantasiNoteDoc) => void
  applyMergedFields: (next: NoteCloudFields) => void
  setCloudId: (id: number) => void
  setSaved: (next: NoteCloudFields) => void
  setLoading: (loading: boolean) => void
  loadFailed: string
  scheduleFailed: string
}): void {
  useEffect(() => {
    const controller = new AbortController()
    const run = async () => {
      try {
        const doc = await openNoteCloudDoc({
          noteId,
          docId,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const server: NoteCloudFields = {
          title: doc.title,
          contentMd: doc.content_md,
          topic: normalizeNoteTopic(doc.topic),
          cover: normalizeNoteCover(doc.image),
          publishedAt: doc.published_at ?? Date.now(),
        }
        const draft = readNoteDraft(noteId ?? docId ?? 'new') ?? readNoteDraft(noteId ?? doc.id)
        if (noteId === undefined && docId === undefined) clearNoteDraft('new')
        const useDraft = draftDiffersFrom(draft, server)
        const next: NoteCloudFields = {
          title: useDraft && draft ? draft.title : server.title,
          contentMd: expandJammedDefinitions(
            useDraft && draft ? draft.contentMd : server.contentMd,
          ),
          topic:
            useDraft && draft && draft.topic !== undefined
              ? draft.topic
              : server.topic,
          cover:
            useDraft && draft && draft.cover !== undefined
              ? draft.cover
              : server.cover,
          publishedAt:
            useDraft && draft && draft.publishedAt != null
              ? draft.publishedAt
              : server.publishedAt,
        }
        cloudAck(server)
        applyServerDoc(doc)
        setCloudId(doc.id)
        applyMergedFields(next)
        setSaved(next)
        if (doc.last_error) {
          showNoteNotice(userFacingError(doc.last_error, scheduleFailed))
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          showNoteNotice(userFacingError(err, loadFailed))
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void run()
    return () => {
      controller.abort()
    }
  }, [noteId, docId])
}
