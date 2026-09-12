import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const assets = [
  ['off-shoulder', process.env.MEROPE_SHOULDER_ASSET],
  ['high-collar', process.env.MEROPE_COLLAR_ASSET],
  ...(process.env.MEROPE_HAIR_ASSETS ?? '').split(delimiter).filter(Boolean).map((root, i) => [`additional-${i + 1}`, root]),
]
for (const [name, root] of assets) {
  test(`real ${name} nod drives signed vertical hair lag into rendered pixels`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    test.skip(!root, 'Set MEROPE_SHOULDER_ASSET / MEROPE_COLLAR_ASSET or MEROPE_HAIR_ASSETS to real split portraits')
    const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
    const atlas = await readFile(`${root}/atlas.png`)
    const modules = `/@fs${fileURLToPath(new URL('../../src/features/merope/anime25drig/', import.meta.url))}`
    await page.route('**/hair-nod-probe', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }))
    await page.route('**/hair-nod-atlas.png', route => route.fulfill({ contentType: 'image/png', body: atlas }))
    await page.goto('/hair-nod-probe')
    const result = await page.evaluate(async ({ manifest, modules }) => {
      const { Anime25DPlayer } = await import(`${modules}player.ts`)
      const { IDENTITY_DRIVER } = await import(`${modules}driver.ts`)
      const player = new Anime25DPlayer(document.querySelector('canvas'), manifest.anime25dPlayback, manifest)
      await player.replaceLivePackage(manifest.anime25dPlayback, manifest, '/hair-nod-atlas.png')
      player.resize(768, 1024, 1)
      player.setMotionPolicy({ mouth: 'preview', expression: 'preview', gaze: 'preview', headBody: 'preview' })
      Object.assign(player.current, IDENTITY_DRIVER)
      const springs = player.layers.flatMap(layer => layer.springs ?? [])
      if (!springs.length) throw new Error('Fixture needs hair springs')
      const area = (vertices, a, b, c) => (vertices[b] - vertices[a]) * (vertices[c + 1] - vertices[a + 1]) -
        (vertices[b + 1] - vertices[a + 1]) * (vertices[c] - vertices[a])
      const screenshots = []
      let minLag = 0; let maxLag = 0; let minAreaRatio = Infinity
      let visibleLag = 0; let changedPixels = 0
      for (let frame = 0; frame < 180; frame++) {
        const angleY = frame < 30 ? 0.85 : frame < 60 ? -0.85 : 0
        player.setTarget({ ...IDENTITY_DRIVER, angleY, idle: false, rand: false, blink: false, phys: true })
        player.time += 1 / 60
        player.smoothDriver(1 / 60); player.updateSprings(1 / 60); player.deform()
        minLag = Math.min(minLag, ...springs.map(spring => spring.vertical.dx))
        maxLag = Math.max(maxLag, ...springs.map(spring => spring.vertical.dx))
        for (const layer of player.layers) {
          if (!layer.hairSurface) continue
          for (let i = 0; i < layer.indices.length; i += 3) {
            const [a, b, c] = Array.from(layer.indices.slice(i, i + 3), v => Number(v) * 2)
            const restArea = area(layer.rest, a, b, c)
            if (Math.abs(restArea) > 1e-8) minAreaRatio = Math.min(minAreaRatio, area(layer.deformed, a, b, c) / restArea)
          }
        }
        if (frame !== 14 && frame !== 44) continue
        const following = player.layers.map(layer => new Float32Array(layer.deformed))
        const gl = player.gl
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
        const capture = (name) => {
          player.uploadGeometry(); player.draw()
          screenshots.push({ name, image: gl.canvas.toDataURL('image/png').split(',')[1] })
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          return pixels.slice()
        }
        const after = capture(`vertical-follow-${frame}`)
        // Isolate the new vertical channel at the SAME pose and spring time.
        // This is an ablation, not a recreation of all historical rendering.
        const lag = springs.map(spring => spring.vertical.dx)
        springs.forEach(spring => { spring.vertical.dx = 0 })
        player.deform()
        const before = capture(`without-vertical-follow-${frame}`)
        for (let i = 0; i < after.length; i += 4) {
          if (Math.max(...after.slice(i, i + 4).map((value, k) => Math.abs(value - before[i + k]))) > 8) changedPixels++
        }
        player.layers.forEach((layer, index) => {
          if (!layer.hairSurface) return
          for (let i = 1; i < layer.deformed.length; i += 2) visibleLag = Math.max(visibleLag, Math.abs(following[index][i] - layer.deformed[i]))
        })
        springs.forEach((spring, index) => { spring.vertical.dx = lag[index] })
      }
      const error = player.gl.getError()
      player.dispose()
      return { minLag, maxLag, minAreaRatio, visibleLag, changedPixels, error, screenshots }
    }, { manifest, modules })
    await testInfo.attach('hair-nod-metrics', { body: JSON.stringify({ ...result, screenshots: undefined }, null, 2), contentType: 'application/json' })
    for (const shot of result.screenshots) await testInfo.attach(shot.name, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
    expect(result.minLag).toBeLessThan(-1)
    expect(result.maxLag).toBeGreaterThan(1)
    expect(result.visibleLag).toBeGreaterThan(1)
    expect(result.changedPixels).toBeGreaterThan(100)
    expect(result.minAreaRatio).toBeGreaterThan(0)
    expect(result.error).toBe(0)
  })

  test(`real ${name} hair uses distinct projected roots during combined head motion`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    test.skip(!root, 'Set MEROPE_SHOULDER_ASSET / MEROPE_COLLAR_ASSET or MEROPE_HAIR_ASSETS to real split portraits')
    const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
    const atlas = await readFile(`${root}/atlas.png`)
    const modules = `/@fs${fileURLToPath(new URL('../../src/features/merope/anime25drig/', import.meta.url))}`
    await page.route('**/hair-roots-probe', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }))
    await page.route('**/hair-roots-atlas.png', route => route.fulfill({ contentType: 'image/png', body: atlas }))
    await page.goto('/hair-roots-probe')
    const result = await page.evaluate(async ({ manifest, modules }) => {
      const { Anime25DPlayer } = await import(`${modules}player.ts`)
      const { IDENTITY_DRIVER } = await import(`${modules}driver.ts`)
      const { bindAttachmentMesh, sampleAttachmentMesh } = await import(`${modules}attachmentMesh.ts`)
      const original = JSON.stringify(manifest)
      const runs = []
      for (const previous of [true, false]) {
        const player = new Anime25DPlayer(document.querySelector('canvas'), manifest.anime25dPlayback, manifest)
        await player.replaceLivePackage(manifest.anime25dPlayback, manifest, '/hair-roots-atlas.png')
        player.resize(768, 1024, 1)
        player.setMotionPolicy({ mouth: 'preview', expression: 'preview', gaze: 'preview', headBody: 'preview' })
        Object.assign(player.current, IDENTITY_DRIVER)
        const anchors = player.playback.anchors
        const commonSupport = () => (player.current.angleX * 14 + player.current.angleZ * 0.07 *
          (anchors.neckPivot.y - anchors.face.cy)) * anchors.faceScale + player.secondaryDeformationFrame.torsoNeckOffsetX
        if (previous) { for (const layer of player.layers) { for (const spring of layer.springs ?? []) {
          // Compare the previous common X estimate and its old output gains
          // (below). The current vertical channel and geometry stay identical;
          // this is an input/gain comparison, not the whole historical renderer.
          Object.defineProperty(spring, 'supportX', { get: commonSupport, set: () => {} })
        }
}
}
        const samples = player.layers.flatMap(layer => {
          if (!layer.hairRoots || !layer.hairSurface) return []
          return layer.source.strands.map((strand, i) => ({ layer: layer.source.name, bound: layer.hairRoots.samples[i], spring: layer.springs[i], sample: bindAttachmentMesh({
            rest: layer.rest, deformed: layer.hairSurface.base, indices: layer.indices,
          }, strand.x, strand.rootY) })).filter(item => item.sample)
        })
        const point = { x: 0, y: 0 }
        let rootError = 0; let rootSpread = 0
        let worstRoot = null
        let minAreaRatio = Infinity
        let maxEdgeRatio = 1
        let worstEdge = null
        let worstTriangle = null
        const area = (p, a, b, c) => (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a])
        const screenshots = []
        player.deform(); player.uploadGeometry(); player.draw()
        screenshots.push({ frame: 'neutral', image: player.gl.canvas.toDataURL('image/png').split(',')[1] })
        if (!previous) {
          // Static source-over atlas assembly bypasses every rig deformation.
          // It distinguishes split-art defects from motion/renderer defects.
          const atlasImage = new Image()
          atlasImage.src = '/hair-roots-atlas.png'
          await atlasImage.decode()
          const flat = document.createElement('canvas')
          flat.width = player.playback.pixelCanvas.width
          flat.height = player.playback.pixelCanvas.height
          const context = flat.getContext('2d')!
          for (const layer of player.layers) {
            const s = layer.source
            const uv = s.atlas
            context.globalAlpha = layer.frameOpacity
            context.drawImage(atlasImage, uv.x * atlasImage.width, uv.y * atlasImage.height,
              uv.w * atlasImage.width, uv.h * atlasImage.height, s.x, s.y, s.w, s.h)
          }
          screenshots.push({ frame: 'atlas-composite', image: flat.toDataURL('image/png').split(',')[1] })
        }
        for (let frame = 0; frame < 240; frame++) {
          const direction = frame < 80 ? 1 : frame < 160 ? -1 : 0
          player.setTarget({ ...IDENTITY_DRIVER, angleX: direction * 0.9, angleY: Math.sin(frame / 60 * Math.PI) * 0.85,
            angleZ: direction * 0.7, idle: false, rand: false, blink: false, phys: true })
          player.time += 1 / 60
          player.smoothDriver(1 / 60); player.updateSprings(1 / 60)
          if (previous) { for (const layer of player.layers) { for (const spring of layer.springs ?? []) {
            spring.stiff.dx *= 2.2
            spring.soft.dx *= 3
          }
}
}
          player.deform()
          for (const layer of player.layers) {
            if (!layer.hairSurface) continue
            for (let i = 0; i < layer.indices.length; i += 3) {
              const [a, b, c] = Array.from(layer.indices.slice(i, i + 3), v => Number(v) * 2)
              const reference = area(layer.rest, a, b, c)
              if (Math.abs(reference) < 1e-8) continue
              const ratio = area(layer.deformed, a, b, c) / reference
              if (ratio < minAreaRatio) {
                minAreaRatio = ratio
                worstTriangle = { layer: layer.source.name, frame, indices: [a, b, c],
                  baseRatio: area(layer.hairSurface.base, a, b, c) / reference }
              }
              for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                const base = layer.hairSurface.base
                const p = layer.deformed
                const length = Math.hypot(base[u] - base[v], base[u + 1] - base[v + 1])
                const stretch = Math.hypot(p[u] - p[v], p[u + 1] - p[v + 1]) / length
                if (stretch > maxEdgeRatio) {
                  maxEdgeRatio = stretch
                  worstEdge = { layer: layer.source.name, frame, indices: [u, v], length }
                }
              }
            }
          }
          const supports = samples.map(({ spring, sample, layer, bound }) => {
            sampleAttachmentMesh(sample, point)
            // The collar envelope can redirect excess pitch into body motion,
            // even when the requested body is zero. Include the shader-owned
            // rotation when comparing the mesh with world-space root inputs.
            const { bodyPivotX, bodyPivotY, bodyRotationCosine: cosine, bodyRotationSine: sine } = player.renderFrame
            const x = point.x - bodyPivotX; const y = point.y - bodyPivotY
            const worldX = bodyPivotX + x * cosine - y * sine
            const worldY = bodyPivotY + x * sine + y * cosine
            const error = Math.hypot(worldX - sample.x - spring.supportX, worldY - sample.y - spring.supportY)
            if (error > rootError) {
              rootError = error
              worstRoot = { layer, frame, x: sample.x, y: sample.y, probeIndices: sample.indices,
                boundIndices: bound.indices, probeWeights: sample.weights, boundWeights: bound.weights, body: player.current.body }
            }
            return spring.supportX
          })
          rootSpread = Math.max(rootSpread, Math.max(...supports) - Math.min(...supports))
          if (frame === 34 || frame === 87 || frame === 114) {
            player.uploadGeometry(); player.draw()
            screenshots.push({ frame, image: player.gl.canvas.toDataURL('image/png').split(',')[1] })
            if (!previous && frame === 87) {
              // Same physics state and pose, with only edge-length projection
              // removed; the pre-existing area barrier is still active.
              const savedEdges = player.layers.map(layer => layer.hairSurface?.edges)
              player.layers.forEach(layer => { if (layer.hairSurface) layer.hairSurface.edges = new Uint16Array() })
              player.deform(); player.uploadGeometry(); player.draw()
              screenshots.push({ frame: '87-area-only', image: player.gl.canvas.toDataURL('image/png').split(',')[1] })
              player.layers.forEach((layer, i) => { if (layer.hairSurface) layer.hairSurface.edges = savedEdges[i] })
              player.deform()
              const face = player.layers.find(layer => layer.source.role === 'face')
              const opacity = face.frameOpacity
              face.frameOpacity = 0
              player.uploadGeometry(); player.draw()
              screenshots.push({ frame: '87-without-face', image: player.gl.canvas.toDataURL('image/png').split(',')[1] })
              face.frameOpacity = opacity
            }
          }
        }
        runs.push({ previous, rootError, rootSpread, worstRoot, minAreaRatio, worstTriangle, maxEdgeRatio, worstEdge, samples: samples.length, error: player.gl.getError(), screenshots })
        player.dispose()
      }
      return { runs, unchanged: original === JSON.stringify(manifest) }
    }, { manifest, modules })
    await testInfo.attach('hair-root-metrics', { body: JSON.stringify({ ...result, runs: result.runs.map(({ screenshots: _screenshots, ...run }) => run) }, null, 2), contentType: 'application/json' })
    for (const run of result.runs) { for (const shot of run.screenshots) await testInfo.attach(`${run.previous ? 'common' : 'projected'}-${shot.frame}`, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
}
    const [previous, current] = result.runs
    expect(result.unchanged).toBe(true)
    expect(current.samples).toBeGreaterThan(5)
    expect(previous.rootSpread).toBe(0)
    expect(current.rootSpread).toBeGreaterThan(5)
    expect(previous.rootError).toBeGreaterThan(5)
    expect(current.rootError, JSON.stringify(current.worstRoot)).toBeLessThan(0.001)
    expect(current.minAreaRatio, JSON.stringify(current.worstTriangle)).toBeGreaterThan(0)
    // The solver's 1.25 local target is soft: adjacent area corrections can
    // relax it. This measured replay bound catches rubber-strip deformation.
    expect(current.maxEdgeRatio, JSON.stringify(current.worstEdge)).toBeLessThan(1.4)
    for (const run of result.runs) expect(run.error).toBe(0)
  })

  test(`real ${name} hair trails a body-only movement and settles on the player clock`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    test.skip(!root, 'Set MEROPE_SHOULDER_ASSET / MEROPE_COLLAR_ASSET or MEROPE_HAIR_ASSETS to real split portraits')
    const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
    const atlas = await readFile(`${root}/atlas.png`)
    const modules = `/@fs${fileURLToPath(new URL('../../src/features/merope/anime25drig/', import.meta.url))}`
    await page.route('**/hair-follow-probe', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }))
    await page.route('**/hair-follow-atlas.png', route => route.fulfill({ contentType: 'image/png', body: atlas }))
    await page.goto('/hair-follow-probe')
    const result = await page.evaluate(async ({ manifest, modules }) => {
      const { Anime25DPlayer } = await import(`${modules}player.ts`)
      const { IDENTITY_DRIVER } = await import(`${modules}driver.ts`)
      const player = new Anime25DPlayer(document.querySelector('canvas'), manifest.anime25dPlayback, manifest)
      await player.replaceLivePackage(manifest.anime25dPlayback, manifest, '/hair-follow-atlas.png')
      player.resize(768, 1024, 1)
      player.setMotionPolicy({ mouth: 'preview', expression: 'preview', gaze: 'preview', headBody: 'preview' })
      Object.assign(player.current, IDENTITY_DRIVER)
      player.setTarget({ ...IDENTITY_DRIVER, body: 1, idle: false, blink: false, rand: false, phys: true })
      let peakLag = 0; let peakSupport = 0; let visibleLag = 0
      const screenshots = []
      for (let frame = 0; frame < 900; frame++) {
        player.time += 1 / 60
        player.smoothDriver(1 / 60)
        player.updateSprings(1 / 60)
        const springs = player.layers.flatMap(layer => layer.springs ?? [])
        if (!springs.length) throw new Error('Fixture needs hair springs')
        if (Math.abs(player.current.angleX) > 1e-8 || Math.abs(player.current.angleZ) > 1e-8) throw new Error('Probe must isolate body movement')
        peakSupport = Math.max(peakSupport, ...springs.map(spring => spring.supportX))
        peakLag = Math.min(peakLag, ...springs.map(spring => spring.stiff.dx))
        if (frame === 15 || frame === 30) {
          // With idle wind and local head angles both zero, the previous loop
          // produced zero hair displacement. Draw that exact no-response case.
          player.current.phys = false
          player.deform(); player.uploadGeometry(); player.draw()
          screenshots.push({ name: `previous-${frame}`, image: player.gl.canvas.toDataURL('image/png').split(',')[1] })
          player.current.phys = true
          player.deform(); player.uploadGeometry(); player.draw()
          screenshots.push({ name: `following-${frame}`, image: player.gl.canvas.toDataURL('image/png').split(',')[1] })
          for (const layer of player.layers) {
            if (!layer.hairSurface) continue
            for (let i = 0; i < layer.deformed.length; i += 2) {
              if ((layer.secondaryDeformation.alongStrand?.[i / 2] ?? 0) < 0.4) continue
              visibleLag = Math.min(visibleLag, layer.deformed[i] - layer.hairSurface.base[i])
            }
          }
        }
      }
      const residual = Math.max(...player.layers.flatMap(layer => (layer.springs ?? []).flatMap(spring => [Math.abs(spring.stiff.dx), Math.abs(spring.soft.dx)])))
      const error = player.gl.getError()
      player.dispose()
      return { peakSupport, peakLag, visibleLag, residual, error, screenshots }
    }, { manifest, modules })
    await testInfo.attach('hair-follow-metrics', { body: JSON.stringify({ ...result, screenshots: undefined }, null, 2), contentType: 'application/json' })
    for (const shot of result.screenshots) await testInfo.attach(shot.name, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
    expect(result.peakSupport).toBeGreaterThan(10)
    expect(result.peakLag).toBeLessThan(-5)
    expect(result.visibleLag).toBeLessThan(-3)
    expect(result.residual).toBeLessThan(0.2)
    expect(result.error).toBe(0)
  })
}
