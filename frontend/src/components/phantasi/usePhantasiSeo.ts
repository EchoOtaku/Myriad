import type { PhantasiItem, PhantasiSource } from '../../types/phantasi'
import type { PhantasiViewMode } from './logic/board'
import type { OwnItemState } from './logic/ownState'

import { useMemo } from 'react'
import { usePageSeo } from '../../hooks/usePageSeo'
import {
  buildPhantasiItemPageSeo,
  buildPhantasiListPageSeo,
} from '../../utils/phantasiPageSeo'
import { journalItemPath } from './logic/journalRoutes'

export function usePhantasiSeo(
  selectedItem: PhantasiItem | null,
  source: PhantasiSource | null,
  ownState: OwnItemState,
  moduleOpenToAll: boolean,
  listLabel: string,
  listDescription: string | undefined,
  listPath: string,
  viewMode: PhantasiViewMode,
) {
  usePageSeo(
    useMemo(() => {
      if (selectedItem && ownState !== 'unknown') {
        return buildPhantasiItemPageSeo({
          item: selectedItem,
          source,
          moduleOpenToAll,
          listPath,
        })
      }
      if (selectedItem && ownState === 'unknown') {
        return {
          title: undefined,
          path: journalItemPath(selectedItem.id),
          noindex: true,
        }
      }
      return buildPhantasiListPageSeo({
        listLabel,
        listDescription,
        path: listPath,
        moduleOpenToAll,
        viewMode,
      })
    }, [
      selectedItem,
      source,
      ownState,
      moduleOpenToAll,
      listLabel,
      listDescription,
      listPath,
      viewMode,
    ]),
  )
}
