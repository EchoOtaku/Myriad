import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('pageData abort', () => {
  it('feed stories and home notes share one in-flight request and honour the caller signal after it', () => {
    const src = readFileSync(join(dir, 'pageData.ts'), 'utf8')
    assert.match(src, /export async function loadFeedStories\([\s\S]*signal\?: AbortSignal/)
    assert.match(src, /export async function loadHomeBoardNotes\([\s\S]*signal\?: AbortSignal/)
    assert.match(src, /export async function loadBoardNotes\([\s\S]*signal\?: AbortSignal/)
    // 请求本身不带 signal（否则一个调用方放弃会把大家共用的那次请求一起掐掉），
    // 结果拿到后再看调用方还要不要。
    assert.doesNotMatch(src, /signal \? \{ signal \} : undefined/)
    assert.equal((src.match(/requestCache\.fetch\(/g) ?? []).length, 3)
    assert.equal((src.match(/signal\?\.throwIfAborted\(\)/g) ?? []).length, 3)
  })

  it('board page aborts in-flight notes loads; feed stories drop late results', () => {
    const src = readFileSync(join(dir, 'useBoardPage.ts'), 'utf8')
    assert.match(src, /new AbortController\(\)/)
    assert.match(src, /loadFeedStories\(source\.id, stamp\)/)
    assert.match(src, /loadBoardNotes\(sourcesRef\.current, controller\.signal\)/)
    assert.match(src, /controller\.abort\(\)/)
    assert.match(src, /if \(!fetchLiveRef\.current\) return/)
  })
})
