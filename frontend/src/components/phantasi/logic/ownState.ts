/** 源未解析前禁止据此清掉 /journal/articles/*。 */

import { isOwnPhantasiSource } from '../constants'

export type OwnItemState = 'unknown' | 'own' | 'not-own'

export function ownItemState(
  item: { fromWebSearch?: boolean; source_id: number } | null,
  source: {
    source_type?: string | null
    category?: string | null
    admin_only?: boolean
  } | null,
  sourcesLoaded: boolean,
): OwnItemState {
  if (!item) return 'unknown'
  if (item.fromWebSearch || item.source_id <= 0) return 'not-own'
  if (source) return isOwnPhantasiSource(source) ? 'own' : 'not-own'
  if (!sourcesLoaded) return 'unknown'
  return 'not-own'
}
