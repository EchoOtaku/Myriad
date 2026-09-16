import type { NoteCloudSaveHandle } from './useNoteCloudSave'
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
  writeCloudDoc,
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
  writeCloudDoc: NoteCloudSaveHandle['writeDoc']
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
        let publishedId: number | undefined
        await writeCloudDoc(async (fields, revision, requestId) => {
          const latestBody = pruneOrphanFootnotes(expandJammedDefinitions(fields.contentMd))
          const latest = toNoteWritePayload(fields.title, latestBody, fields.topic, fields.cover, fields.publishedAt)
          const result = await phantasiApi.publishNoteDoc(cloudId, {
            ...latest,
            image: latest.image ?? null,
            revision,
            client_request_id: requestId,
          })
          publishedId = result.id
          return result.doc
        })
        clearNoteDraft(draftKey)
        clearNoteDraft('new')
        if (publishedId !== undefined) onSaved(publishedId)
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
    writeCloudDoc,
    cloudId,
    contentMd,
    cover,
    draftKey,
    fieldMessage,
    labels.saveFailed,
    noteId,
    onSaved,
    publishedAt,
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
      await writeCloudDoc((fields, revision, requestId) => phantasiApi.scheduleNoteDoc(cloudId, {
        title: fields.title,
        content_md: fields.contentMd,
        topic: fields.topic,
        image: fields.cover,
        scheduled_at: when,
        revision,
        client_request_id: requestId,
      }))
    } catch (err) {
      showNoteNotice(userFacingError(err, labels.saveFailed))
    } finally {
      setSaving(false)
    }
  }, [
    writeCloudDoc,
    cloudId,
    contentMd,
    cover,
    fieldMessage,
    labels.saveFailed,
    labels.scheduleNeedTime,
    labels.schedulePast,
    saving,
    scheduledAt,
    setSaving,
    title,
    topic,
  ])

  const handleUnschedule = useCallback(async () => {
    if (cloudId == null || saving) return
    setSaving(true)
    try {
      await writeCloudDoc((fields, revision, requestId) => phantasiApi.unscheduleNoteDoc(cloudId, {
        title: fields.title,
        content_md: fields.contentMd,
        topic: fields.topic,
        image: fields.cover,
        published_at: fields.publishedAt,
        revision,
        client_request_id: requestId,
      }))
    } catch (err) {
      showNoteNotice(userFacingError(err, labels.saveFailed))
    } finally {
      setSaving(false)
    }
  }, [writeCloudDoc, cloudId, labels.saveFailed, saving, setSaving])

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
