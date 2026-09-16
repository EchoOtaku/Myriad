/**
 * @vitest-environment node
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import apiService from '../services/api'
import {
  areModuleVisibilityPreferencesEqual,
  DEFAULT_MODULE_VISIBILITY_PREFERENCES,
  dispatchModuleVisibilityPreferencesUpdated,
  fetchModuleVisibilityPreferences,
  getCachedModuleVisibilityPreferences,
  normalizeModuleVisibilityPreferences,
  updateModuleVisibilityPreferences,
} from './moduleVisibility'

describe('module visibility session cache', () => {
  it('dispatchModuleVisibilityPreferencesUpdated warms getCachedModuleVisibilityPreferences', () => {
    const next = normalizeModuleVisibilityPreferences({
      modules: {
        ...DEFAULT_MODULE_VISIBILITY_PREFERENCES.modules,
        tapp: 'authenticated',
      },
    })
    dispatchModuleVisibilityPreferencesUpdated(next)
    const cached = getCachedModuleVisibilityPreferences()
    assert.ok(cached)
    assert.equal(cached!.modules.tapp, 'authenticated')
  })

  it('later dispatch overwrites prior cache (no stale admin-only leak)', () => {
    dispatchModuleVisibilityPreferencesUpdated(
      normalizeModuleVisibilityPreferences({
        modules: {
          ...DEFAULT_MODULE_VISIBILITY_PREFERENCES.modules,
          library: 'admin',
        },
      }),
    )
    dispatchModuleVisibilityPreferencesUpdated(
      normalizeModuleVisibilityPreferences({
        modules: {
          ...DEFAULT_MODULE_VISIBILITY_PREFERENCES.modules,
          library: 'all',
        },
      }),
    )
    assert.equal(getCachedModuleVisibilityPreferences()?.modules.library, 'all')
  })
})

describe('site-wide journal board visibility', () => {
  it('keeps database board settings when normalizing and caching API responses', () => {
    const response = {
      journalBoards: { feeds: 'admin', notes: 'authenticated', sites: 'all' } as const,
    }
    const next = normalizeModuleVisibilityPreferences(response)
    assert.deepEqual(next.journalBoards, response.journalBoards)
    dispatchModuleVisibilityPreferencesUpdated(next)
    assert.deepEqual(getCachedModuleVisibilityPreferences()?.journalBoards, response.journalBoards)
  })
})

it('saves journal visibility through the shared API and a fresh visitor reads it', async (t) => {
  const saved = normalizeModuleVisibilityPreferences({
    journalBoards: { feeds: 'admin', notes: 'authenticated', sites: 'all' },
  })
  let stored = DEFAULT_MODULE_VISIBILITY_PREFERENCES
  t.mock.method(apiService, 'put', async (url: string, payload: typeof saved) => {
    assert.equal(url, '/config/module-visibility')
    stored = structuredClone(payload)
    return { success: true, preferences: stored }
  })
  t.mock.method(apiService, 'get', async (url: string) => {
    assert.equal(url, '/config/module-visibility')
    return { success: true, preferences: structuredClone(stored) }
  })
  await updateModuleVisibilityPreferences(saved)
  // Discard this browser's cached state before the visitor fetch.
  dispatchModuleVisibilityPreferencesUpdated(DEFAULT_MODULE_VISIBILITY_PREFERENCES)
  const visitor = await fetchModuleVisibilityPreferences()
  assert.deepEqual(visitor.journalBoards, saved.journalBoards)
  assert.equal(areModuleVisibilityPreferencesEqual(visitor, DEFAULT_MODULE_VISIBILITY_PREFERENCES), false)
})

it('failed saves leave the last confirmed visibility in place', async (t) => {
  dispatchModuleVisibilityPreferencesUpdated(DEFAULT_MODULE_VISIBILITY_PREFERENCES)
  t.mock.method(apiService, 'put', async () => { throw new Error('offline') })
  await assert.rejects(updateModuleVisibilityPreferences(normalizeModuleVisibilityPreferences({
    journalBoards: { feeds: 'admin', notes: 'all', sites: 'all' },
  })), /offline/)
  assert.deepEqual(getCachedModuleVisibilityPreferences()?.journalBoards, DEFAULT_MODULE_VISIBILITY_PREFERENCES.journalBoards)
})
