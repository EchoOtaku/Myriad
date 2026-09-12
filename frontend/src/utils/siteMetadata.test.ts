/** @vitest-environment node */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  applyStoredSiteMetadata,
  formatPageTitle,
  getCurrentMetadata,
} from './siteMetadata.ts'
import {
  SITE_METADATA_CACHE_KEY,
  SITE_METADATA_CACHE_TIME_KEY,
} from './siteMetadataKeys.ts'

const store = new Map<string, string>()

const memoryStorage = {
  getItem(key: string) {
    return store.get(key) ?? null
  },
  setItem(key: string, value: string) {
    store.set(key, String(value))
  },
  removeItem(key: string) {
    store.delete(key)
  },
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
)
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

const favicon = {
  href: '/favicon.webp',
  getAttribute(name: string) {
    return name === 'href' ? this.href : null
  },
  setAttribute(name: string, value: string) {
    if (name === 'href') this.href = value
  },
  removeAttribute() {},
}

function installDom() {
  Object.defineProperty(globalThis, 'location', {
    value: {
      origin: 'https://kiseki.blog',
      href: 'https://kiseki.blog/',
      pathname: '/',
      search: '',
    },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'document', {
    value: {
      title: 'Myriad - A myriad of lights, in one place.',
      querySelector(selector: string) {
        if (selector === 'link[rel="icon"]') return favicon
        return null
      },
      querySelectorAll() {
        return []
      },
      createElement() {
        return {
          setAttribute() {},
          getAttribute() {
            return null
          },
          removeAttribute() {},
        }
      },
      head: { appendChild() {} },
    },
    configurable: true,
  })
}

function restoreDom() {
  store.clear()
  favicon.href = '/favicon.webp'
  if (originalLocation) {
    Object.defineProperty(globalThis, 'location', originalLocation)
  } else {
    Reflect.deleteProperty(globalThis, 'location')
  }
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument)
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
}

afterEach(restoreDom)

describe('stored site metadata paint', () => {
  it('uses a stale cache for title/icon instead of the baked default', () => {
    installDom()
    store.set(
      SITE_METADATA_CACHE_KEY,
      JSON.stringify({
        site_title: 'Kiseki',
        site_favicon: 'https://cdn.example/siteicon.ico',
      }),
    )
    store.set(SITE_METADATA_CACHE_TIME_KEY, '1')

    assert.equal(getCurrentMetadata().site_title, 'Kiseki')
    assert.equal(formatPageTitle('Library'), 'Library · Kiseki')

    applyStoredSiteMetadata()
    assert.equal(document.title, 'Kiseki')
    assert.match(favicon.href, /siteicon\.ico/)
  })
})
