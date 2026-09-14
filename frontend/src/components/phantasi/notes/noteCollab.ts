/** 协同事件。服务端原样广播，revision 冲突由保存接口判。 */

export interface NoteCollabPeer {
  peerId: string
  userId: number
  name?: string | null
  cursor?: number | null
}

export interface NoteCollabEvent {
  type: string
  peer_id: string
  user_id: number
  name?: string | null
  revision?: number | null
  cursor?: number | null
  title?: string | null
  content_md?: string | null
  topic?: string | null
  image?: string | null
}

export function applyCollabPeers(
  peers: NoteCollabPeer[],
  event: NoteCollabEvent,
  selfPeerId?: string,
): NoteCollabPeer[] {
  if (event.peer_id && event.peer_id === selfPeerId) return peers
  if (event.type === 'leave') {
    return peers.filter((peer) => peer.peerId !== event.peer_id)
  }
  if (
    event.type === 'join' ||
    event.type === 'presence' ||
    event.type === 'edit'
  ) {
    const existing = peers.find((peer) => peer.peerId === event.peer_id)
    const next: NoteCollabPeer = {
      peerId: event.peer_id,
      userId: event.user_id,
      name: event.name ?? existing?.name,
      cursor: event.cursor ?? existing?.cursor,
    }
    const without = peers.filter((peer) => peer.peerId !== event.peer_id)
    return [...without, next]
  }
  return peers
}

export function shouldApplyRemoteDoc(
  event: NoteCollabEvent,
  currentRevision: number,
): boolean {
  if (event.type !== 'doc') return false
  const revision = event.revision
  return revision != null && revision > currentRevision
}

export function shouldApplyRemoteEdit(event: NoteCollabEvent): boolean {
  return event.type === 'edit' && event.content_md != null
}
