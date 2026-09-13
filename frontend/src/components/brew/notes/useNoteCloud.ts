import type { BrewNoteDoc, BrewNoteDocInput } from '../../../types/brew'

import { useCallback, useRef } from 'react'
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

export function useNoteCloudSave() {
  const busy = useRef(false)

  const save = useCallback(async (docId: number, req: BrewNoteDocInput) => {
    if (busy.current) return null
    busy.current = true
    try {
      return await brewApi.updateNoteDoc(docId, req)
    } finally {
      busy.current = false
    }
  }, [])

  return save
}
