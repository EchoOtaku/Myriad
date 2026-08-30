import assert from 'node:assert/strict'
import test from 'node:test'
import { playTtsBuffer, sampleMouth } from './ttsPlayer'

test('audio energy maps to a rest viseme when the buffer is silence', () => {
  const bins = new Uint8Array(32)
  bins.fill(128)
  const sample = sampleMouth(bins)
  assert.equal(sample.viseme, 'rest')
  assert.ok((sample.energy ?? 0) < 0.06)
})

test('louder audio opens the mouth instead of staying at rest', () => {
  const bins = new Uint8Array(32)
  for (let i = 0; i < bins.length; i++) bins[i] = i % 2 === 0 ? 20 : 230
  const sample = sampleMouth(bins)
  assert.notEqual(sample.viseme, 'rest')
  assert.ok((sample.energy ?? 0) > 0.2)
})

class FakeSource {
  buffer: unknown = null
  onended: (() => void) | null = null
  started = 0
  stopped = 0
  disconnected = 0
  connect(): void {}
  disconnect(): void {
    this.disconnected += 1
  }

  start(): void {
    this.started += 1
  }

  stop(): void {
    this.stopped += 1
  }
}

function fakeContext(decoded: Promise<unknown>): {
  context: AudioContext
  sources: FakeSource[]
} {
  const sources: FakeSource[] = []
  const context = {
    state: 'running',
    destination: {},
    resume: () => {},
    decodeAudioData: () => decoded,
    createAnalyser: () => ({
      fftSize: 256,
      getByteTimeDomainData: (bins: Uint8Array) => bins.fill(128),
      connect: () => {},
      disconnect: () => {},
    }),
    createBufferSource: () => {
      const source = new FakeSource()
      sources.push(source)
      return source
    },
  }
  return { context: context as unknown as AudioContext, sources }
}

const segment = {
  segmentId: 'msg:1',
  sequence: 1,
  text: '你好',
  messageId: 'msg',
  generation: 0,
  interrupt: 'queue',
} as const

function hooks(): { ended: number; onEnergy: () => void; onEnded: () => void } {
  const state = {
    ended: 0,
    onEnergy: () => {},
    onEnded: () => {
      state.ended += 1
    },
  }
  return state
}

/** Lets the decode promise and its continuations run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

const raf = (): number => 1
globalThis.requestAnimationFrame = raf as typeof requestAnimationFrame
globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame

test('a stale onended after cancel does not report the segment finished', async () => {
  const state = hooks()
  const { context, sources } = fakeContext(Promise.resolve({}))
  const handle = playTtsBuffer(new ArrayBuffer(8), segment, state, context)
  await settle()
  assert.equal(sources.length, 1)

  handle.stop()
  assert.equal(sources[0]!.stopped, 1)

  // WebAudio dispatches onended asynchronously, so it still arrives after the
  // cancel that stopped the source. It must not count as the segment ending.
  sources[0]!.onended?.()
  assert.equal(state.ended, 0)
})

test('playback that runs to the end reports the segment finished once', async () => {
  const state = hooks()
  const { context, sources } = fakeContext(Promise.resolve({}))
  playTtsBuffer(new ArrayBuffer(8), segment, state, context)
  await settle()

  sources[0]!.onended?.()
  assert.equal(state.ended, 1)
  sources[0]!.onended?.()
  assert.equal(state.ended, 1)
})

test('cancelling before decode resolves never starts playback', async () => {
  const state = hooks()
  const { context, sources } = fakeContext(Promise.resolve({}))
  const handle = playTtsBuffer(new ArrayBuffer(8), segment, state, context)
  handle.stop()
  await settle()

  assert.deepEqual(sources, [])
  assert.equal(state.ended, 0)
})

test('a decode failure reports the segment finished so the queue moves on', async () => {
  const state = hooks()
  const { context } = fakeContext(Promise.reject(new Error('bad audio')))
  playTtsBuffer(new ArrayBuffer(8), segment, state, context)
  await settle()

  assert.equal(state.ended, 1)
})
