import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

describe('long-task guards', () => {
  it('observes longtask while the perf monitor is collapsed', () => {
    const metrics = readFileSync(
      new URL('../hooks/usePerfMetrics.ts', import.meta.url),
      'utf8',
    )
    assert.match(metrics, /type: 'longtask', buffered: true/)
    assert.match(metrics, /type: 'long-animation-frame', buffered: true/)
    const longtaskAt = metrics.indexOf("type: 'longtask', buffered: true")
    const expandedGateAt = metrics.indexOf(
      "if (!isExpanded || !('PerformanceObserver'",
    )
    assert.ok(longtaskAt >= 0)
    assert.ok(expandedGateAt > longtaskAt)
  })

  it('does not drain idle or MessageChannel work in one timeout', () => {
    const core = readFileSync(
      new URL('../hooks/animation/core.ts', import.meta.url),
      'utf8',
    )
    const coordinator = readFileSync(
      new URL('../hooks/animation/coordinator.ts', import.meta.url),
      'utf8',
    )
    assert.match(core, /runIdleSlice/)
    assert.match(coordinator, /runIdleSlice/)
    assert.match(core, /TASK_FLUSH_BATCH/)
    assert.equal(core.includes('deadline.didTimeout)'), false)
    assert.equal(coordinator.includes('deadline.didTimeout)'), false)
  })

  it('yields code highlight, math, and feed color extraction', () => {
    const highlight = readFileSync(
      new URL('./codeHighlight.ts', import.meta.url),
      'utf8',
    )
    const math = readFileSync(
      new URL('../components/phantasi/notes/renderMath.ts', import.meta.url),
      'utf8',
    )
    const tile = readFileSync(
      new URL(
        '../components/phantasi/tiles/PhantasiSourceTile.tsx',
        import.meta.url,
      ),
      'utf8',
    )
    const social = readFileSync(
      new URL(
        '../components/widgets/reportCard/platforms/social.tsx',
        import.meta.url,
      ),
      'utf8',
    )
    assert.match(highlight, /yieldIfSliceExceeded/)
    assert.match(math, /yieldIfSliceExceeded/)
    assert.match(tile, /runWhenIdle/)
    assert.match(social, /runWhenIdle/)
  })
})
