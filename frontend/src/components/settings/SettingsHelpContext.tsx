/**
 * 每个设置页（SettingSection）右上角「显示说明」开关状态。
 * 开启后：标题/分组说明常显；选项标题旁出现指南入口（弹窗）。
 * 关闭后：仅 ⓘ hover 查看短说明。
 */

import type { ReactNode } from 'react'
import React, { createContext, useContext } from 'react'

export interface SettingsGuidePayload {
  title: string
  body: ReactNode
}

export interface SettingsHelpContextValue {
  /** 是否展开说明（常显 detail / description）并显示指南入口 */
  showDetails: boolean
  setShowDetails: (value: boolean) => void
  /** 打开选项详细指南弹窗（仅 SettingSection 提供实现） */
  openGuide?: (payload: SettingsGuidePayload) => void
  closeGuide?: () => void
  activeGuide?: SettingsGuidePayload | null
}

const SettingsHelpContext = createContext<SettingsHelpContextValue | null>(
  null,
)

export function useSettingsHelp(): SettingsHelpContextValue | null {
  return useContext(SettingsHelpContext)
}

export const SettingsHelpProvider: React.FC<{
  value: SettingsHelpContextValue
  children: React.ReactNode
}> = ({ value, children }) => (
  <SettingsHelpContext.Provider value={value}>
    {children}
  </SettingsHelpContext.Provider>
)
