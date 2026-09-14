import type { PhantasiItem, PhantasiSource } from '../../types/phantasi'
import type { OwnItemState } from './logic/ownState'

import { useMemo } from 'react'
import { usePageSeo } from '../../hooks/usePageSeo'
import {
  buildPhantasiItemPageSeo,
  buildPhantasiListPageSeo,
} from '../../utils/phantasiPageSeo'
import { phantasiOwnItemPath } from './constants'

export function usePhantasiSeo(
  selectedItem: PhantasiItem | null,
  source: PhantasiSource | null,
  ownState: OwnItemState,
  moduleOpenToAll: boolean,
  listLabel: string,
  listDescription: string | undefined,
) {
  usePageSeo(
    useMemo(() => {
      if (selectedItem && ownState !== 'unknown') {
        return buildPhantasiItemPageSeo({
          item: selectedItem,
          source,
          moduleOpenToAll,
        })
      }
      if (selectedItem && ownState === 'unknown') {
        return {
          title: undefined,
          path: phantasiOwnItemPath(selectedItem.id),
          noindex: true,
        }
      }
      return buildPhantasiListPageSeo({
        listLabel,
        listDescription,
        moduleOpenToAll,
      })
    }, [
      selectedItem,
      source,
      ownState,
      moduleOpenToAll,
      listLabel,
      listDescription,
    ]),
  )
}
