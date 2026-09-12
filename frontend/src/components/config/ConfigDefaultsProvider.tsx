import type { ReactNode } from 'react'
import { SettingsDefaultsProvider } from '../settings/SettingsDefaultsContext'
import {
  dismissSettingDefaultChange,
  getSettingDefaultChangeNotice,
  subscribeSettingDefaultChanges,
} from './settingDefaultChanges'

const source = {
  getNotice: getSettingDefaultChangeNotice,
  dismiss: dismissSettingDefaultChange,
  subscribe: subscribeSettingDefaultChanges,
}
export function ConfigDefaultsProvider({ children }: { children: ReactNode }) {
  return (
    <SettingsDefaultsProvider value={source}>
      {children}
    </SettingsDefaultsProvider>
  )
}
