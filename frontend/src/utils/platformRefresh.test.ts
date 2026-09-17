import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import zh from '../i18n/zh-CN.json'
import { localizePlatformSummary, platformFetchDetails, refreshPlatformViews } from './platformRefresh.ts'

test('refreshes persisted views even when a fetch only partially succeeds', async () => {
  const calls: string[] = []
  await refreshPlatformViews(async () => { calls.push('status') }, async () => { calls.push('preview') })
  assert.deepEqual(calls.sort(), ['preview', 'status'])
})
test('one unavailable view does not prevent reloading the other', async () => {
  let preview = false
  await refreshPlatformViews(async () => { throw new Error('offline') }, async () => { preview = true })
  assert.equal(preview, true)
})
test('localizes existing cached summaries without changing counts', () => {
  assert.equal(localizePlatformSummary('Analysis based on 12 collected videos and 3 followed series', zh.dataManagement.fetchResult), '基于 12 个收藏视频和 3 部追番的分析')
  assert.equal(localizePlatformSummary('Bangumi collection: 3 items, finished 2, currently 1', zh.dataManagement.fetchResult), 'Bangumi 收藏：3 项，已完成 2 项，在看 1 项')
  assert.equal(localizePlatformSummary('An authored summary', zh.dataManagement.fetchResult), 'An authored summary')
})
test('failure details accept only known stages and reasons and never echo upstream text', () => {
  const text = platformFetchDetails([{ stage: 'bangumi', reason: 'private' }, { stage: 'favorites', reason: 'rate_limit' }, { stage: 'secret-token', reason: 'secret-body' }], zh.dataManagement.fetchResult)
  assert.match(text, /追番.*公开/)
  assert.match(text, /收藏.*频繁/)
  assert.doesNotMatch(text, /secret/)
})

test('localizes persisted GitHub summaries while preserving language names', () => {
  assert.equal(localizePlatformSummary('Owns 5 repositories, mainly using TypeScript (3), Rust (2)', zh.dataManagement.fetchResult), '拥有 5 个仓库，主要使用 TypeScript (3), Rust (2)')
})

test('every host locale translates deterministic summaries and safe failure reasons', async () => {
  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE']) {
    const copy = JSON.parse(await readFile(new URL(`../i18n/${locale}.json`, import.meta.url), 'utf8')).dataManagement.fetchResult
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(zh.dataManagement.fetchResult).sort())
    assert.deepEqual(Object.keys(copy.reasons).sort(), Object.keys(zh.dataManagement.fetchResult.reasons).sort())
    const summary = localizePlatformSummary('Bangumi collection: 3 items, finished 2, currently 1', copy)
    assert.match(summary, /3/)
    assert.match(summary, /2/)
    assert.match(summary, /1/)
    if (locale !== 'en-US') assert.doesNotMatch(summary, /finished/)
  }
})
