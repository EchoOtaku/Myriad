import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  claimLiveFacePlayback,
  LIVE_FACE_PLAYBACK_PRIORITY,
  liveFacePlaybackHolder,
  resetLiveFacePlaybackForTests,
} from './liveFacePlayback'

describe('live face playback', { concurrency: false }, () => {
  test('the panel outranks the home widget', () => {
    resetLiveFacePlaybackForTests()
    const widget = claimLiveFacePlayback(
      'widget:a',
      LIVE_FACE_PLAYBACK_PRIORITY.widget,
    )
    assert.equal(liveFacePlaybackHolder(), 'widget:a')
    const panel = claimLiveFacePlayback(
      'agent-panel-face',
      LIVE_FACE_PLAYBACK_PRIORITY.panel,
    )
    assert.equal(liveFacePlaybackHolder(), 'agent-panel-face')
    panel()
    assert.equal(liveFacePlaybackHolder(), 'widget:a')
    widget()
    assert.equal(liveFacePlaybackHolder(), null)
  })

  test('equal priority keeps the earlier claimer', () => {
    resetLiveFacePlaybackForTests()
    const first = claimLiveFacePlayback('a', 1)
    const second = claimLiveFacePlayback('b', 1)
    assert.equal(liveFacePlaybackHolder(), 'a')
    first()
    assert.equal(liveFacePlaybackHolder(), 'b')
    second()
  })
})

test('widget and panel share one WebGL player', () => {
  const widget = readFileSync(
    new URL('../../components/widgets/MeropeWidget.tsx', import.meta.url),
    'utf8',
  )
  const panel = readFileSync(
    new URL('../../components/agent-panel/AgentPanelFace.tsx', import.meta.url),
    'utf8',
  )
  const lifecycle = readFileSync(
    new URL('./motion/useRigMotionLifecycle.ts', import.meta.url),
    'utf8',
  )
  assert.match(widget, /useLiveFacePlayback\(/)
  assert.match(widget, /manifest=\{playsLive \? manifest : null\}/)
  assert.match(panel, /useLiveFacePlayback\(/)
  assert.match(panel, /LIVE_FACE_PLAYBACK_PRIORITY\.panel/)
  assert.match(lifecycle, /useRigSingingLifecycle\(options\.ready \?\? true\)/)
})

test('a playable rig never uses the master portrait as a stand-in', () => {
  const widget = readFileSync(
    new URL('../../components/widgets/MeropeWidget.tsx', import.meta.url),
    'utf8',
  )
  const panel = readFileSync(
    new URL('../../components/agent-panel/AgentPanelFace.tsx', import.meta.url),
    'utf8',
  )
  const character = readFileSync(
    new URL('./anime25drig/Anime25DCharacter.tsx', import.meta.url),
    'utf8',
  )
  const player = readFileSync(
    new URL('./anime25drig/player.ts', import.meta.url),
    'utf8',
  )
  for (const source of [widget, panel]) {
    assert.match(source, /showTaken = playableRig && !playsLive/)
    assert.match(source, /fallbackUrl=\{playableRig \? null : portraitUrl\}/)
    assert.match(source, /widgetFaceSlotTaken/)
  }
  assert.match(widget, /src=\{STYLE_REFERENCE_PREVIEW\}/)
  assert.doesNotMatch(character, /fallbackUrl/)
  assert.match(character, /player\.tick\(1 \/ 60\)/)
  assert.match(character, /presentLive\(true\)/)
  assert.match(character, /if \(!recoverGpu\(\)\) onPlaybackError/)
  assert.match(character, /key=\{gpuEpoch\}/)
  assert.match(player, /loadImage\(url, atlasAbort\.signal\)/)
  assert.match(
    player,
    /if \(this\.disposed \|\| atlasAbort\.signal\.aborted\) return/,
  )
})
