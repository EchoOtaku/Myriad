import type { Config } from './types'
import {
  ADVANCED_RESET_KEYS,
  AGENT_UI_RESET_KEYS,
  ALL_OWNED_UI_BAG_KEYS,
  MODULE_UI_RESET_KEYS,
  PLATFORMS_UI_RESET_KEYS,
  UI_RESET_KEYS,
} from '../uiBagOwnership'
import {
  AGENT_AI_FIELD_KEYS,
  defaultAiFieldValue,
  defaultTripoFieldValue,
  defaultUiFieldValue,
  mapConfigFields,
} from './defaultFieldValues'
import { DEFAULT_AUTO_FETCH_CONFIG } from './defaults'

const uiKeys: Record<string, readonly string[]> = {
  basic: UI_RESET_KEYS,
  platforms: PLATFORMS_UI_RESET_KEYS,
  modules: MODULE_UI_RESET_KEYS,
  agent: AGENT_UI_RESET_KEYS,
  advanced: ADVANCED_RESET_KEYS,
  all: ALL_OWNED_UI_BAG_KEYS,
}

/** Transform only this page's fields; the caller supplies the persisted snapshot for writes. */
export function resetConfigBag(
  config: Config | null,
  scope: string,
): Config | null | undefined {
  if (!config || (!uiKeys[scope] && scope !== 'ai' && scope !== 'lab'))
    return undefined
  const next = structuredClone(config)
  if (uiKeys[scope]) {
    next.ui_config.config_fields = mapConfigFields(
      next.ui_config.config_fields,
      defaultUiFieldValue,
      new Set(uiKeys[scope]),
    )
  }
  if (scope === 'all' || scope === 'platforms') {
    next.auto_fetch = structuredClone(DEFAULT_AUTO_FETCH_CONFIG)
    next.platforms = next.platforms.map((platform) => ({
      ...platform,
      enabled: false,
      has_token: false,
      config_fields: platform.config_fields.map((field) => ({
        ...field,
        value: '',
      })),
    }))
  }
  if (scope === 'all' || scope === 'ai' || scope === 'agent') {
    const keys = new Set(
      next.ai_config.config_fields
        .map((field) => field.key)
        .filter(
          (key) =>
            scope === 'all' ||
            (scope === 'agent'
              ? AGENT_AI_FIELD_KEYS.has(key)
              : !AGENT_AI_FIELD_KEYS.has(key)),
        ),
    )
    next.ai_config.config_fields = mapConfigFields(
      next.ai_config.config_fields,
      defaultAiFieldValue,
      keys,
    )
  }
  if (scope === 'all' || scope === 'lab') {
    next.tripo_config.config_fields = mapConfigFields(
      next.tripo_config.config_fields,
      defaultTripoFieldValue,
    )
  }
  return next
}
