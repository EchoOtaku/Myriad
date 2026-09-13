/**
 * 云端草稿保存。
 *
 * 只比「本地」和「服务端已确认」两份快照：不一样才 PUT，一样就不动。
 * revision 走 ref，不进 effect 依赖 —— 保存成功不会再触发下一次保存。
 * 同一时刻只有一个 PUT 在飞；飞的时候又改了，落地后再补一发。
 * 409 就拉最新的一份三路合并，合完立刻再存。
 */

import type { MutableRefObject } from 'react'
import type { BrewNoteDoc } from '../../../types/brew'
import { useCallback, useEffect, useRef } from 'react'
import * as brewApi from '../../../services/brewApi'
import { userFacingError } from '../../../utils/userFacingError'
import { mergeNoteField, mergeNoteText } from './noteMerge'

export const CLOUD_SAVE_DEBOUNCE_MS = 800

export interface NoteCloudFields {
  title: string
  contentMd: string
  topic: string | null
  cover: string | null
  publishedAt: number | null
}

export function sameCloudFields(a: NoteCloudFields, b: NoteCloudFields): boolean {
  return (
    a.title === b.title &&
    a.contentMd === b.contentMd &&
    (a.topic ?? null) === (b.topic ?? null) &&
    (a.cover ?? null) === (b.cover ?? null) &&
    (a.publishedAt ?? null) === (b.publishedAt ?? null)
  )
}

export function cloudFieldsOf(doc: BrewNoteDoc): NoteCloudFields {
  return {
    title: doc.title,
    contentMd: doc.content_md,
    topic: doc.topic ?? null,
    cover: doc.image ?? null,
    publishedAt: doc.published_at ?? null,
  }
}

/** 三路合并整份快照：文字按行，字段按「谁改了听谁的」。发布时间以服务端为准。 */
export function mergeCloudFields(
  base: NoteCloudFields,
  local: NoteCloudFields,
  remote: NoteCloudFields,
): NoteCloudFields {
  return {
    title: mergeNoteText(base.title, local.title, remote.title),
    contentMd: mergeNoteText(base.contentMd, local.contentMd, remote.contentMd),
    topic: mergeNoteField(base.topic, local.topic, remote.topic),
    cover: mergeNoteField(base.cover, local.cover, remote.cover),
    publishedAt: remote.publishedAt,
  }
}

export interface NoteCloudSaveIo {
  updateNoteDoc: typeof brewApi.updateNoteDoc
  getNoteDoc: typeof brewApi.getNoteDoc
}

export interface UseNoteCloudSaveOptions {
  cloudId: number | null
  loading: boolean
  fields: NoteCloudFields
  revisionRef: MutableRefObject<number>
  /** 服务端回了一份文档：更新 status / scheduled_at / last_error 这些。 */
  onServerDoc: (doc: BrewNoteDoc) => void
  /** 冲突合并后的本地内容。 */
  onMerged: (fields: NoteCloudFields) => void
  /** 服务端确认了这一份。 */
  onSaved: (acked: NoteCloudFields) => void
  onError: (message: string | null) => void
  labels: { saveFailed: string; conflict: string }
  io?: NoteCloudSaveIo
}

export interface NoteCloudSaveHandle {
  /** 服务端已经是这份了（打开、远端整篇快照到达）：记为已确认，也作为合并基准。 */
  ack: (fields: NoteCloudFields) => void
  /** 合并基准，给 WS 合并用。 */
  baseRef: MutableRefObject<NoteCloudFields>
}

export function useNoteCloudSave({
  cloudId,
  loading,
  fields,
  revisionRef,
  onServerDoc,
  onMerged,
  onSaved,
  onError,
  labels,
  io = brewApi,
}: UseNoteCloudSaveOptions): NoteCloudSaveHandle {
  const latestRef = useRef(fields)
  latestRef.current = fields
  const ackedRef = useRef<NoteCloudFields>(fields)
  const baseRef = useRef<NoteCloudFields>(fields)
  const inFlightRef = useRef(false)
  const dirtyRef = useRef(false)
  const aliveRef = useRef(true)
  const callbacks = useRef({ onServerDoc, onMerged, onSaved, onError, labels, io })
  callbacks.current = { onServerDoc, onMerged, onSaved, onError, labels, io }

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const ack = useCallback((next: NoteCloudFields) => {
    ackedRef.current = next
    baseRef.current = next
  }, [])

  const flush = useCallback(
    async (id: number) => {
      if (inFlightRef.current) {
        dirtyRef.current = true
        return
      }
      const sending = latestRef.current
      if (sameCloudFields(sending, ackedRef.current)) return
      inFlightRef.current = true
      const { onServerDoc: serverDoc, onMerged: merged, onSaved: saved, onError: failed, labels: text, io: api } =
        callbacks.current
      try {
        const doc = await api.updateNoteDoc(id, {
          title: sending.title,
          content_md: sending.contentMd,
          topic: sending.topic,
          image: sending.cover,
          published_at: sending.publishedAt,
          revision: revisionRef.current,
        })
        if (!aliveRef.current) return
        revisionRef.current = doc.revision
        ackedRef.current = sending
        baseRef.current = sending
        serverDoc(doc)
        if (!doc.last_error) failed(null)
        saved(sending)
      } catch (err) {
        if (!aliveRef.current) return
        const message = userFacingError(err, text.saveFailed)
        if (message !== text.conflict) {
          failed(message)
          return
        }
        try {
          const fresh = await api.getNoteDoc(id)
          if (!aliveRef.current) return
          const remote = cloudFieldsOf(fresh)
          const result = mergeCloudFields(baseRef.current, latestRef.current, remote)
          revisionRef.current = fresh.revision
          ackedRef.current = remote
          baseRef.current = remote
          serverDoc(fresh)
          merged(result)
          latestRef.current = result
          failed(text.conflict)
          const persisted = await api.updateNoteDoc(id, {
            title: result.title,
            content_md: result.contentMd,
            topic: result.topic,
            image: result.cover,
            published_at: result.publishedAt,
            revision: fresh.revision,
          })
          if (!aliveRef.current) return
          revisionRef.current = persisted.revision
          ackedRef.current = result
          baseRef.current = result
          serverDoc(persisted)
          saved(result)
        } catch (mergeErr) {
          if (aliveRef.current) failed(userFacingError(mergeErr, message))
        }
      } finally {
        inFlightRef.current = false
        if (dirtyRef.current && aliveRef.current) {
          dirtyRef.current = false
          if (!sameCloudFields(latestRef.current, ackedRef.current)) void flush(id)
        }
      }
    },
    [revisionRef],
  )

  useEffect(() => {
    if (loading || cloudId == null) return
    if (sameCloudFields(fields, ackedRef.current)) return
    const timer = setTimeout(() => {
      void flush(cloudId)
    }, CLOUD_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // 只看内容字段；revision 变了不该再触发一次保存。
  }, [
    cloudId,
    loading,
    fields.title,
    fields.contentMd,
    fields.topic,
    fields.cover,
    fields.publishedAt,
    flush,
  ])

  return { ack, baseRef }
}
