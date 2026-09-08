import { expect, test } from '@playwright/test'

test('stream replacement rejects stale events and cancellation preserves music', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const result = await page.evaluate(() =>
    (window as any).rigImportTest.directorReplay(true, true),
  )
  expect(result.raceChecks).toEqual({
    chunkKeepsDirector: true,
    staleKeptDirector: true,
    staleKeptSpeech: true,
    reconnectDeduplicated: true,
    cancelledPlanAbsent: true,
  })
  expect(result.deliveredText).toEqual([
    '第一句。',
    '后半句继续。',
    '新回复正在说话。',
  ])
  expect(
    result.frames.slice(18, 60).every((f: any) => f.owners.mouth === 'speech'),
  ).toBe(true)
  expect(
    result.frames
      .slice(120, 240)
      .some((f: any) => f.owners.headBody === 'music'),
  ).toBe(true)
  expect(
    Math.max(...result.frames.slice(12, 60).map((f: any) => f.maniac)),
  ).toBeGreaterThan(0.2)
  expect(result.frames.at(-1).maniac).toBeLessThan(0.01)
  expect(result.duplicateWrites).toBe(0)
  expect(result.rejected).toBe(0)
  expect(result.glError).toBe(0)
})

test('speech and music share the director outlet and release their channels', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const result = await page.evaluate(() =>
    (window as any).rigImportTest.directorReplay(true),
  )
  const frames = result.frames as Array<{
    mouthOpen: number
    angleX: number
    angleY: number
    maniac: number
    owners: { mouth: string; headBody: string }
    active: string[]
    musicBehaviors: number
  }>
  expect(frames.slice(0, 120).every((f) => f.owners.mouth === 'speech')).toBe(
    true,
  )
  expect(
    Math.max(...frames.slice(0, 120).map((f) => f.mouthOpen)),
  ).toBeGreaterThan(0.05)
  expect(frames.some((f) => f.musicBehaviors > 0)).toBe(true)
  expect(Math.max(...frames.map((f) => f.maniac))).toBeGreaterThan(0.2)
  expect(
    frames.slice(180, 240).some((f) => f.owners.headBody === 'music'),
  ).toBe(true)
  const musicPoses = frames.slice(180, 240).map((f) => f.angleY)
  expect(Math.max(...musicPoses) - Math.min(...musicPoses)).toBeGreaterThan(
    0.001,
  )
  expect(frames.at(-1)!.owners.mouth).not.toBe('speech')
  expect(frames.at(-1)!.owners.headBody).not.toBe('music')
  expect(result.rejected).toBe(0)
  expect(result.duplicateWrites).toBe(0)
  expect(result.glError).toBe(0)
})

test('director source reaches rendered replacement and recovery without replaying revisions', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const result = await page.evaluate(() =>
    (window as any).rigImportTest.directorReplay(),
  )
  expect(result.accepted).toBeGreaterThan(0)
  expect(result.rejected).toBe(0)
  expect(result.replacementMutation).toBe(false)
  expect(result.duplicateWrites).toBe(0)
  const frames = result.frames as Array<{
    angleX: number
    angleY: number
    angleZ: number
    maniac: number
    active: string[]
    pixelSum: number
  }>
  expect(frames.slice(0, 12).some((f) => Math.abs(f.angleY) > 0.001)).toBe(true)
  expect(frames.slice(12, 30).some((f) => f.maniac > 0.01)).toBe(true)
  expect(frames.some((f) => f.active.includes('respond:recovering'))).toBe(true)
  expect(Math.max(...frames.map((f) => f.maniac))).toBeGreaterThan(0.2)
  expect(frames.at(-1)!.maniac).toBeLessThan(0.01)
  expect(
    frames
      .at(-1)!
      .active.some(
        (id) => id.startsWith('respond:') || id.startsWith('maniac:'),
      ),
  ).toBe(false)
  expect(new Set(frames.map((f) => f.pixelSum)).size).toBeGreaterThan(20)
  for (let i = 1; i < frames.length; i++) {
    for (const key of ['angleX', 'angleY', 'angleZ'] as const)
      expect(Math.abs(frames[i][key] - frames[i - 1][key])).toBeLessThan(0.2)
  }
  expect(result.glError).toBe(0)
})

for (const kind of ['ordinary', 'collar', 'necklace']) {
  for (const fps of [30, 60]) {
    test(`${kind} body replay preserves geometry and visible clothing at ${fps} fps`, async ({
      page,
    }) => {
      test.setTimeout(60_000)
      const result = await page.evaluate(
        ({ kind, fps }) => (window as any).rigImportTest.bodyReplay(kind, fps),
        { kind, fps },
      )
      expect(result.hairLayers).toBeGreaterThan(0)
      expect(result.warmupError).toBe(0)
      expect(result.rootEdges).toBeGreaterThan(0)
      // Gross root collapse/stretch guard, not a claim of artistic acceptance.
      expect(result.minRootStretch).toBeGreaterThan(0.5)
      expect(result.maxRootStretch).toBeLessThan(1.5)
      expect(result.checkedFrames).toBe(2.5 * fps)
      expect(result.invalid).toBe(0)
      expect(result.excursion).toBeGreaterThan(1)
      // No single frame may consume half the replay's full excursion. This
      // detects gross jumps without imposing a new absolute movement-speed cap.
      expect(result.maxStep, JSON.stringify(result)).toBeLessThan(
        result.excursion * 0.5,
      )
      expect(result.targetMutation).toBe(0)
      expect(result.idempotenceError).toBeLessThan(0.00001)
      expect(result.pixelMismatch).toBe(0)
      expect(result.minClothingPixels).toBeGreaterThan(20)
      if (kind === 'collar') {
        expect(result.roles).toContain('collar-front')
        expect(result.collarClip).toBe(true)
      }
      if (kind === 'necklace') {
        expect(result.roles).toContain('neckwear')
        expect(result.roles).not.toContain('collar-front')
        expect(result.minAccessoryPixels).toBeGreaterThan(5)
      }
      expect(result.glError).toBe(0)
    })
  }
}

for (const fps of [30, 60]) {
  test(`eye pixels preserve closure, hidden-white clipping and fade coverage at ${fps} fps`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const result = await page.evaluate(
      (fps) => (window as any).rigImportTest.eyePixels(fps),
      fps,
    )
    const { open, wink, closed, special, reopen, turn, reverse } =
      result.endpoints
    expect(open[0]).toBeGreaterThan(20)
    expect(open.slice(1)).toEqual([0, 0])
    expect(wink[0]).toBeGreaterThan(10)
    expect(wink[1]).toBeGreaterThan(10)
    expect(wink[2]).toBe(0)
    expect(closed[0]).toBe(0)
    expect(closed[1]).toBeGreaterThan(10)
    expect(closed[2]).toBeGreaterThan(10)
    // No crying art in this fixture: all ordinary eye art must yield.
    expect(special).toEqual([0, 0, 0])
    expect(reopen).toEqual(open)
    expect(turn[0]).toBeGreaterThan(0)
    expect(reverse[0]).toBeGreaterThan(0)
    expect(result.outsideMask).toBe(0)
    expect(result.invalidVertices).toBe(0)
    // Fast closure crosses the art-fade window in a few frames. Verify coverage
    // and direction, not an arbitrary opacity speed that would slow blinking.
    // Residual special-expression filtering may remain below one alpha byte.
    expect(result.maxCoverageError).toBeLessThan(1 / 255)
    expect(result.reversals).toBe(0)
    expect(result.blinkColors[2]).toBeGreaterThan(10)
    expect(result.blinkColors[1]).toBe(0)
    expect(result.samples).toBe(8 * fps)
    expect(result.glError).toBe(0)
  })
}

test('relative source assets resolve against the page and preserve fetch errors', async ({
  page,
}) => {
  const requests: string[] = []
  await page.route('**/assets/master.png', (route) => {
    requests.push(new URL(route.request().url()).pathname)
    return route.fulfill({ status: 404, body: '' })
  })
  const result = await page.evaluate(() =>
    (window as any).rigImportTest.relativeSourceFailure(),
  )
  expect(requests).toEqual(['/assets/master.png'])
  expect(result.error).toBe(result.expected)
})

test.beforeEach(async ({ page }) => {
  // A self-contained fixture server only; never talk to an actual backend.
  await page.route('**/api/**', (route) => route.abort())
  await page.goto('/rigImport.html')
  await page.waitForFunction(() => 'rigImportTest' in window)
})

for (const kind of ['ordinary', 'collar', 'necklace', 'alternate-eyes']) {
  test(`real worker import preserves ${kind} manifest and PNG pixels`, async ({
    page,
  }) => {
    const result = await page.evaluate(async (kind) => {
      const harness = (window as any).rigImportTest
      return harness.run(kind)
    }, kind)
    expect(result.error).toBeUndefined()
    expect(result.stages).toEqual(['validated', 'packing'])
    expect(result.sourceEqual).toBe(true)
    expect(result.partCount).toBeGreaterThan(15)
    expect(result.atlas).toEqual(result.expectedAtlas)
    expect(result.reference).toEqual(result.expectedReference)
    if (kind === 'collar') expect(result.roles).toContain('collar-front')
    if (kind === 'necklace') {
      expect(result.roles).toContain('neckwear')
      expect(result.roles).not.toContain('collar-front')
    }
  })
}

test('real player distinguishes automatic blinks, deliberate closure and special eyes', async ({
  page,
}) => {
  const result = await page.evaluate(() =>
    (window as any).rigImportTest.eyeRuntime(),
  )
  expect(result.ordinaryBlink).toBeGreaterThan(0.9)
  expect(result.alternateBlink).toBe(0)
  expect(result.wink.left).toBeGreaterThan(0.95)
  expect(result.wink.ordinaryLeft).toBeLessThan(0.01)
  expect(result.wink.right).toBeLessThan(0.01)
  expect(result.both.left).toBeGreaterThan(0.95)
  expect(result.both.right).toBeGreaterThan(0.95)
  expect(result.cry).toBeLessThan(0.01)
  expect(result.rebound).toBeGreaterThan(0.003)
  expect(result.rebound).toBeLessThan(0.045)
  expect(result.glError).toBe(0)
})

test('packing cancellation rejects and a fresh import still succeeds', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const harness = (window as any).rigImportTest
    return {
      cancelled: await harness.run('ordinary', true),
      next: await harness.run('ordinary'),
    }
  })
  expect(result.cancelled.stages).toEqual(['validated', 'packing'])
  expect(result.cancelled.name).toBe('AbortError')
  expect(result.next.error).toBeUndefined()
  expect(result.next.sourceEqual).toBe(true)
})

test('worker compile failures keep the selected UI language', async ({
  page,
}) => {
  const result = await page.evaluate(() =>
    (window as any).rigImportTest.localizedFailure(),
  )
  expect(result.expected).toMatch(/[\u4E00-\u9FFF]/)
  expect(result.result.error).toBe(result.expected)
})
