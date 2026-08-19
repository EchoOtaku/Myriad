/**
 * Reports page dynamic status: rotating tips + hero title for the unified bar.
 */
export type ReportsTipKind = 'stage' | 'platform' | 'empty'

export interface ReportsDynamicTip {
  id: string
  /** Large background hero title — decorative Latin word, never localized */
  hero: string
  main: string
  sub: string
  kind: ReportsTipKind
  /** Platform id for stage tip icon lookup */
  platformId?: string
}

export interface ReportsStatusCopy {
  /** Hero word for the report tips — decorative Latin, never localized */
  heroStage: string
  platformReport: string
  clickToView: string
  noEnabledPlatforms: string
  stagePlaying: string
  stagePaused: string
  tipPlatformCount: string
  tipPlatformCountSub: string
  tipReportReady: string
  tipReportReadySub: string
  tipNoReports: string
  tipNoReportsSub: string
}

export interface BuildReportsTipsInput {
  copy: ReportsStatusCopy
  isStageMode: boolean
  stagePaused: boolean
  stagePlatformId?: string | null
  stagePlatformName?: string | null
  /** Latin platform name for the hero — display names get localized to CJK */
  stagePlatformHero?: string | null
  enabledPlatformCount: number
  reportCount: number
}

export function buildReportsDynamicTips(
  input: BuildReportsTipsInput,
): ReportsDynamicTip[] {
  const {
    copy,
    isStageMode,
    stagePaused,
    stagePlatformId,
    stagePlatformName,
    stagePlatformHero,
    enabledPlatformCount,
    reportCount,
  } = input

  // Stage locks the tip carousel — one focused status.
  if (isStageMode && stagePlatformName) {
    return [
      {
        id: `stage-${stagePlatformId || 'unknown'}`,
        hero: stagePlatformHero || stagePlatformName,
        main: stagePlatformName,
        sub: stagePaused ? copy.stagePaused : copy.stagePlaying,
        kind: 'stage',
        platformId: stagePlatformId || undefined,
      },
    ]
  }

  const tips: ReportsDynamicTip[] = []

  if (enabledPlatformCount === 0) {
    tips.push({
      id: 'empty-platforms',
      hero: copy.heroStage,
      main: copy.platformReport,
      sub: copy.noEnabledPlatforms,
      kind: 'empty',
    })
  } else if (reportCount === 0) {
    tips.push({
      id: 'no-reports',
      hero: copy.heroStage,
      main: copy.tipNoReports,
      sub: copy.tipNoReportsSub,
      kind: 'empty',
    })
  } else {
    tips.push({
      id: 'platform-ready',
      hero: copy.heroStage,
      main: copy.tipReportReady.replace('{count}', String(reportCount)),
      sub: copy.tipReportReadySub,
      kind: 'platform',
    })

    // Every platform already has a report → "N reports ready" and
    // "N data platforms" are the same sentence twice. Only carry the
    // platform count when it actually says something new.
    if (enabledPlatformCount !== reportCount) {
      tips.push({
        id: 'platform-count',
        hero: copy.heroStage,
        main: copy.tipPlatformCount.replace(
          '{count}',
          String(enabledPlatformCount),
        ),
        sub: copy.tipPlatformCountSub || copy.clickToView,
        kind: 'platform',
      })
    }
  }

  return tips
}
