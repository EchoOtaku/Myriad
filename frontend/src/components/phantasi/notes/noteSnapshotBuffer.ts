import type { PhantasiNoteDoc } from '../../../types/phantasi'
import type { NoteCloudFields } from './noteCloudFields'

export interface NoteRemoteSnapshot {
  fields: NoteCloudFields
  revision: number
  requestId?: string | null
  doc?: PhantasiNoteDoc
}

/** HTTP metadata and WS identity describe the same committed revision. */
export function mergeNoteSnapshot(previous: NoteRemoteSnapshot | null | undefined, next: NoteRemoteSnapshot): NoteRemoteSnapshot {
  if (!previous || previous.revision !== next.revision) return next
  const doc = next.doc ?? previous.doc
  return {
    ...next,
    requestId: next.requestId ?? previous.requestId,
    ...(doc ? { doc } : {}),
  }
}

/**
 * Whole-document snapshots need only the newest version and our own write's
 * receipt to establish its merge ancestor. Retention is bounded during IME.
 */
export class NoteSnapshotBuffer {
  private snapshots = new Map<number, NoteRemoteSnapshot>()

  get size(): number { return this.snapshots.size }

  push(snapshot: NoteRemoteSnapshot, ownRequestId?: string): void {
    this.snapshots.set(snapshot.revision, mergeNoteSnapshot(this.snapshots.get(snapshot.revision), snapshot))
    const revisions = [...this.snapshots.keys()]
    const newest = Math.max(...revisions)
    const own = ownRequestId ? Math.max(...[...this.snapshots.values()]
      .filter(value => value.requestId === ownRequestId).map(value => value.revision)) : -1
    for (const revision of revisions) {
      if (revision !== newest && revision !== own) this.snapshots.delete(revision)
    }
  }

  drain(): NoteRemoteSnapshot[] {
    const snapshots = [...this.snapshots.values()].sort((a, b) => a.revision - b.revision)
    this.snapshots.clear()
    return snapshots
  }
}
