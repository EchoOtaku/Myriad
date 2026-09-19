import { expect, test } from '@playwright/test'

// Diagnostic measurements, not hardware-independent FPS thresholds.
for (const width of [390, 1440]) {
  for (const count of [12, 120]) {
    test(`feed motion measurement at ${width}px with ${count} sources`, async ({ page }) => {
      test.setTimeout(60_000)
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/phantasiFeeds.html?sources=${count}`)
      const feeds = page.locator('.phantasi-feeds')
      await expect(feeds).toBeVisible()
      await expect(feeds).not.toHaveClass(/is-sites-flipping/)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')
      const results = []
      for (const direction of ['advance', 'return']) {
        const track = page.locator('[data-phantasi-rail-track="sites"]')
        const startOffset = await track.evaluate(el => Number((el as HTMLElement).dataset.phantasiRailScroll) || 0)
        const before = await cdp.send('Performance.getMetrics')
        await page.evaluate(() => {
          const frames: number[] = []
          const tasks: number[] = []
          let previous = performance.now()
          let frame = 0
          const tick = (now: number) => {
            frames.push(now - previous)
            previous = now
            frame = requestAnimationFrame(tick)
          }
          const observer = new PerformanceObserver(list => {
            tasks.push(...list.getEntries().map(entry => entry.duration))
          })
          observer.observe({ type: 'longtask' })
          frame = requestAnimationFrame(tick)
          Object.assign(window, { finishPhantasiMeasurement: () => {
            cancelAnimationFrame(frame)
            tasks.push(...observer.takeRecords().map(entry => entry.duration))
            observer.disconnect()
            return { frames, tasks }
          } })
        })
        const rail = page.locator('.phantasi-feeds__sites')
        await rail.hover()
        await page.mouse.wheel(direction === 'advance' ? 700 : -700, 0)
        await page.waitForTimeout(600)
        await expect(feeds).not.toHaveClass(/is-sites-flipping/)
        const endOffset = await track.evaluate(el => Number((el as HTMLElement).dataset.phantasiRailScroll) || 0)
        if (direction === 'advance') expect(endOffset).toBeGreaterThan(startOffset)
        else expect(endOffset).toBeLessThan(startOffset)
        const sample = await page.evaluate(() => (window as any).finishPhantasiMeasurement()) as { frames: number[]; tasks: number[] }
        const after = await cdp.send('Performance.getMetrics')
        const delta = (name: string) => (after.metrics.find(metric => metric.name === name)?.value ?? 0) - (before.metrics.find(metric => metric.name === name)?.value ?? 0)
        const sorted = sample.frames.slice(1).sort((a, b) => a - b)
        expect(sorted.length).toBeGreaterThan(0)
        await expect(page.locator('[data-phantasi-ghost]')).toHaveCount(0)
        results.push({ direction, width, count, startOffset, endOffset, samples: sorted.length, frameP95Ms: sorted[Math.floor(sorted.length * 0.95)], maxFrameMs: sorted.at(-1), longTasks: sample.tasks.length, maxLongTaskMs: Math.max(0, ...sample.tasks), layoutCount: delta('LayoutCount'), layoutMs: delta('LayoutDuration') * 1000, scriptMs: delta('ScriptDuration') * 1000 })
      }
      await test.info().attach('feed-motion-metrics', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })
      console.log(JSON.stringify(results))
      await cdp.detach()
    })
  }
}
