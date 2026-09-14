import { useSyncExternalStore } from 'react'
import { phantasiItemState } from '../../utils/phantasiItemState'

export function useArticleFlags() {
  useSyncExternalStore(
    phantasiItemState.subscribe,
    phantasiItemState.getSnapshot,
    phantasiItemState.getSnapshot,
  )
  return phantasiItemState
}
