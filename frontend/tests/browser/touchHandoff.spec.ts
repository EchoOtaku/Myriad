import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const scenarios = [
  { name: 'high-collar speech', key: 'MEROPE_COLLAR_ASSET', withSpeech: true },
  { name: 'off-shoulder speech', key: 'MEROPE_SHOULDER_ASSET', withSpeech: true },
  { name: 'high-collar thinking resume', key: 'MEROPE_COLLAR_ASSET', withSpeech: false },
]
for (const { name, key, withSpeech } of scenarios) {
  test(`real ${name} component carries petting without a face reset`, async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const root = process.env[key]
    test.skip(!root, `Set ${key} to a real rig`)
    const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
    const atlas = await readFile(`${root}/atlas.png`)
    const fixture = `/@fs${fileURLToPath(new URL('./fixture/touchHandoff.tsx', import.meta.url))}`
    await page.route('**/touch-handoff-probe', route => route.fulfill({ contentType: 'text/html',
      body: '<style>.merope-rig{display:block;width:384px;height:512px}canvas{width:100%;height:100%}</style><div id="root"></div>' }))
    await page.route('**/touch-handoff-atlas.png', route => route.fulfill({ contentType: 'image/png', body: atlas }))
    await page.goto('/touch-handoff-probe')
    const result = await page.evaluate(async ({ fixture, manifest, withSpeech }) => {
      const { replayCharacterScene } = await import(fixture)
      return replayCharacterScene(manifest, withSpeech ? 'touch-speech' : 'touch-thinking')
    }, { fixture, manifest, withSpeech })
    await testInfo.attach('touch-handoff-metrics', { body: JSON.stringify({ ...result, screenshots: undefined }, null, 2), contentType: 'application/json' })
    for (const shot of result.screenshots) await testInfo.attach(shot.name, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
    expect(result.initialThinking).toBe(true)
    expect(result.thoughtDuringTouch).toBe(true)
    expect(result.resetCount).toBe(0)
    expect(result.acceptedFrames).toBeGreaterThan(60)
    if (withSpeech) {
      expect(result.mouthDuringTouch).toBeGreaterThan(0.15)
      expect(result.speechMouthOwned).toBe(true)
      expect(result.thoughtDuringSpeech).toBe(false)
    }
    expect(result.maxHeadStep).toBeLessThan(0.2)
    expect(result.maxEyeStep).toBeLessThan(0.1)
    expect(result.liftedMaxEye).toBeLessThan(0.65)
    expect(result.finalTouch).toBeNull()
    expect(result.finalOwners).toEqual({ mouth: 'idle', expression: 'idle', gaze: 'idle', headBody: 'idle' })
    expect(result.finalThinking).toBe(!withSpeech)
    expect(result.finalEyeOpen).toBeGreaterThan(0.65)
    expect(result.finalTalk).toBe(false)
    expect(result.error).toBe(0)
  })
}

const fullAssets = [process.env.MEROPE_SHOULDER_ASSET, process.env.MEROPE_COLLAR_ASSET,
  ...(process.env.MEROPE_HAIR_ASSETS ?? '').split(delimiter).filter(Boolean)]
for (const [index, root] of fullAssets.entries()) {
  test(`real asset ${index + 1} default performance crosses music, thinking, speech and touch through the runtime`, async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    test.skip(!root, 'Provide a real split portrait')
    const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
    const atlas = await readFile(`${root}/atlas.png`)
    const fixture = `/@fs${fileURLToPath(new URL('./fixture/touchHandoff.tsx', import.meta.url))}`
    await page.route('**/default-performance-probe', route => route.fulfill({ contentType: 'text/html',
      body: '<style>.merope-rig{display:block;width:384px;height:512px}canvas{width:100%;height:100%}</style><div id="root"></div>' }))
    await page.route('**/touch-handoff-atlas.png', route => route.fulfill({ contentType: 'image/png', body: atlas }))
    await page.goto('/default-performance-probe')
    const result = await page.evaluate(async ({ fixture, manifest }) => {
      const { replayCharacterScene } = await import(fixture)
      return replayCharacterScene(manifest, 'default')
    }, { fixture, manifest })
    await testInfo.attach('default-performance-metrics', { body: JSON.stringify({ ...result, screenshots: undefined }, null, 2), contentType: 'application/json' })
    for (const shot of result.screenshots) await testInfo.attach(shot.name, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
    expect(result.resets).toBe(0)
    expect(result.maxStep).toBeLessThan(0.22)
    expect(result.musicFrames).toBeGreaterThan(100)
    expect(result.lateMusicFrames).toBe(0)
    expect(result.thinkingFrames).toBeGreaterThan(60)
    expect(result.speechFrames).toBeGreaterThan(90)
    expect(result.touchFrames).toBeGreaterThan(20)
    expect(result.phases.speechTouch.mouth).toBeGreaterThan(0.15)
    for (const phase of ['music', 'afterMusic', 'finalIdle']) {
      const motion = result.phases[phase]
      expect(motion.maxYaw - motion.minYaw, phase).toBeGreaterThan(0.15)
      expect(motion.maxBody - motion.minBody, phase).toBeGreaterThan(0.03)
    }
    expect(result.finalThinking).toBe(false)
    expect(result.finalTalk).toBe(false)
    expect(result.finalTouch).toBeNull()
    expect(result.finalOwners).toEqual({ mouth: 'idle', expression: 'mood', gaze: 'ambient', headBody: 'ambient' })
    expect(result.error).toBe(0)
  })
}
