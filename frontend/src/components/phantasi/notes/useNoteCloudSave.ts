/**
 * 云端草稿保存。
 *
 * 只比「本地」和「服务端已确认」两份快照：不一样才 PUT，一样就不动。
 * revision 走 ref，不进 effect 依赖 —— 保存成功不会再触发下一次保存。
 * 同一时刻只有一个 PUT 在飞；飞的时候又改了，落地后再补一发。
 * 409 就拉最新的一份三路合并，合完立刻再存。
 */

import type { MutableRefObject } from 'react'
import type { PhantasiNoteDoc } from '../../../types/phantasi'
import { useCallback, useEffect, useRef } from 'react'
import * as phantasiApi from '../../../services/phantasiApi'
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

export function cloudFieldsOf(doc: PhantasiNoteDoc): NoteCloudFields {
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
  updateNoteDoc: typeof phantasiApi.updateNoteDoc
  getNoteDoc: typeof phantasiApi.getNoteDoc
}

export interface UseNoteCloudSaveOptions {
  cloudId: number | null
  loading: boolean
  fields: NoteCloudFields
  revisionRef: MutableRefObject<number>
  /** 服务端回了一份文档：更新 status / scheduled_at / last_error 这些。 */
  onServerDoc: (doc: PhantasiNoteDoc) => void
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
  /** 所有 HTTP / WS / 重连快照走同一条版本与待保存确认路径。 */
  receiveRemote: (fields: NoteCloudFields, revision: number, requestId?: string | null) => boolean
  receiveDoc: (doc: PhantasiNoteDoc, requestId?: string | null) => void
  compositionStart: () => void
  compositionEnd: () => void
  /** 服务端已确认的合并基准。 */
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
  io = phantasiApi,
}: UseNoteCloudSaveOptions): NoteCloudSaveHandle {
  const latestRef = useRef(fields)
  latestRef.current = fields
  const ackedRef = useRef<NoteCloudFields>(fields)
  const baseRef = useRef<NoteCloudFields>(fields)
  const composingRef = useRef(false)
  const compositionEpochRef = useRef(0)
  const compositionQueueRef = useRef(new Map<number, { fields: NoteCloudFields; requestId?: string | null }>())
  const inFlightRef = useRef(false)
  const pendingRef = useRef<{ requestId: string; fields: NoteCloudFields; confirmed: boolean } | null>(null)
  const deferredRef = useRef<{ fields: NoteCloudFields; revision: number; requestId?: string | null } | null>(null)
  const aliveRef = useRef(true)
  const activeIdRef = useRef(cloudId)
  activeIdRef.current = cloudId
  const callbacks = useRef({ onServerDoc, onMerged, onSaved, onError, labels, io })
  callbacks.current = { onServerDoc, onMerged, onSaved, onError, labels, io }

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const ack = useCallback((next: NoteCloudFields) => {
    ackedRef.current = next
    baseRef.current = next
  }, [])

  const receiveRemote = useCallback((remote: NoteCloudFields, revision: number, requestId?: string | null) => {
    if (revision <= revisionRef.current) return false
    if (composingRef.current) {
      compositionQueueRef.current.set(revision, { fields: remote, requestId })
      return false
    }
    // A save receipt already contains the submitted edits. Rebase only typing after
    // that snapshot, regardless of whether the receipt arrives over WS or HTTP.
    const pending = pendingRef.current
    if (pending && !pending.confirmed && requestId !== pending.requestId) {
      // A newer snapshot may already contain our in-flight save. Wait until its
      // outcome establishes the common ancestor; arrival order is not causality.
      if (!deferredRef.current || revision > deferredRef.current.revision) deferredRef.current = { fields: remote, revision, requestId }
      return false
    }
    if (pending && requestId === pending.requestId) pending.confirmed = true
    const base = requestId && pending?.requestId === requestId ? pending.fields : baseRef.current
    const result = mergeCloudFields(base, latestRef.current, remote)
    revisionRef.current = revision
    ack(remote)
    latestRef.current = result
    callbacks.current.onMerged(result)
    callbacks.current.onSaved(remote)
    const deferred = deferredRef.current
    deferredRef.current = null
    if (deferred) receiveRemote(deferred.fields, deferred.revision, deferred.requestId)
    return true
  }, [ack, revisionRef])

  const receiveDoc = useCallback((doc: PhantasiNoteDoc, requestId?: string | null) => {
    receiveRemote(cloudFieldsOf(doc), doc.revision, requestId)
    if (doc.revision === revisionRef.current) callbacks.current.onServerDoc(doc)
  }, [receiveRemote])

  const flush = useCallback(async (id: number) => {
    if (composingRef.current || inFlightRef.current || activeIdRef.current !== id) return
    const sending = latestRef.current
    if (sameCloudFields(sending, ackedRef.current)) return
    inFlightRef.current = true
    let succeeded = false
    const { io: api, labels: text } = callbacks.current
    const current = () => aliveRef.current && activeIdRef.current === id
    try {
      // The second attempt follows a revision conflict using the freshly merged state.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const snapshot = latestRef.current
        const requestId = crypto.randomUUID()
        pendingRef.current = { requestId, fields: snapshot, confirmed: false }
        try {
          const doc = await api.updateNoteDoc(id, {
            title: snapshot.title,
            content_md: snapshot.contentMd,
            topic: snapshot.topic,
            image: snapshot.cover,
            published_at: snapshot.publishedAt,
            revision: revisionRef.current,
            client_request_id: requestId,
          })
          if (!current()) return
          receiveDoc(doc, requestId)
          if (!doc.last_error) callbacks.current.onError(null)
          succeeded = true
          break
        } catch (err) {
          if (!current()) return
          const message = userFacingError(err, text.saveFailed)
          if (message !== text.conflict || attempt === 1) throw err
          // A rejected revision did not persist our snapshot. Buffered remote
          // commits therefore merge against the last confirmed server version.
          pendingRef.current = null
          const deferred = deferredRef.current
          deferredRef.current = null
          if (deferred) receiveRemote(deferred.fields, deferred.revision, deferred.requestId)
          const fresh = await api.getNoteDoc(id)
          if (!current()) return
          receiveDoc(fresh)
        }
      }
    } catch (err) {
      if (current()) callbacks.current.onError(userFacingError(err, text.saveFailed))
    } finally {
      if (!composingRef.current) pendingRef.current = null
      inFlightRef.current = false
      // Do not depend on a render or a debounce firing while HTTP was pending.
      if (succeeded && current() && !sameCloudFields(latestRef.current, ackedRef.current)) void flush(id)
    }
  }, [receiveDoc, receiveRemote, revisionRef])

  const compositionStart = useCallback(() => {
    compositionEpochRef.current += 1
    composingRef.current = true
  }, [])
  const compositionEnd = useCallback(() => {
    const epoch = compositionEpochRef.current
    // Let React publish the composition's final input before rebasing its text.
    setTimeout(() => {
      if (!aliveRef.current || epoch !== compositionEpochRef.current) return
      composingRef.current = false
      const queued = [...compositionQueueRef.current.entries()].sort(([a], [b]) => a - b)
      compositionQueueRef.current.clear()
      for (const [revision, remote] of queued) receiveRemote(remote.fields, revision, remote.requestId)
      if (!inFlightRef.current) pendingRef.current = null
      if (activeIdRef.current != null) void flush(activeIdRef.current)
    }, 0)
  }, [flush, receiveRemote])

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

  return { ack, baseRef, receiveRemote, receiveDoc, compositionStart, compositionEnd }
}
