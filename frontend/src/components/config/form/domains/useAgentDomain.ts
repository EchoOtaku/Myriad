import { fetchConfig, updateConfig } from '../../../../lib/api'
import { getCSRFToken } from '../../../../utils/csrf'
import { sanitizeMaskedFieldValue } from '../../platformConfigRules'
import { configBagEffects } from '../configBagEffects'
import {
  EMPTY_AGENT_SETTINGS_SLICE,
  agentSliceAsConfig,
  agentSlicePersistPayload,
  pickAgentSlice,
  resetAgentSlice,
  type AgentSettingsSlice,
} from '../agentBagSlice'
import { useConfigDomain } from '../useConfigDomain'

export function useAgentDomain(messages: {
  configEmpty: string
  configSaveFailed: string
}) {
  const domain = useConfigDomain<AgentSettingsSlice>({
    id: 'agent',
    sections: ['agent'],
    initial: EMPTY_AGENT_SETTINGS_SLICE,
    readBack: true,
    load: async () => pickAgentSlice(await fetchConfig()),
    persist: async (draft) => {
      if (!draft.aiFields.length && !draft.uiFields.length) {
        throw new Error(messages.configEmpty)
      }
      await getCSRFToken(true)
      const result = await updateConfig(agentSlicePersistPayload(draft))
      if (result?.success === false) {
        throw new Error(result.message || messages.configSaveFailed)
      }
      return draft
    },
    reset: (saved, scope) =>
      scope === 'agent' || scope === 'all' ? resetAgentSlice(saved) : undefined,
    effects: (saved, previous) =>
      configBagEffects(agentSliceAsConfig(saved), agentSliceAsConfig(previous)),
  })

  const patchField = (
    group: 'aiFields' | 'uiFields',
    key: string,
    value: string,
  ) => {
    domain.setDraft((current) => ({
      ...current,
      [group]: current[group].map((field) =>
        field.key === key
          ? { ...field, value: sanitizeMaskedFieldValue(value) }
          : field,
      ),
    }))
  }

  return {
    ...domain,
    updateAiFieldValue: (key: string, value: string) =>
      patchField('aiFields', key, value),
    updateUiFieldValue: (key: string, value: string) =>
      patchField('uiFields', key, value),
  }
}
