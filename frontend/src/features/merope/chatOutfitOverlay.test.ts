import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  clearChatOutfitOverlay,
  getChatOutfitOverlay,
  resetChatOutfitOverlayForTests,
  setChatOutfitOverlay,
} from './chatOutfitOverlay'

describe('chat outfit overlay', { concurrency: false }, () => {
  test('stores a temporary outfit and can clear it', () => {
    resetChatOutfitOverlayForTests()
    setChatOutfitOverlay('w-coat')
    assert.equal(getChatOutfitOverlay(), 'w-coat')
    setChatOutfitOverlay('w-coat')
    clearChatOutfitOverlay()
    assert.equal(getChatOutfitOverlay(), null)
  })
})

test('panel chat can overlay a saved set without wearing it', () => {
  const panel = readFileSync(
    new URL('../../components/agent-panel/AgentPanelFace.tsx', import.meta.url),
    'utf8',
  )
  const engine = readFileSync(
    new URL('../../components/agent-panel/AgentEngine.tsx', import.meta.url),
    'utf8',
  )
  const composer = readFileSync(
    new URL('../../components/agent-panel/AgentPanelComposer.tsx', import.meta.url),
    'utf8',
  )
  const widget = readFileSync(
    new URL('../../components/widgets/MeropeWidget.tsx', import.meta.url),
    'utf8',
  )
  const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8')
  assert.match(panel, /useChatOutfitOverlay/)
  assert.match(panel, /panelMode === 'chat' \? overlayOutfitId : null/)
  assert.match(panel, /getWardrobeFace\(overlayId\)/)
  assert.match(panel, /getSiteFace\(\)/)
  assert.match(engine, /case 'outfit_overlay'/)
  assert.match(engine, /setChatOutfitOverlay\(overlayEvent\.outfitId\)/)
  assert.match(engine, /if \(current === 'chat'\) clearChatOutfitOverlay\(\)/)
  assert.match(api, /\/api\/agent\/wardrobe\/\$\{encodeURIComponent\(id\)\}\/face/)
  assert.doesNotMatch(composer, /wardrobeWear/)
  assert.doesNotMatch(composer, /OutfitWardrobe/)
  assert.doesNotMatch(composer, /wearOutfit/)
  assert.doesNotMatch(widget, /getWardrobeFace/)
  assert.doesNotMatch(widget, /useChatOutfitOverlay/)
  assert.doesNotMatch(panel, /putPersona/)
  assert.doesNotMatch(engine, /putPersona/)
  assert.match(panel, /\? 'live'/)
  assert.doesNotMatch(panel, /\? atlasUrl/)
})
