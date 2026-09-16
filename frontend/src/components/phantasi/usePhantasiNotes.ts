import type { Dispatch, SetStateAction } from 'react'
import type { PhantasiItem } from '../../types/phantasi'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as phantasiApi from '../../services/phantasiApi'
import { RequestTurn } from './logic/requestTurn'

export function usePhantasiNotes(
  selectedItem: PhantasiItem | null,
  setSelectedItem: Dispatch<SetStateAction<PhantasiItem | null>>,
  list: { reload: () => Promise<void>; removeItem: (id: number) => void },
  reloadBoard: () => void,
  loadSources: () => Promise<void>,
) {
  const { reload, removeItem } = list
  const [noteEditor, setNoteEditor] = useState<
    number | 'new' | { docId: number } | null
  >(null)
  const [docsEpoch, setDocsEpoch] = useState(0)
  const bumpDocs = useCallback(() => setDocsEpoch((value) => value + 1), [])
  const saveTurn = useRef(new RequestTurn())
  useEffect(() => () => saveTurn.current.cancel(), [])

  const onSaved = useCallback(
    async (id: number) => {
      setNoteEditor(null)
      bumpDocs()
      await loadSources()
      if (selectedItem?.id === id) {
        const signal = saveTurn.current.begin()
        try {
          const fresh = await phantasiApi.getItem(id, undefined, { signal })
          if (!signal.aborted) {
            setSelectedItem((current) => (current?.id === id ? fresh : current))
          }
        } catch {
          /* 取不回来就保持原样 */
        }
      }
      void reload()
    },
    [
      selectedItem?.id,
      setSelectedItem,
      reload,
      loadSources,
      bumpDocs,
    ],
  )

  const onDeleted = useCallback(
    (id: number) => {
      setNoteEditor(null)
      bumpDocs()
      removeItem(id)
      if (selectedItem?.id === id) setSelectedItem(null)
      reloadBoard()
    },
    [selectedItem?.id, removeItem, setSelectedItem, reloadBoard, bumpDocs],
  )

  const write = useCallback(() => setNoteEditor('new'), [])
  const edit = useCallback((id: number) => setNoteEditor(id), [])
  const editDoc = useCallback((docId: number) => setNoteEditor({ docId }), [])
  const close = useCallback(() => {
    setNoteEditor(null)
    bumpDocs()
  }, [bumpDocs])

  return {
    noteEditor,
    docsEpoch,
    touchDocs: bumpDocs,
    write,
    edit,
    editDoc,
    close,
    onSaved,
    onDeleted,
  }
}
