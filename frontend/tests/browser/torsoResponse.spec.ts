import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

for (const [name, variable] of [['off-shoulder', 'MEROPE_SHOULDER_ASSET'], ['high-collar', 'MEROPE_COLLAR_ASSET']] as const) {
  test(`real ${name} torso responds to short turns through the player driver`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    const root = process.env[variable]
    test.skip(!root, `Set ${variable} to a real split portrait`)
    const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
    const atlas = await readFile(`${root}/atlas.png`)
    const modules = `/@fs${fileURLToPath(new URL('../../src/features/merope/anime25drig/', import.meta.url))}`
    await page.route('**/torso-response-probe', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }))
    await page.route('**/torso-response-atlas.png', route => route.fulfill({ contentType: 'image/png', body: atlas }))
    await page.goto('/torso-response-probe')
    const result = await page.evaluate(async ({ manifest, modules }) => {
      const { Anime25DPlayer } = await import(`${modules}player.ts`)
      const { IDENTITY_DRIVER } = await import(`${modules}driver.ts`)
      const { anime25DTorsoYawFollow } = await import(`${modules}torsoDeformation.ts`)
      const runs = []
      const original = JSON.stringify(manifest)
      for (const previous of [true, false]) {
        const player = new Anime25DPlayer(document.querySelector('canvas'), manifest.anime25dPlayback, manifest)
        await player.replaceLivePackage(manifest.anime25dPlayback, manifest, '/torso-response-atlas.png')
        player.resize(768, 1024, 1)
        player.setMotionPolicy({ mouth: 'preview', expression: 'preview', gaze: 'preview', headBody: 'preview' })
        Object.assign(player.current, IDENTITY_DRIVER)
        let oldYaw = 0
        let atCueEnd = 0
        let rootAtCueEnd = 0
        let screenshot = ''
        // Same authored cue, same driver easing and physics. Only substitute
        // the previous torso filter in the reference run, never in production.
        for (let frame = 0; frame < 180; frame++) {
          player.setTarget({ ...IDENTITY_DRIVER, angleX: frame < 18 ? 1 : 0, idle: false, rand: false, blink: false, phys: true })
          player.time += 1 / 60
          player.smoothDriver(1 / 60)
          if (previous) {
            const follow = anime25DTorsoYawFollow(player.shellProfile.torso, player.current.bodyYaw)
            const target = player.current.angleX * 0.45 * follow + player.current.body * 0.1
            oldYaw += (target - oldYaw) * (2.5 / 60)
            Object.assign(player.torsoYaw, { value: oldYaw, velocity: 0 })
            Object.assign(player.torsoShellRotation, { active: Math.abs(oldYaw) > 1e-7, yawCosine: Math.cos(oldYaw), yawSine: Math.sin(oldYaw) })
          }
          player.updateSprings(1 / 60)
          if (frame === 17) {
            player.deform(); player.uploadGeometry(); player.draw()
            atCueEnd = player.torsoYaw.value
            rootAtCueEnd = Math.abs(player.secondaryDeformationFrame.torsoNeckOffsetX)
            screenshot = player.gl.canvas.toDataURL('image/png').split(',')[1]
          }
        }
        runs.push({ previous, atCueEnd, rootAtCueEnd, residual: Math.abs(player.torsoYaw.value), error: player.gl.getError(), screenshot })
        player.dispose()
      }
      return { runs, unchanged: original === JSON.stringify(manifest) }
    }, { manifest, modules })
    await testInfo.attach('torso-response-metrics', { body: JSON.stringify({ ...result, runs: result.runs.map(({ screenshot: _screenshot, ...metrics }) => metrics) }, null, 2), contentType: 'application/json' })
    for (const run of result.runs) await testInfo.attach(run.previous ? 'previous-follow' : 'responsive-follow', { body: Buffer.from(run.screenshot, 'base64'), contentType: 'image/png' })
    const [previous, current] = result.runs
    expect(result.unchanged).toBe(true)
    expect(previous.atCueEnd).toBeGreaterThan(0)
    expect(current.atCueEnd).toBeGreaterThan(previous.atCueEnd * 1.3)
    expect(current.rootAtCueEnd).toBeGreaterThan(previous.rootAtCueEnd * 1.2)
    for (const run of result.runs) {
      expect(run.error).toBe(0)
      expect(run.residual).toBeLessThan(0.001)
    }
  })
}
