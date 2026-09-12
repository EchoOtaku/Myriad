import {
  areHitokotoConfigsEqual,
  DEFAULT_HITOKOTO_CONFIG,
  fetchHitokotoConfig,
  updateHitokotoConfig,
} from '../../../../utils/quote'
import { useConfigDomain } from '../useConfigDomain'

export function useHitokotoDomain() {
  return useConfigDomain({
    id: 'hitokoto',
    sections: ['modules'],
    initial: DEFAULT_HITOKOTO_CONFIG,
    equal: areHitokotoConfigsEqual,
    load: () => fetchHitokotoConfig({ force: true }),
    persist: updateHitokotoConfig,
    reset: (_saved, scope) =>
      scope === 'modules' || scope === 'all'
        ? structuredClone(DEFAULT_HITOKOTO_CONFIG)
        : undefined,
  })
}
