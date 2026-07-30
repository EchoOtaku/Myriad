import { describe, expect, it } from 'vitest'
import {
  ALL_OWNED_UI_BAG_KEYS,
  bagFieldValue,
  configChangesNeedHardReload,
  RUNTIME_RELOAD_UI_BAG_KEYS,
} from './uiBagOwnership'

const deepEqual = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)

function cfg(fields: Array<{ key: string; value: string }>) {
  return {
    platforms: [{ name: 'GitHub' }],
    auto_fetch: { enabled: false, interval_hours: 24 },
    ai_config: { enabled: true },
    ui_config: { config_fields: fields },
  }
}

describe('uiBagOwnership', () => {
  it('lists owned bag keys without base_url', () => {
    expect(ALL_OWNED_UI_BAG_KEYS).toContain('wallpaper_url')
    expect(ALL_OWNED_UI_BAG_KEYS).toContain('analytics_enabled')
    expect(ALL_OWNED_UI_BAG_KEYS).toContain('music_enabled')
    expect(ALL_OWNED_UI_BAG_KEYS).toContain('proxy_url')
    expect(ALL_OWNED_UI_BAG_KEYS).not.toContain('base_url')
  })

  it('does not hard-reload pure UI bag edits', () => {
    const prev = cfg([
      { key: 'site_title', value: 'A' },
      { key: 'wallpaper_url', value: 'https://a' },
    ])
    const next = cfg([
      { key: 'site_title', value: 'B' },
      { key: 'wallpaper_url', value: 'https://b' },
    ])
    expect(configChangesNeedHardReload(next, prev, deepEqual)).toBe(false)
  })

  it('hard-reloads when proxy / platforms / ai change', () => {
    const prev = cfg([{ key: 'proxy_url', value: '' }])
    const nextProxy = cfg([{ key: 'proxy_url', value: 'http://127.0.0.1:7890' }])
    expect(configChangesNeedHardReload(nextProxy, prev, deepEqual)).toBe(true)

    const nextPlatforms = {
      ...prev,
      platforms: [{ name: 'Steam' }],
    }
    expect(configChangesNeedHardReload(nextPlatforms, prev, deepEqual)).toBe(
      true,
    )

    const nextAi = {
      ...prev,
      ai_config: { enabled: false },
    }
    expect(configChangesNeedHardReload(nextAi, prev, deepEqual)).toBe(true)
  })

  it('bagFieldValue reads by key', () => {
    expect(
      bagFieldValue([{ key: 'a', value: '1' }, { key: 'b', value: '2' }], 'b'),
    ).toBe('2')
    expect(RUNTIME_RELOAD_UI_BAG_KEYS.length).toBeGreaterThan(0)
  })
})
