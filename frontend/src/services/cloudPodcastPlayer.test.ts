import assert from 'node:assert/strict'
import { it } from 'node:test'
import { CloudPodcastPlayer } from './speechApi'

it('destroy cancels pending synthesis and prevents late audio allocation', async () => {
  const originalFetch = globalThis.fetch
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  })
  let ready = Promise.withResolvers<void>()
  let finish = Promise.withResolvers<Response>()
  let signal: AbortSignal | undefined
  globalThis.fetch = async (input, options) => {
    if (String(input).includes('csrf-token')) return Response.json({ csrf_token: null })
    signal = options?.signal ?? undefined
    ready.resolve()
    return finish.promise
  }
  const player = new CloudPodcastPlayer()
  let progress = 0
  player.setOnLoadProgress(() => { progress++ })
  try {
    const loading = player.load([{ speaker: 'host', text: 'hello' }], { sourceId: 1, articleId: 2 })
    const rejected = assert.rejects(loading, { name: 'AbortError' })
    await ready.promise
    const oldSignal = signal
    const finishOld = finish
    ready = Promise.withResolvers<void>()
    finish = Promise.withResolvers<Response>()
    const nextLoading = player.load([{ speaker: 'host', text: 'new' }], { sourceId: 1, articleId: 3 })
    const nextRejected = assert.rejects(nextLoading, { name: 'AbortError' })
    await ready.promise
    assert.equal(oldSignal?.aborted, true)
    finishOld.resolve(Response.json({ success: true, audios: [] }))
    await rejected
    assert.equal(player.getState().isLoading, true)
    player.destroy()
    assert.equal(signal?.aborted, true)
    finish.resolve(Response.json({ success: true, audios: [{ index: 0, audio_base64: 'AA==' }] }))
    await nextRejected
    assert.equal(progress, 0)
    assert.equal(player.hasAudio(), false)
    await assert.rejects(player.load([], { sourceId: 1, articleId: 2 }), { name: 'AbortError' })
  } finally {
    player.destroy()
    globalThis.fetch = originalFetch
    if (storage) Object.defineProperty(globalThis, 'sessionStorage', storage)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

it('podcast fetches and retains only current and next dialogue across seeks', async () => {
  const originalFetch = globalThis.fetch
  const originalAudio = globalThis.Audio
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
  const audioInstances: Array<{ src: string }> = []
  globalThis.Audio = class {
    src = ''; preload = ''; currentTime = 0; readyState = 0
    onended = null; onerror = null
    constructor() { audioInstances.push(this) }
    load() {} pause() {} async play() {}
  } as unknown as typeof Audio
  const requests: number[][] = []
  globalThis.fetch = async (input, options) => {
    if (String(input).includes('csrf-token')) return Response.json({ csrf_token: null })
    const body = JSON.parse(String(options?.body))
    requests.push(body.dialogues.map((d: { index: number }) => d.index))
    return Response.json({ success: true, cache_hits: 0, generated: body.dialogues.length, audios: body.dialogues.map((d: { index: number }) => ({ index: d.index, audio: 'AA==' })) })
  }
  const player = new CloudPodcastPlayer()
  try {
    await player.load(Array.from({ length: 20 }, () => ({ speaker: 'host', text: 'hello' })), { sourceId: 1, articleId: 2 })
    assert.deepEqual(requests, [[0, 1]])
    assert.equal(audioInstances.filter(audio => audio.src).length, 2)
    await player.seekTo(10)
    assert.deepEqual(requests, [[0, 1], [10, 11]])
    assert.equal(audioInstances.filter(audio => audio.src).length, 2)
    await player.seekTo(0)
    assert.deepEqual(requests.at(-1), [0, 1])
    assert.equal(audioInstances.filter(audio => audio.src).length, 2)
  } finally {
    player.destroy()
    globalThis.fetch = originalFetch
    globalThis.Audio = originalAudio
    if (storage) Object.defineProperty(globalThis, 'sessionStorage', storage)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})
