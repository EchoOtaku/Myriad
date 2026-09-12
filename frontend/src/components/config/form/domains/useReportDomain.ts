import {
  areReportSettingsEqual,
  DEFAULT_REPORT_SETTINGS,
  fetchReportSettings,
  updateReportSettings,
} from '../../../../utils/reportSettings'
import { useConfigDomain } from '../useConfigDomain'

export function useReportDomain() {
  return useConfigDomain({
    id: 'reports',
    sections: ['modules'],
    initial: DEFAULT_REPORT_SETTINGS,
    equal: areReportSettingsEqual,
    load: fetchReportSettings,
    persist: updateReportSettings,
    reset: (_saved, scope) =>
      scope === 'modules' || scope === 'all'
        ? structuredClone(DEFAULT_REPORT_SETTINGS)
        : undefined,
  })
}
