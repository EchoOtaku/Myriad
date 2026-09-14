/** 不进 skin。 */

export function trackPhantasi(
  event: 'PHANTASI_OPEN_ITEM' | 'PHANTASI_STAR' | 'PHANTASI_UNSTAR',
  target: number,
  throttleMs: number,
): void {
  void import('../../utils/analyticsEvents').then(
    ({ trackProductEvent, AnalyticsEvents }) => {
      trackProductEvent(AnalyticsEvents[event], { target, throttleMs })
    },
  )
}
