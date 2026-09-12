import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONFIG_NAV_DEFAULT_SECTION,
  CONFIG_NAV_SECTIONS,
  resolveConfigSectionFromSearch,
} from './configNavPersistence.ts'

describe('resolveConfigSectionFromSearch', () => {
  it('keeps AI when there is no persona subpage', () => {
    const params = new URLSearchParams('section=ai')
    assert.equal(resolveConfigSectionFromSearch(params, true), 'ai')
  })

  it('routes old AI persona deep links to Agent', () => {
    const merope = new URLSearchParams('section=ai&page=merope')
    const setup = new URLSearchParams('section=ai&page=merope-setup')
    const bare = new URLSearchParams('page=merope')
    assert.equal(resolveConfigSectionFromSearch(merope, true), 'agent')
    assert.equal(resolveConfigSectionFromSearch(setup, false), 'agent')
    assert.equal(resolveConfigSectionFromSearch(bare, true), 'agent')
  })

  it('accepts the new Agent section id', () => {
    const params = new URLSearchParams('section=agent')
    assert.equal(resolveConfigSectionFromSearch(params, true), 'agent')
  })

  it('maps the old Laboratory deep link to lab', () => {
    const legacy = new URLSearchParams('section=tripo')
    const current = new URLSearchParams('section=lab')
    assert.equal(resolveConfigSectionFromSearch(legacy, true), 'lab')
    assert.equal(resolveConfigSectionFromSearch(current, false), 'lab')
  })
})

describe('CONFIG_NAV_SECTIONS', () => {
  it('lists settings in the default sidebar order', () => {
    assert.deepEqual(
      [...CONFIG_NAV_SECTIONS],
      [
        'basic',
        'platforms',
        'ai',
        'agent',
        'notifications',
        'oauth',
        'users',
        'permissions',
        'federation',
        'modules',
        'advanced',
        'lab',
        'about',
      ],
    )
    assert.equal(CONFIG_NAV_DEFAULT_SECTION, CONFIG_NAV_SECTIONS[0])
  })
})
