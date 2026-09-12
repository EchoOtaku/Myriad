import { federationApi } from '../../../../services/federationApi'
import {
  areFederationPoliciesEqual,
  DEFAULT_FEDERATION_POLICY,
  federationPolicyFromApi,
  federationPolicyToUpdateRequest,
} from '../../federationPolicy'
import { useConfigDomain } from '../useConfigDomain'

export function useFederationDomain(isAdmin: boolean) {
  return useConfigDomain({
    id: 'federation',
    sections: ['federation'],
    initial: DEFAULT_FEDERATION_POLICY,
    equal: areFederationPoliciesEqual,
    load: async () =>
      isAdmin
        ? federationPolicyFromApi(await federationApi.getTrustPolicy())
        : DEFAULT_FEDERATION_POLICY,
    persist: async (draft) => {
      if (!isAdmin) throw new Error('Administrator required')
      await federationApi.updateTrustPolicy(
        federationPolicyToUpdateRequest(draft),
      )
      return draft
    },
    reset: (_saved, scope) =>
      isAdmin && (scope === 'federation' || scope === 'all')
        ? structuredClone(DEFAULT_FEDERATION_POLICY)
        : undefined,
  })
}
