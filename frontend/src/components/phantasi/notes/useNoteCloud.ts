import type { PhantasiNoteDoc } from '../../../types/phantasi'

import * as phantasiApi from '../../../services/phantasiApi'

export async function openNoteCloudDoc(input: {
  noteId?: number
  docId?: number
  signal?: AbortSignal
}): Promise<PhantasiNoteDoc> {
  if (input.docId != null) return phantasiApi.getNoteDoc(input.docId, input.signal)
  if (input.noteId != null) {
    return phantasiApi.getNoteDocForItem(input.noteId, input.signal)
  }
  return phantasiApi.createNoteDoc()
}
