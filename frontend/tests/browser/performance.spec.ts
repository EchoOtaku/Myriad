import { expect, test } from '@playwright/test'

interface PerformanceFixture {
  now: () => number
  mountWidgetSize: () => () => void
  scheduleTask: (callback: () => void) => void
  mountRipple: () => () => void
  mountIframeSize: () => () => void
  coordinator: typeof import('../../src/hooks/animation/coordinator').coordinator
  mountWallpaper: (fps: number) => () => void
  observeResizeAtomic: PerformanceFixture['observeResize']
  observeResize: (element: Element, callback: (entry: ResizeObserverEntry) => void) => () => void
  renders: () => number
  publish: (detail: Record<string, unknown>) => void
  sharedEventManager: {
    add: (event: string, callback: (event: Event) => void, options: { throttle: boolean }) => () => void
    clear: () => void
    getStats: () => Record<string, number>
  }
}

declare global {
  interface Window {
    performanceFixture: PerformanceFixture
  }
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {} }),
  }))
  await page.goto('/performance.html')
  await expect(page.locator('#music')).toHaveText('false:-1')
})

test('music consumers ignore duplicate and progress-only snapshots, but receive actual changes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fixture = window.performanceFixture
    const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await settle()
    const before = fixture.renders()
    for (let index = 0; index < 100; index++) {
      fixture.publish({ isPlaying: false, currentLyricIndex: -1 })
      fixture.publish({ currentTime: index, audioDuration: 200 })
    }
    await settle()
    return { before, after: fixture.renders() }
  })
  expect(result.after).toBe(result.before)
  await page.evaluate(() => window.performanceFixture.publish({ isPlaying: true, currentLyricIndex: 3 }))
  await expect(page.locator('#music')).toHaveText('true:3')
  await page.evaluate(() => window.performanceFixture.publish({ isPlaying: false }))
  await expect(page.locator('#music')).toHaveText('false:3')
})

test('removed throttled listeners cannot deliver an old frame to a new subscriber', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const manager = window.performanceFixture.sharedEventManager
    const event = 'performance-regression-event'
    let calls = 0
    const remove = manager.add(event, () => {}, { throttle: true })
    window.dispatchEvent(new Event(event))
    remove()
    const removeNext = manager.add(event, () => calls++, { throttle: true })
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const staleCalls = calls
    window.dispatchEvent(new Event(event))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    removeNext()
    return { staleCalls, calls, remaining: manager.getStats()[event] ?? 0 }
  })
  expect(result).toEqual({ staleCalls: 0, calls: 1, remaining: 0 })
})

// Exercise actual layout/ResizeObserver delivery, including subpixel final
// changes and cancellation before the next paint.
for (const observer of ['observeResize', 'observeResizeAtomic'] as const) {
test(`${observer}: animated geometry follows every rendered step and settles at the exact size`, async ({ page }) => {
  const result = await page.evaluate(async observer => {
    const element = document.createElement('div')
    element.style.cssText = 'width:100px;height:10px'
    document.body.append(element)
    const widths: number[] = []
    const stop = window.performanceFixture[observer](element, entry => widths.push(entry.contentRect.width))
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await frame()
    await frame()
    await frame()
    const initial = widths.length
    for (let step = 1; step <= 24; step++) {
      element.style.width = `${100 + step / 2}px`
      await frame()
    }
    await frame()
    await frame()
    const final = widths.at(-1)
    const updates = widths.length - initial
    stop()
    element.style.width = '200px'
    await frame()
    await frame()
    const afterStop = widths.at(-1)
    element.remove()
    return { final, updates, afterStop }
  }, observer)
  expect(result.final).toBe(112)
  expect(result.updates).toBeGreaterThanOrEqual(22)
  expect(result.updates).toBeLessThanOrEqual(24)
  expect(result.afterStop).toBe(112)
})

test(`${observer}: resize bursts deliver only the latest geometry and cancellation drops pending work`, async ({ page }) => {
  const result = await page.evaluate(async observer => {
    const NativeObserver = window.ResizeObserver
    let deliver: ResizeObserverCallback = () => {}
    window.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { deliver = callback }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const element = document.createElement('div')
    const widths: number[] = []
    const observe = window.performanceFixture[observer]
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const send = (width: number) => deliver([
      { target: element, contentRect: { width, height: 10 } } as ResizeObserverEntry,
    ], {} as ResizeObserver)
    const stop = observe(element, entry => widths.push(entry.contentRect.width))
    for (let width = 100; width <= 200; width++) send(width)
    await frame()
    const burst = [...widths]
    send(200)
    await frame()
    const duplicate = [...widths]
    send(201)
    stop()
    const next: number[] = []
    const stopNext = observe(element, entry => next.push(entry.contentRect.width))
    await frame()
    const stale = [...next]
    send(202)
    await frame()
    stopNext()
    window.ResizeObserver = NativeObserver
    return { burst, duplicate, stale, next }
  }, observer)
  expect(result).toEqual({ burst: [200], duplicate: [200], stale: [], next: [202] })
})
}

for (const fps of [30, 60]) {
  test(`wallpaper ${fps} FPS follows the latest pointer, settles, and wakes again`, async ({ page }) => {
    await page.evaluate(fps => window.performanceFixture.mountWallpaper(fps), fps)
    await expect(page.locator('#perf-wallpaper')).toHaveCSS('transform', /matrix/)
    const result = await page.evaluate(fps => {
      const nativeRaf = window.requestAnimationFrame
      const nativeCancel = window.cancelAnimationFrame
      const nativeNow = performance.now.bind(performance)
      let time = nativeNow()
      let id = 0
      const pending = new Map<number, FrameRequestCallback>()
      window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
      window.cancelAnimationFrame = key => { pending.delete(key) }
      performance.now = () => time
      const element = document.getElementById('perf-wallpaper')!
      const pointer = (fraction: number) => document.dispatchEvent(new MouseEvent('mousemove', {
        clientX: innerWidth * fraction, clientY: innerHeight / 2, bubbles: true,
      }))
      const frame = () => {
        time += 1000 / 60
        const callbacks = [...pending.values()]
        pending.clear()
        callbacks.forEach(callback => callback(time))
      }
      try {
        pointer(0.25)
        pointer(0.75)
        const positions: number[] = []
        for (let step = 0; step < 20; step++) {
          frame()
          positions.push(new DOMMatrix(element.style.transform).m41)
        }
        for (let step = 0; step < 220; step++) frame()
        const settled = new DOMMatrix(element.style.transform).m41
        const idleCallbacks = pending.size
        pointer(0.25)
        for (let step = 0; step < 240; step++) frame()
        const resumed = new DOMMatrix(element.style.transform).m41
        const finalCallbacks = pending.size
        pointer(0.75)
        frame()
        frame()
        const beforeHide = new DOMMatrix(element.style.transform).m41
        Object.defineProperty(document, 'hidden', { configurable: true, value: true })
        document.dispatchEvent(new Event('visibilitychange'))
        const hiddenCallbacks = pending.size
        time += 5000
        Object.defineProperty(document, 'hidden', { configurable: true, value: false })
        document.dispatchEvent(new Event('visibilitychange'))
        frame()
        if (fps === 30) frame()
        const resumeStep = Math.abs(new DOMMatrix(element.style.transform).m41 - beforeHide)
        for (let step = 0; step < 240; step++) frame()
        return {
          updates: new Set(positions).size,
          settled,
          idleCallbacks,
          resumed,
          finalCallbacks,
          hiddenCallbacks,
          resumeStep,
          fps,
        }
      } finally {
        window.requestAnimationFrame = nativeRaf
        window.cancelAnimationFrame = nativeCancel
        performance.now = nativeNow
        Reflect.deleteProperty(document, 'hidden')
      }
    }, fps)
    expect(result.updates).toBeGreaterThanOrEqual(fps === 60 ? 18 : 9)
    expect(result.updates).toBeLessThanOrEqual(fps === 60 ? 20 : 11)
    // scale(1.02) also scales the 4px translation.
    expect(result.settled).toBeCloseTo(-4.08, 2)
    expect(result.resumed).toBeCloseTo(4.08, 2)
    expect(result.idleCallbacks).toBe(0)
    expect(result.finalCallbacks).toBe(0)
    expect(result.hiddenCallbacks).toBe(0)
    expect(result.resumeStep).toBeGreaterThan(0)
    expect(result.resumeStep).toBeLessThan(fps === 60 ? 0.8 : 1.5)
  })
}

test('priority waits for a free animation slot without skipping visible work', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const coordinator = window.performanceFixture.coordinator
    coordinator.updateConfig({ baseConcurrent: 2, burstConcurrent: 2 })
    coordinator.completePageTransition()
    const ids = ['visible-a', 'visible-b', 'queued-element', 'queued-section']
    const notifications: string[] = []
    const stop = coordinator.subscribe(ids[0], state => notifications.push(state))
    try {
      for (const id of ids.slice(0, 2)) {
        coordinator.schedule({ id, priority: 3 })
        coordinator.markRunning(id)
      }
      await Promise.resolve()
      coordinator.schedule({ id: ids[2], priority: 3 })
      const section = coordinator.schedule({ id: ids[3], priority: 1 })
      await Promise.resolve()
      const running = ids.slice(0, 2).map(id => coordinator.getState(id))
      coordinator.markCompleted(ids[0])
      const afterFirst = ids.slice(2).map(id => coordinator.getState(id))
      coordinator.markCompleted(ids[1])
      const afterSecond = coordinator.getState(ids[2])
      return { section, running, afterFirst, afterSecond, notifications }
    } finally {
      stop()
      for (const id of ids) coordinator.markCompleted(id)
      coordinator.updateConfig({ baseConcurrent: 16, burstConcurrent: 48 })
    }
  })
  expect(result.section).toBe('scheduled')
  expect(result.running).toEqual(['running', 'running'])
  expect(result.afterFirst).toEqual(['scheduled', 'ready'])
  expect(result.afterSecond).toBe('ready')
  expect(result.notifications).not.toContain('skipped')
})

test('TAPP resize settles small changes across compact and mini breakpoints', async ({ page }) => {
  await page.evaluate(() => { window.performanceFixture.mountIframeSize() })
  const output = page.locator('#iframe-size')
  await expect(output).toHaveText('151:false:false')
  await page.locator('#iframe-size-container').evaluate(el => { el.style.width = '149px' })
  await expect(output).toHaveText('149:true:false')
  await page.locator('#iframe-size-container').evaluate(el => { el.style.width = '101px' })
  await expect(output).toHaveText('101:true:false')
  await page.locator('#iframe-size-container').evaluate(el => { el.style.width = '99px' })
  await expect(output).toHaveText('99:true:true')
  await page.locator('#iframe-size-container').evaluate(el => { el.style.width = '99.5px' })
  await expect(output).toHaveText('99.5:true:true')
})

for (const width of [390, 1440]) {
  test(`ripple rendering cadence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => { window.performanceFixture.mountRipple() })
    await expect(page.locator('#wallpaper-ripple-canvas')).toBeAttached()
    const result = await page.evaluate(async () => {
      const original = CanvasRenderingContext2D.prototype.putImageData
      const frames: number[] = []
      const tasks: number[] = []
      const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)))
      observer.observe({ type: 'longtask' })
      CanvasRenderingContext2D.prototype.putImageData = function (image, x, y) {
        if (this.canvas.id === 'wallpaper-ripple-canvas') frames.push(performance.now())
        original.call(this, image, x, y)
      }
      try {
        document.getElementById('wallpaper')!.dispatchEvent(new MouseEvent('click', {
          clientX: innerWidth / 2, clientY: 100, bubbles: true,
        }))
        await new Promise(resolve => setTimeout(resolve, 2600))
        const gaps = frames.slice(1).map((time, index) => time - frames[index]).sort((a, b) => a - b)
        return {
          frames: frames.length,
          p95Ms: gaps[Math.floor(gaps.length * 0.95)],
          maxGapMs: gaps.at(-1),
          longTasks: tasks.length,
          maxLongTaskMs: Math.max(0, ...tasks),
        }
      } finally {
        observer.disconnect()
        CanvasRenderingContext2D.prototype.putImageData = original
      }
    })
    expect(result.frames).toBeGreaterThan(30)
    await expect(page.locator('#wallpaper-ripple-canvas')).toHaveCSS('opacity', '0')
    await test.info().attach('ripple-cadence', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
    console.log(JSON.stringify({ width, ...result }))
  })
}

test('queued work yields between costly callbacks while animation frames continue', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const completed: number[] = []
    const frames: number[] = []
    const ticks: number[] = []
    let previous = performance.now()
    let raf = 0
    const tick = (time: number) => {
      frames.push(time - previous)
      ticks.push(completed.length)
      previous = time
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    frames.length = 0
    ticks.length = 0
    await new Promise<void>(resolve => {
      for (let index = 0; index < 48; index++) {
        window.performanceFixture.scheduleTask(() => {
          const end = performance.now() + 3
          while (performance.now() < end) { /* Simulate bounded per-card work. */ }
          completed.push(index)
          if (index === 47) resolve()
        })
      }
    })
    await new Promise(requestAnimationFrame)
    cancelAnimationFrame(raf)
    return { completed, maxFrame: Math.max(...frames), frames: frames.length, ticks }
  })
  expect(result.completed).toEqual(Array.from({ length: 48 }, (_, index) => index))
  expect(result.ticks.some(count => count > 0 && count < 48)).toBe(true)
  console.log(JSON.stringify({ taskSlice: result }))
})

for (const preference of ['standard', 'light'] as const) {
  test(`home widget uses stable layout size through entrance and resizes in ${preference} mode`, async ({ page }) => {
    await page.evaluate((mode) => {
      localStorage.setItem('animation-preference', mode)
      window.performanceFixture.mountWidgetSize()
    }, preference)
    await expect(page.locator('#home-observed-widths')).toHaveText('[300]')
    await expect(page.locator('#widget-size')).toHaveText('300:200')
    // No transient 270px measurement from the entrance scale may reach content.
    await expect(page.locator('#widget-size')).toHaveAttribute('data-widths', '[300]')
    await page.evaluate(async () => {
      const element = document.querySelector<HTMLElement>('#widget-transform')!
      await element.animate([{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }], {
        duration: 560, fill: 'forwards',
      }).finished
    })
    await expect(page.locator('#widget-size')).toHaveAttribute('data-widths', '[300]')
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#widget-size-container')!.style.width = '360px'
    })
    await expect(page.locator('#widget-size')).toHaveText('360:200')
    await expect(page.locator('#widget-size')).toHaveAttribute('data-widths', '[300,360]')
  })
}

test('a newly queued earlier entrance does not wait for the old delayed timer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const coordinator = window.performanceFixture.coordinator
    coordinator.completePageTransition()
    const long = 'late-entrance'
    const short = 'early-entrance'
    coordinator.schedule({ id: long, priority: 3, delay: 800 })
    coordinator.schedule({ id: short, priority: 3, delay: 30 })
    return await new Promise<string | undefined>((resolve) => {
      const stop = coordinator.subscribe(short, state => {
        if (state !== 'ready') return
        const lateState = coordinator.getState(long)
        stop()
        coordinator.markCompleted(short)
        coordinator.markCompleted(long)
        resolve(lateState)
      })
    })
  })
  expect(result).toBe('scheduled')
})

test('home widget settles sub-two-pixel layout changes without a stale scale', async ({ page }) => {
  await page.evaluate(() => window.performanceFixture.mountWidgetSize())
  await expect(page.locator('#widget-size')).toHaveText('300:200')
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#widget-size-container')!.style.width = '301px'
  })
  await expect(page.locator('#widget-size')).toHaveText('301:200')
})

test('scheduler time advances across idle gaps', async ({ page }) => {
  const elapsed = await page.evaluate(async () => {
    const before = window.performanceFixture.now()
    await new Promise(resolve => setTimeout(resolve, 60))
    return window.performanceFixture.now() - before
  })
  expect(elapsed).toBeGreaterThanOrEqual(40)
})

test('frame-throttled input retains the final pointer position in each burst', async ({ page }) => {
  const positions = await page.evaluate(async () => {
    const positions: number[] = []
    const remove = window.performanceFixture.sharedEventManager.add('audit-pointer', event => {
      positions.push((event as MouseEvent).clientX)
    }, { throttle: true })
    for (const clientX of [10, 20, 30]) window.dispatchEvent(new MouseEvent('audit-pointer', { clientX }))
    await new Promise(requestAnimationFrame)
    remove()
    return positions
  })
  expect(positions).toEqual([30])
})
