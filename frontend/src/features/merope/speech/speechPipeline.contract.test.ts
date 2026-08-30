import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

test('TTS audio stays off the run hub and cancel stops the buffer source', () => {
  const player = source('./ttsPlayer.ts')
  assert.match(player, /source\?\.stop/)
  assert.match(player, /AudioBufferSourceNode/)
  const host = source('./speechPipelineHost.ts')
  assert.doesNotMatch(host, /run_hub|AgentProgressEvent/)
  assert.match(host, /phase: 'cancel'/)
  const pipeline = source('./ttsPipeline.ts')
  assert.match(pipeline, /MAX_SYNTH = 2/)
})

test('continuous listen is off until the person turns it on', () => {
  const consent = source('../../../components/agent-panel/listenConsent.ts')
  assert.match(consent, /getServerListenConsent/)
  assert.match(consent, /return false/)
  const recording = source('../../../components/agent-panel/useVoiceRecording.ts')
  assert.match(recording, /getSpeechPipeline\(\)\.cancel\(\)/)
  assert.doesNotMatch(recording, /interruptCurrentTask/)
})
