import type { PhantasiSource } from '../../types/phantasi'

import { useEffect, useMemo, useRef } from 'react'
import * as phantasiApi from '../../services/phantasiApi'
import { phantasiOwnItemPath } from './constants'
import { JOURNAL_ROOT } from './logic/journalRoutes'
import {
  phantasiItemNavigateMode,
  phantasiItemParamId,
  phantasiOpenedItemState,
  restoreAfterFailedOpen,
} from './logic/phantasiItemRoute'
import { ownItemState } from './logic/ownState'
import { useArticleOpen } from './useArticleOpen'

export function usePhantasiItemRoute(
  itemIdParam: string | undefined,
  sources: PhantasiSource[],
  sourcesLoaded: boolean,
  navigate: (
    to: string,
    opts?: { replace?: boolean; state?: { phantasiOpenedItem: number } },
  ) => void,
  setError: (message: string) => void,
  loadFailed: string,
  listPath = JOURNAL_ROOT,
) {
  const session = useArticleOpen(setError, loadFailed)
  const { selectedItem } = session

  const selectedItemSource = useMemo(() => {
    if (!selectedItem) return null
    return (
      sources.find((source) => source.id === selectedItem.source_id) ?? null
    )
  }, [selectedItem, sources])

  const selectedItemOwnState = useMemo(
    () => ownItemState(selectedItem, selectedItemSource, sourcesLoaded),
    [selectedItem, selectedItemSource, sourcesLoaded],
  )

  const previousRoute = useRef(itemIdParam)
  const expectedRoute = useRef<{ id: string | undefined } | null>(null)
  const initial = useRef(true)
  useEffect(() => {
    const changed = initial.current || previousRoute.current !== itemIdParam
    initial.current = false
    previousRoute.current = itemIdParam
    if (changed) {
      if (expectedRoute.current && expectedRoute.current.id === itemIdParam && selectedItem) {
        expectedRoute.current = null
        return
      }
      expectedRoute.current = null
      if (itemIdParam) {
        const id = phantasiItemParamId(itemIdParam)
        const kept =
          selectedItem && selectedItem.id !== id
            ? {
                id: selectedItem.id,
                own: selectedItemOwnState === 'own',
              }
            : null
        if (id == null) {
          setError(loadFailed)
          const restore = restoreAfterFailedOpen(
            itemIdParam,
            itemIdParam,
            undefined,
            kept,
            listPath,
          )
          if (restore) {
            expectedRoute.current = { id: restore.param }
            navigate(restore.path, { replace: true })
          }
        } else if (selectedItem?.id !== id) {
          const requested = itemIdParam
          void session
            .openArticle(
              (signal) => phantasiApi.getItem(id, undefined, { signal }),
              { queue: null },
            )
            .then((item) => {
              const restore = restoreAfterFailedOpen(
                requested,
                previousRoute.current,
                item?.id,
                kept,
                listPath,
              )
              if (!restore) return
              expectedRoute.current = { id: restore.param }
              navigate(restore.path, { replace: true })
            })
        }
      } else {
        session.closeArticle()
      }
      return
    }
    if (!selectedItem || selectedItemOwnState === 'unknown' || session.opening)
      return
    const target =
      selectedItemOwnState === 'own' ? String(selectedItem.id) : undefined
    const mode = phantasiItemNavigateMode(itemIdParam, target)
    if (mode !== 'none') {
      expectedRoute.current = { id: target }
      if (target) {
        navigate(phantasiOwnItemPath(selectedItem.id), {
          replace: mode === 'replace',
          state: phantasiOpenedItemState(selectedItem.id),
        })
      } else {
        navigate(listPath, { replace: true })
      }
    }
  }, [
    itemIdParam,
    selectedItem,
    selectedItemOwnState,
    session.opening,
    session.openArticle,
    session.closeArticle,
    navigate,
    setError,
    loadFailed,
    listPath,
  ])

  return {
    ...session,
    selectedItemSource,
    selectedItemOwnState,
    selectedItemIsOwn: selectedItemOwnState === 'own',
  }
}
