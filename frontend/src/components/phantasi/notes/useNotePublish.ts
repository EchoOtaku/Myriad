import type { MutableRefObject } from 'react'
import type { PhantasiNoteDoc } from '../../../types/phantasi'
import type { NoteCloudFields } from './useNoteCloudSave'
import { useCallback } from 'react'
import * as phantasiApi from '../../../services/phantasiApi'
import { userFacingError } from '../../../utils/userFacingError'
import { showNoteNotice } from '../phantasiNotice'
import {
  clearNoteDraft,
  pruneOrphanFootnotes,
} from './noteDraft'
import {
  countNoteChars,
  MAX_NOTE_BODY_CHARS,
  MAX_NOTE_TITLE_CHARS,
  noteFieldError,
  noteScheduleError,
  toNoteWritePayload,
} from './noteFields'
import { expandJammedDefinitions } from './noteVisual'
import { cloudFieldsOf } from './useNoteCloudSave'

export function useNotePublish({
  title,
  contentMd,
  topic,
  cover,
  publishedAt,
  scheduledAt,
  noteId,
  cloudId,
  draftKey,
  docStatus,
  saving,
  setSaving,
  setContentMd,
  setPublishedAt,
  revisionRef,
  applyServerDoc,
  ackCloud,
  onSaved,
  onDeleted,
  onClose,
  format,
  labels,
}: {
  title: string
  contentMd: string
  topic: string | null
  cover: string | null
  publishedAt: number | null
  scheduledAt: number | null
  noteId?: number
  cloudId: number | null
  draftKey: number | 'new'
  docStatus: 'draft' | 'scheduled' | 'published'
  saving: boolean
  setSaving: (value: boolean) => void
  setContentMd: (value: string) => void
  setPublishedAt: (value: number | null) => void
  revisionRef: MutableRefObject<number>
  applyServerDoc: (doc: PhantasiNoteDoc) => void
  ackCloud: (fields: NoteCloudFields) => void
  onSaved: (id: number) => void
  onDeleted?: (id: number) => void
  onClose: () => void
  format: (template: string, values: Record<string, string | number>) => string
  labels: {
    titleRequired: string
    titleTooLong: string
    bodyTooLong: string
    saveFailed: string
    scheduleNeedTime: string
    schedulePast: string
    deleteConfirm: string
    deleteFailed: string
    discardConfirm: string
  }
}): {
  fieldMessage: (kind: ReturnType<typeof noteFieldError>) => string | null
  handleSave: () => Promise<void>
  handleSchedule: () => Promise<void>
  handleUnschedule: () => Promise<void>
  handleDelete: () => Promise<void>
  requestClose: (dirty: boolean) => Promise<void>
} {
  const fieldMessage = useCallback(
    (kind: ReturnType<typeof noteFieldError>) => {
      if (kind === 'empty-title') return labels.titleRequired
      if (kind === 'title-too-long') {
        return format(labels.titleTooLong, {
          max: MAX_NOTE_TITLE_CHARS,
          chars: countNoteChars(title.trim()),
        })
      }
      if (kind === 'body-too-long') {
        return format(labels.bodyTooLong, {
          max: MAX_NOTE_BODY_CHARS,
          chars: countNoteChars(contentMd),
        })
      }
      return null
    },
    [contentMd, format, labels.bodyTooLong, labels.titleRequired, labels.titleTooLong, title],
  )

  const handleSave = useCallback(async () => {
    if (saving) return
    const invalid = noteFieldError(title, contentMd)
    if (invalid) {
      showNoteNotice(fieldMessage(invalid))
      return
    }
    setSaving(true)
    const body = pruneOrphanFootnotes(expandJammedDefinitions(contentMd))
    if (body !== contentMd) setContentMd(body)
    const payload = toNoteWritePayload(title, body, topic, cover, publishedAt)
    try {
      if (cloudId != null) {
        const result = await phantasiApi.publishNoteDoc(cloudId, {
          title: payload.title,
          content_md: payload.content_md,
          topic: payload.topic,
          image: payload.image ?? null,
          published_at: payload.published_at,
          revision: revisionRef.current,
        })
        clearNoteDraft(draftKey)
        clearNoteDraft('new')
        onSaved(result.id)
        return
      }
      const result =
        noteId === undefined
          ? await phantasiApi.createNote(payload)
          : await phantasiApi.updateNote(noteId, payload)
      clearNoteDraft(draftKey)
      if (noteId === undefined) clearNoteDraft('new')
      onSaved(result.id)
    } catch (err) {
      showNoteNotice(userFacingError(err, labels.saveFailed))
    } finally {
      setSaving(false)
    }
  }, [
    cloudId,
    contentMd,
    cover,
    draftKey,
    fieldMessage,
    labels.saveFailed,
    noteId,
    onSaved,
    publishedAt,
    revisionRef,
    saving,
    setContentMd,
    setSaving,
    title,
    topic,
  ])

  const handleSchedule = useCallback(async () => {
    if (cloudId == null || saving) return
    const invalid = noteFieldError(title, contentMd)
    if (invalid) {
      showNoteNotice(fieldMessage(invalid))
      return
    }
    const timeError = noteScheduleError(scheduledAt)
    if (timeError === 'missing-time') {
      showNoteNotice(labels.scheduleNeedTime)
      return
    }
    if (timeError === 'already-due') {
      showNoteNotice(labels.schedulePast)
      return
    }
    const when = scheduledAt
    if (when == null) return
    setSaving(true)
    try {
      const doc = await phantasiApi.scheduleNoteDoc(cloudId, {
        title,
        content_md: contentMd,
        topic,
        image: cover,
        scheduled_at: when,
        revision: revisionRef.current,
      })
      applyServerDoc(doc)
      ackCloud(cloudFieldsOf(doc))
      setPublishedAt(doc.published_at)
    } catch (err) {
      showNoteNotice(userFacingError(err, labels.saveFailed))
    } finally {
      setSaving(false)
    }
  }, [
    ackCloud,
    applyServerDoc,
    cloudId,
    contentMd,
    cover,
    fieldMessage,
    labels.saveFailed,
    labels.scheduleNeedTime,
    labels.schedulePast,
    revisionRef,
    saving,
    scheduledAt,
    setPublishedAt,
    setSaving,
    title,
    topic,
  ])

  const handleUnschedule = useCallback(async () => {
    if (cloudId == null || saving) return
    setSaving(true)
    try {
      const doc = await phantasiApi.unscheduleNoteDoc(cloudId, {
        revision: revisionRef.current,
      })
      applyServerDoc(doc)
    } catch (err) {
      showNoteNotice(userFacingError(err, labels.saveFailed))
    } finally {
      setSaving(false)
    }
  }, [applyServerDoc, cloudId, labels.saveFailed, revisionRef, saving, setSaving])

  const handleDelete = useCallback(async () => {
    if (saving) return
    if (!window.confirm(labels.deleteConfirm)) return
    setSaving(true)
    try {
      if (noteId !== undefined) {
        await phantasiApi.deleteNote(noteId)
        clearNoteDraft(noteId)
        onDeleted?.(noteId)
        return
      }
      if (cloudId != null && docStatus !== 'published') {
        await phantasiApi.deleteNoteDoc(cloudId)
        clearNoteDraft('new')
        onClose()
      }
    } catch (err) {
      showNoteNotice(userFacingError(err, labels.deleteFailed))
      setSaving(false)
    }
  }, [
    cloudId,
    docStatus,
    labels.deleteConfirm,
    labels.deleteFailed,
    noteId,
    onClose,
    onDeleted,
    saving,
    setSaving,
  ])

  const requestClose = useCallback(
    async (dirty: boolean) => {
      if (dirty) {
        if (!window.confirm(labels.discardConfirm)) return
        clearNoteDraft(draftKey)
        clearNoteDraft('new')
      }
      if (
        cloudId != null &&
        noteId === undefined &&
        docStatus === 'draft' &&
        !title.trim() &&
        !contentMd.trim()
      ) {
        try {
          await phantasiApi.deleteNoteDoc(cloudId)
        } catch (err) {
          showNoteNotice(userFacingError(err, labels.deleteFailed))
          return
        }
        clearNoteDraft(draftKey)
        clearNoteDraft('new')
      }
      onClose()
    },
    [
      cloudId,
      contentMd,
      docStatus,
      draftKey,
      labels.deleteFailed,
      labels.discardConfirm,
      noteId,
      onClose,
      title,
    ],
  )

  return {
    fieldMessage,
    handleSave,
    handleSchedule,
    handleUnschedule,
    handleDelete,
    requestClose,
  }
}
