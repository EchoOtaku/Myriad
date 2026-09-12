import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

export interface SettingDefaultChangeNotice {
  fieldKey: string
  from: string
  to: string
  transitionId: string
}
export interface SettingsDefaultsSource {
  getNotice: (fieldKey?: string | null) => SettingDefaultChangeNotice | null
  dismiss: (fieldKey?: string | null) => void
  subscribe: (listener: () => void) => () => void
}
const SettingsDefaultsContext = createContext<SettingsDefaultsSource | null>(
  null,
)

/** Product policy is supplied by the containing editor; primitives have no global defaults. */
export function SettingsDefaultsProvider({
  value,
  children,
}: {
  value: SettingsDefaultsSource
  children: ReactNode
}) {
  return (
    <SettingsDefaultsContext.Provider value={value}>
      {children}
    </SettingsDefaultsContext.Provider>
  )
}
export function useSettingsDefaults() {
  return useContext(SettingsDefaultsContext)
}
