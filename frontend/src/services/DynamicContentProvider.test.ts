import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DynamicContentProviderService } from './DynamicContentProvider.ts'

test('one snapshot exposes the complete provider removal, including all its entries', () => {
  const store = new DynamicContentProviderService()
  store.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: 'one' })
  store.setTappContent('demo', { type: 'tapp-second', icon: 'demo', text: 'two' })
  const snapshots: string[][] = []
  const off = store.subscribe(() => {
    assert.equal(store.getProvider('tapp-demo'), undefined)
    snapshots.push(store.getAllContents().map(item => item.text))
  })
  store.unregisterTappProvider('demo')
  off()
  assert.deepEqual(snapshots, [[]])
})

test('content and provider metadata are committed before add/update observers run', () => {
  const store = new DynamicContentProviderService()
  const snapshots: string[] = []
  const off = store.subscribe(() => {
    if (!store.getTappContent('demo')) return
    snapshots.push(store.getAllContents()[0].text)
    assert.equal(typeof store.getProvider('tapp-demo')?.lastUpdate, 'number')
  })
  store.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: 'one' })
  store.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: 'two' })
  off()
  assert.deepEqual(snapshots, ['one', 'two'])
})

test('locale changes publish a new revision and retain fallback translations', () => {
  const store = new DynamicContentProviderService()
  store.setLocale('en-US')
  store.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: 'raw', i18n: { text: { 'en-US': 'Hello', 'ja-JP': 'こんにちは' } } })
  const texts: string[] = []
  const off = store.subscribe(() => texts.push(store.getAllContents()[0].text))
  store.setLocale('ja-JP')
  store.setLocale('ja-JP')
  store.setLocale('fr-FR')
  off()
  assert.deepEqual(texts, ['こんにちは', 'Hello'])
})

test('callers cannot mutate store data through input or returned values', () => {
  const store = new DynamicContentProviderService()
  store.setLocale('en-US')
  const translations = { 'en-US': 'Hello' }
  store.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: 'raw', i18n: { text: translations } })
  translations['en-US'] = 'mutated'
  store.getProvider('tapp-demo')!.enabled = false
  store.getProviderContents('tapp-demo')[0].text = 'mutated'
  store.getTappContent('demo')!.i18n!.text!['en-US'] = 'mutated'
  assert.equal(store.getAllContents()[0].text, 'Hello')
})

test('expiration publishes at the deadline without waiting for another content update', context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const store = new DynamicContentProviderService()
  store.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: 'expires', expiresAt: Date.now() + 1000 })
  const snapshots: string[][] = []
  const off = store.subscribe(() => snapshots.push(store.getAllContents().map(item => item.text)))
  context.mock.timers.tick(999)
  assert.deepEqual(snapshots, [])
  context.mock.timers.tick(1)
  assert.deepEqual(snapshots, [[]])
  off()
})

test('replacing an expiry invalidates its previous timer and unsubscription stops expiry work', context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const store = new DynamicContentProviderService()
  const off = store.subscribe(() => {})
  store.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: 'old', expiresAt: Date.now() + 1000 })
  context.mock.timers.tick(500)
  store.setTappContent('demo', { type: 'tapp-demo', icon: 'demo', text: 'new', expiresAt: Date.now() + 2000 })
  const revision = store.getSnapshot()
  context.mock.timers.tick(500)
  assert.equal(store.getSnapshot(), revision)
  assert.equal(store.getAllContents()[0].text, 'new')
  off()
  context.mock.timers.tick(3000)
  assert.equal(store.getSnapshot(), revision)
  assert.deepEqual(store.getAllContents(), [])
})
