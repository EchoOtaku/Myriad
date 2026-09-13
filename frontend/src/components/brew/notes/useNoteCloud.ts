import type { BrewNoteDoc } from '../../../types/brew'

import * as brewApi from '../../../services/brewApi'

export async function openNoteCloudDoc(input: {
  noteId?: number
  docId?: number
  signal?: AbortSignal
}): Promise<BrewNoteDoc> {
  if (input.docId != null) return brewApi.getNoteDoc(input.docId, input.signal)
  if (input.noteId != null) {
    return brewApi.getNoteDocForItem(input.noteId, input.signal)
  }
  return brewApi.createNoteDoc()
}
