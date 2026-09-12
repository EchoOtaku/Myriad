import type {
  Config,
  ConfigField,
} from '../../../src/components/config/form/types'
import React, { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { configBagEffects } from '../../../src/components/config/form/configBagEffects'
import { useConfigDomain } from '../../../src/components/config/form/useConfigDomain'
import { useConfigEditor } from '../../../src/components/config/form/useConfigEditor'
import { InputItem } from '../../../src/components/settings/items/InputItem'
import { SettingsButton } from '../../../src/components/settings/items/SettingsButton'
import { SettingsDefaultsProvider } from '../../../src/components/settings/SettingsDefaultsContext'
import { I18nProvider } from '../../../src/contexts/I18nContext'
import messages from '../../../src/i18n/config.en-US.json'

let failSecond = false
let deferFirst = false
let release: (() => void) | undefined
const writes: string[] = []
const refreshes: string[] = []
const listeners = new Set<() => void>()
let dismissed = false
const source = {
  getNotice: () =>
    dismissed
      ? null
      : {
          fieldKey: 'model',
          from: 'old',
          to: 'new-default',
          transitionId: 'old:new',
        },
  dismiss: () => {
    dismissed = true
    listeners.forEach((listener) => listener())
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

function Editor() {
  const first = useConfigDomain({
    id: 'first',
    initial: { one: 'saved', two: 'saved' },
    ready: true,
    persist: async (draft) => {
      writes.push(`first:${JSON.stringify(draft)}`)
      if (deferFirst) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return draft
    },
    reset: (saved, scope) =>
      scope === 'first' ? { ...saved, one: 'default' } : undefined,
    effects: () => [
      {
        id: 'refresh',
        run: () => {
          refreshes.push('first')
        },
      },
    ],
  })
  const second = useConfigDomain({
    id: 'second',
    initial: 'saved',
    ready: !new URLSearchParams(location.search).has('failedLoad'),
    load: async () => {
      if (new URLSearchParams(location.search).has('failedLoad'))
        throw new Error('Second load unavailable')
      return 'saved'
    },
    persist: async (draft) => {
      writes.push(`second:${draft}`)
      if (failSecond) throw new Error('Second endpoint unavailable')
      return draft
    },
  })
  const [message, setMessage] = useState('')
  const showMessage = useCallback((text: string) => setMessage(text), [])
  const editor = useConfigEditor([first, second], showMessage, messages)
  Object.assign(window, {
    settingsFixture: {
      writes,
      refreshes,
      bagEffectIds: () => {
        const field = (key: string, value: string): ConfigField => ({
          key,
          value,
          label: key,
          field_type: 'text',
          placeholder: '',
          required: false,
        })
        const base: Config = {
          platforms: [],
          auto_fetch: { enabled: false, interval_hours: 24 },
          ai_config: { config_fields: [] },
          tripo_config: { config_fields: [] },
          report_config: { config_fields: [] },
          ui_config: {
            config_fields: [
              field('merope_enabled', 'false'),
              field('wallpaper_url', 'old'),
            ],
          },
        }
        const next = {
          ...base,
          ui_config: {
            config_fields: [
              field('merope_enabled', 'true'),
              field('wallpaper_url', 'new'),
            ],
          },
        }
        return configBagEffects(next, base).map(({ id, after }) => ({
          id,
          after,
        }))
      },
      failSecond: (value: boolean) => {
        failSecond = value
      },
      deferFirst: () => {
        deferFirst = true
      },
      release: () => {
        deferFirst = false
        release?.()
      },
      save: editor.save,
      reset: () => editor.reset('first'),
    },
  })
  return (
    <>
      <div data-testid="injected">
        <SettingsDefaultsProvider value={source}>
          <InputItem
            itemKey="model"
            label="First"
            value={first.draft.one}
            onChange={(one) =>
              first.setDraft((current) => ({ ...current, one }))
            }
          />
        </SettingsDefaultsProvider>
      </div>
      <div data-testid="plain">
        <InputItem
          itemKey="model"
          label="Sibling"
          value={first.draft.two}
          onChange={(two) => first.setDraft((current) => ({ ...current, two }))}
        />
      </div>
      <InputItem
        label="Second"
        value={second.draft}
        onChange={second.setDraft}
      />
      <SettingsButton
        onClick={() => void editor.save()}
        disabled={editor.saving}
      >
        Save
      </SettingsButton>
      <SettingsButton
        onClick={() => void editor.reset('first')}
        disabled={editor.saving}
      >
        Reset first
      </SettingsButton>
      <output data-testid="second-ready">{String(second.ready)}</output>
      <output data-testid="dirty">{String(editor.isDirty)}</output>
      <output data-testid="saved">{JSON.stringify(first.saved)}</output>
      <output data-testid="message">{message}</output>
    </>
  )
}
createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <Editor />
  </I18nProvider>,
)
