import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    panelHeightFixture: { morph: (active: boolean) => void, stop: () => void, notifications: () => string[] }
  }
}

for (const width of [390, 1440]) {
  for (const reducedMotion of ['reduce', 'no-preference'] as const) {
    test(`panel follows nested content without timer lag at ${width}px (${reducedMotion})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion })
      await page.goto('/panelHeight.html')
      await expect(page.locator('.control-bar-trigger')).toHaveAttribute('style', /height/)
      const result = await page.evaluate(async () => {
        const shell = document.querySelector<HTMLElement>('.control-bar-trigger')!
        const nested = document.getElementById('nested-content')!
        const frames = async () => {
          for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame)
        }
        await frames()
        // A size change below the old 4px cutoff must still settle correctly.
        nested.style.height = '102px'
        await frames()
        const small = shell.style.height
        // ResizeObserver sees intrinsic content changes, even on mobile.
        nested.style.height = '200px'
        await frames()
        const grown = shell.style.height
        // Nested insertion is coalesced, with no 600/1200ms timer.
        const child = document.createElement('div')
        child.style.height = '60px'
        nested.parentElement!.append(child)
        await frames()
        const inserted = shell.style.height
        window.panelHeightFixture.morph(true)
        nested.style.height = '300px'
        await frames()
        const duringMorph = shell.style.height
        window.panelHeightFixture.morph(false)
        const afterMorph = shell.style.height
        window.dispatchEvent(new Event('gcp-remeasure'))
        window.panelHeightFixture.stop()
        nested.style.height = '400px'
        await frames()
        return { small, grown, inserted, duringMorph, afterMorph, afterStop: shell.style.height }
      })
      expect(result).toEqual({
        small: '111px', grown: '216px', inserted: '281px',
        duringMorph: '281px', afterMorph: '389px', afterStop: '389px',
      })
    })
  }
}

test('content growth keeps the visible shell transition continuous', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/panelHeight.html')
  await expect(page.locator('.control-bar-trigger')).toHaveAttribute('style', /height/)
  const result = await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>('.control-bar-trigger')!
    await Promise.all(shell.getAnimations().map(animation => animation.finished))
    const initial = shell.getBoundingClientRect().height
    document.getElementById('nested-content')!.style.height = '300px'
    const samples: number[] = []
    const start = performance.now()
    while (performance.now() - start < 850) {
      await new Promise(requestAnimationFrame)
      samples.push(shell.getBoundingClientRect().height)
    }
    const end = samples.at(-1)!
    const steps = samples.map((height, index) => height - (samples[index - 1] ?? initial))
    return {
      distance: end - initial,
      distinct: new Set(samples).size,
      maxStep: Math.max(...steps),
      minStep: Math.min(...steps),
      target: shell.style.height,
    }
  })
  expect(result.target).toBe('324px')
  expect(result.distance).toBeGreaterThan(200)
  expect(result.distinct).toBeGreaterThan(8)
  expect(result.minStep).toBeGreaterThanOrEqual(0)
  expect(result.maxStep).toBeLessThan(result.distance / 2)
})

test('panel geometry notifications follow measured changes once, including non-widget content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/panelHeight.html')
  await expect(page.locator('.control-bar-trigger')).toHaveAttribute('style', /height/)
  const result = await page.evaluate(async () => {
    const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame) }
    await settle()
    const initial = window.panelHeightFixture.notifications().length
    document.getElementById('nested-content')!.style.height = '200px'
    await settle()
    const grown = window.panelHeightFixture.notifications().slice(initial)
    window.dispatchEvent(new CustomEvent('gcp-remeasure', { detail: { immediate: true } }))
    window.dispatchEvent(new Event('resize'))
    await settle()
    const repeated = window.panelHeightFixture.notifications().slice(initial)
    window.panelHeightFixture.morph(true)
    document.getElementById('nested-content')!.style.height = '300px'
    await settle()
    const morphing = window.panelHeightFixture.notifications().slice(initial)
    window.panelHeightFixture.morph(false)
    const settled = window.panelHeightFixture.notifications().slice(initial)
    window.panelHeightFixture.stop()
    document.getElementById('nested-content')!.style.height = '400px'
    await settle()
    return { grown, repeated, morphing, settled, stopped: window.panelHeightFixture.notifications().slice(initial) }
  })
  expect(result).toEqual({ grown: ['216px'], repeated: ['216px'], morphing: ['216px'], settled: ['216px', '324px'], stopped: ['216px', '324px'] })
})
