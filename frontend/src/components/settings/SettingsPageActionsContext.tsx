/**
 * 设置页级操作（当前页重置等），由 ConfigForm 按 activeSection 注入。
 */

import React, { createContext, useContext } from 'react'

export interface SettingsPageActionsContextValue {
  /** 重置当前设置页（默认值 + 保存相关部分） */
  resetCurrentPage?: () => void | Promise<void>
  /** 是否允许重置本页；about 等只读页为 false */
  canResetCurrentPage?: boolean
  /**
   * 移动端选项页 → 菜单的返回。有值时 SettingSection 标题栏显示与
   * 平台二级页一致的 `section-header-back`（显式 headerLeading 优先，
   * 用于二级页先回到列表）。
   */
  onMobileBack?: () => void
}

const SettingsPageActionsContext =
  createContext<SettingsPageActionsContextValue | null>(null)

export function useSettingsPageActions(): SettingsPageActionsContextValue | null {
  return useContext(SettingsPageActionsContext)
}

export const SettingsPageActionsProvider: React.FC<{
  value: SettingsPageActionsContextValue
  children: React.ReactNode
}> = ({ value, children }) => (
  <SettingsPageActionsContext.Provider value={value}>
    {children}
  </SettingsPageActionsContext.Provider>
)
