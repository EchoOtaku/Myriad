import type { MutableRefObject } from 'react'
import type { NoteCollabEvent, NoteCollabPeer } from './noteCollab'
import type { NoteCloudFields } from './useNoteCloudSave'
import { useEffect, useRef, useState } from 'react'
import * as phantasiApi from '../../../services/phantasiApi'
import {
  applyCollabPeers,
  shouldApplyRemoteDoc,
  shouldApplyRemoteEdit,
} from './noteCollab'
import { mergeCloudFields } from './useNoteCloudSave'

export function useNoteCollab({
  cloudId,
  loading,
  userName,
  revisionRef,
  titleRef,
  contentMdRef,
  topicRef,
  coverRef,
  publishedAtRef,
  textareaRef,
  baseRef,
  title,
  topic,
  cover,
  applyMergedFields,
  ackRemote,
}: {
  cloudId: number | null
  loading: boolean
  userName?: string
  revisionRef: MutableRefObject<number>
  titleRef: MutableRefObject<string>
  contentMdRef: MutableRefObject<string>
  topicRef: MutableRefObject<string | null>
  coverRef: MutableRefObject<string | null>
  publishedAtRef: MutableRefObject<number | null>
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  baseRef: MutableRefObject<NoteCloudFields>
  title: string
  topic: string | null
  cover: string | null
  applyMergedFields: (fields: NoteCloudFields) => void
  ackRemote: (fields: NoteCloudFields) => void
}): { peers: NoteCollabPeer[] } {
  const [peers, setPeers] = useState<NoteCollabPeer[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const liveRef = useRef({ applyMergedFields, ackRemote })
  liveRef.current = { applyMergedFields, ackRemote }

  useEffect(() => {
    if (cloudId == null) return
    const ws = new WebSocket(phantasiApi.noteDocWsUrl(cloudId))
    wsRef.current = ws
    ws.onmessage = (event) => {
      try {
        const incoming = JSON.parse(String(event.data)) as NoteCollabEvent
        setPeers((current) => applyCollabPeers(current, incoming))
        const persist = shouldApplyRemoteDoc(incoming, revisionRef.current)
        const live = shouldApplyRemoteEdit(incoming)
        if (persist || live) {
          const local: NoteCloudFields = {
            title: titleRef.current,
            contentMd: contentMdRef.current,
            topic: topicRef.current,
            cover: coverRef.current,
            publishedAt: publishedAtRef.current,
          }
          const remote: NoteCloudFields = {
            title: incoming.title ?? local.title,
            contentMd: incoming.content_md ?? local.contentMd,
            topic: incoming.topic ?? local.topic,
            cover: incoming.image ?? local.cover,
            publishedAt: local.publishedAt,
          }
          const merged = mergeCloudFields(baseRef.current, local, remote)
          if (persist && incoming.revision != null) {
            revisionRef.current = incoming.revision
            liveRef.current.ackRemote(remote)
          }
          liveRef.current.applyMergedFields(merged)
        }
      } catch {
        /* 坏帧丢掉 */
      }
    }
    const ping = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(
        JSON.stringify({
          type: 'presence',
          name: userName,
          cursor: textareaRef.current?.selectionStart ?? 0,
        }),
      )
    }, 4000)
    return () => {
      window.clearInterval(ping)
      wsRef.current = null
      ws.close()
      setPeers([])
    }
  }, [cloudId, userName])

  useEffect(() => {
    if (loading || cloudId == null) return
    const timer = window.setTimeout(() => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(
        JSON.stringify({
          type: 'edit',
          name: userName,
          cursor: textareaRef.current?.selectionStart ?? 0,
          title,
          topic,
          image: cover,
        }),
      )
    }, 200)
    return () => window.clearTimeout(timer)
  }, [cloudId, cover, loading, textareaRef, title, topic, userName])

  return { peers }
}
