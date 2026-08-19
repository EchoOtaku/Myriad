import type { ReportsStatusCopy } from './reportsDynamicStatus'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReportsDynamicTips } from './reportsDynamicStatus'

const copy: ReportsStatusCopy = {
  heroStage: 'Stage',
  platformReport: 'Platform Reports',
  clickToView: 'Click card to view',
  noEnabledPlatforms: 'No platforms',
  stagePlaying: 'Playing on stage',
  stagePaused: 'Stage paused',
  tipPlatformCount: '{count} data platforms',
  tipPlatformCountSub: 'Click a card',
  tipReportReady: '{count} reports ready',
  tipReportReadySub: 'Play all',
  tipNoReports: 'No reports yet',
  tipNoReportsSub: 'Generate below',
}

test('stage mode locks tip carousel to platform', () => {
  const tips = buildReportsDynamicTips({
    copy,
    isStageMode: true,
    stagePaused: false,
    stagePlatformId: 'steam',
    stagePlatformName: 'Steam',
    enabledPlatformCount: 3,
    reportCount: 2,
  })

  assert.equal(tips.length, 1)
  assert.equal(tips[0].kind, 'stage')
  assert.equal(tips[0].hero, 'Steam')
  assert.equal(tips[0].sub, 'Playing on stage')
})

test('stage paused updates subtitle', () => {
  const tips = buildReportsDynamicTips({
    copy,
    isStageMode: true,
    stagePaused: true,
    stagePlatformId: 'github',
    stagePlatformName: 'GitHub',
    enabledPlatformCount: 1,
    reportCount: 1,
  })
  assert.equal(tips[0].sub, 'Stage paused')
})

test('stage hero uses the latin platform name, main keeps the localized one', () => {
  const [tip] = buildReportsDynamicTips({
    copy,
    isStageMode: true,
    stagePaused: false,
    stagePlatformId: 'netease',
    stagePlatformName: '网易云',
    stagePlatformHero: 'NetEase Music',
    enabledPlatformCount: 1,
    reportCount: 1,
  })

  assert.equal(tip.hero, 'NetEase Music')
  assert.equal(tip.main, '网易云')
})

test('platform count tip is dropped when it repeats the report count', () => {
  const allCovered = buildReportsDynamicTips({
    copy,
    isStageMode: false,
    stagePaused: false,
    enabledPlatformCount: 9,
    reportCount: 9,
  })
  assert.deepEqual(
    allCovered.map((t) => t.id),
    ['platform-ready'],
  )

  const partial = buildReportsDynamicTips({
    copy,
    isStageMode: false,
    stagePaused: false,
    enabledPlatformCount: 9,
    reportCount: 4,
  })
  assert.deepEqual(
    partial.map((t) => t.id),
    ['platform-ready', 'platform-count'],
  )
})
