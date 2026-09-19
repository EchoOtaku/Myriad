import { expect, test } from '@playwright/test'

// Exercise the real component, shared scroll/resize delivery and production CSS.
test('scrollbar follows immediate route scrolling and fresh content geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/scrollbar.html')
  const thumb = page.getByRole('scrollbar')
  await expect(thumb).toBeAttached()
  const result = await page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>('[role="scrollbar"]')!
    const frames = async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame)
    }
    await frames()
    const initialHeight = Number.parseFloat(element.style.height)
    // Navigate and scroll before the old 1150ms lock could have elapsed.
    ;(window as unknown as { scrollbarFixture: { navigate: (path: string) => void } }).scrollbarFixture.navigate('/scrollbar-next')
    await frames()
    window.scrollTo({ top: 600, behavior: 'instant' })
    await frames()
    const moved = Number.parseFloat(element.style.top)
    const transition = element.style.transition
    // Keep the height cache fresh, then grow the document without another scroll.
    document.getElementById('scrollbar-content')!.style.height = '4800px'
    await frames()
    const grownHeight = Number.parseFloat(element.style.height)
    const grownTop = Number.parseFloat(element.style.top)
    return { initialHeight, moved, transition, grownHeight, grownTop }
  })
  expect(result.moved).toBeGreaterThan(0)
  expect(result.transition).toBe('none')
  expect(result.grownHeight).toBeCloseTo(result.initialHeight / 2, 1)
  expect(result.grownTop).toBeGreaterThan(0)
  expect(result.grownTop).toBeLessThan(result.moved)
})

test('layout observation does not cut a route thumb transition short', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/scrollbar.html')
  await expect(page.getByRole('scrollbar')).toBeAttached()
  const result = await page.evaluate(async () => {
    const thumb = document.querySelector<HTMLElement>('[role="scrollbar"]')!
    const frames = async (count = 3) => {
      for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame)
    }
    await frames()
    await Promise.all(thumb.getAnimations().map(animation => animation.finished))
    const initial = thumb.getBoundingClientRect().height
    // Start the route transition before the shared ResizeObserver delivers.
    ;(window as unknown as { scrollbarFixture: { navigate: (path: string) => void } }).scrollbarFixture.navigate('/route-height')
    await frames()
    document.getElementById('scrollbar-content')!.style.height = '4800px'
    await frames()
    return {
      initial,
      current: thumb.getBoundingClientRect().height,
      target: Number.parseFloat(thumb.style.height),
      transition: thumb.style.transition,
    }
  })
  expect(result.transition).not.toBe('none')
  expect(result.current).toBeGreaterThan(result.target + 1)
  expect(result.current).toBeLessThanOrEqual(result.initial)
})
