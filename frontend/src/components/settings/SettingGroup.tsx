/**
 * 设置分组组件
 * 用于将相关设置项组织在一起
 *
 * 位于 SettingGroupGrid 内时：
 * - stretch（默认）：卡片 height:100% 与同排同高
 * - rows：额外展开为 subgrid 单元，内部区块跨列对齐
 *
 * 详细说明：detail / description 默认以标题旁 ⓘ tooltip 展示（不常显）
 */

import type { SettingGroupConfig } from './types'
import React, { useEffect, useMemo, useRef } from 'react'
import { CollapseRegion } from './CollapseRegion'
import { useSettingGroupGrid } from './SettingGroupGrid'
import { useSettingsHelp } from './SettingsHelpContext'
import { SettingItem } from './SettingItem'
import { SettingTitleGuideEntry } from './SettingTitleGuideEntry'
import { SettingTitleHelp } from './SettingTitleHelp'
import { ToggleSwitch } from './items/ToggleSwitch'
import './SettingGroup.css'

export interface SettingGroupProps extends SettingGroupConfig {}

export const SettingGroup: React.FC<SettingGroupProps> = ({
  title,
  titleExtra,
  switch: switchConfig,
  detail,
  guide,
  detailTone = 'default',
  description,
  descriptionVisible = false,
  icon,
  items,
  children,
  collapsible = false,
  defaultExpanded = true,
  className = '',
}) => {
  const gridCtx = useSettingGroupGrid()
  const helpCtx = useSettingsHelp()
  const inGrid = Boolean(gridCtx?.inGrid)
  /** 折叠与 subgrid 冲突，网格 rows 模式忽略 collapsible */
  const useSubgrid = Boolean(gridCtx?.alignRows) && !collapsible
  const expandHelp = Boolean(helpCtx?.showDetails)

  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (buttonRef.current) {
      buttonRef.current.setAttribute('aria-expanded', String(isExpanded))
    }
  }, [isExpanded])

  const handleToggle = React.useCallback(() => {
    if (collapsible) {
      setIsExpanded((prev) => !prev)
    }
  }, [collapsible])

  /** 说明内容：detail 优先，否则 description */
  const helpContent = detail ?? description
  const showHelp = helpContent != null && helpContent !== ''
  /** 页级开关开启或显式 descriptionVisible → 标题下常显 */
  const showDescriptionLine =
    (descriptionVisible || expandHelp) && showHelp

  const switchEl = switchConfig ? (
    <div className="setting-group-header-switch">
      <ToggleSwitch
        checked={switchConfig.checked}
        onChange={switchConfig.onChange}
        disabled={!!switchConfig.disabled || !!switchConfig.loading}
        aria-label={
          switchConfig.ariaLabel ||
          (typeof title === 'string' ? title : undefined)
        }
      />
    </div>
  ) : null

  const titleRow =
    title || titleExtra || showHelp ? (
      <h4 className="setting-group-title">
        {icon && (
          <span className="setting-group-icon">
            {typeof icon === 'string' ? icon : icon}
          </span>
        )}
        {title && (
          <span className="setting-group-title-text">
            {title}
            {showHelp && !expandHelp && (
              <SettingTitleHelp
                ariaLabel={`${title} 详细说明`}
                tone={detailTone}
              >
                {helpContent}
              </SettingTitleHelp>
            )}
            {/* 显示说明开启：指南入口（弹窗）；guide → detail → description */}
            <SettingTitleGuideEntry
              title={typeof title === 'string' ? title : ''}
              guide={guide ?? detail ?? description}
            />
          </span>
        )}
        {!title && showHelp && !expandHelp && (
          <SettingTitleHelp ariaLabel="详细说明" tone={detailTone}>
            {helpContent}
          </SettingTitleHelp>
        )}
        {!collapsible && titleExtra}
      </h4>
    ) : null

  const descriptionEl = showDescriptionLine ? (
    <div
      className={`setting-group-description${
        detailTone === 'warning' ? ' is-warning' : ''
      }`}
    >
      {helpContent}
    </div>
  ) : null

  const showHeader = Boolean(
    title || titleExtra || showHelp || showDescriptionLine || switchConfig,
  )
  const switchOff = Boolean(switchConfig && !switchConfig.checked)

  const itemNodes = useMemo(
    () =>
      items?.map((itemProps, index) => (
        <SettingItem
          key={`${itemProps.itemKey || 'item'}-${index}`}
          {...itemProps}
        />
      )),
    [items],
  )

  const contentChildCount =
    (items?.length ?? 0) + React.Children.toArray(children).length
  const subgridSpan = (showHeader ? 1 : 0) + contentChildCount
  const showContent = !collapsible || isExpanded

  const header = showHeader ? (
    collapsible ? (
      <div className="setting-group-header setting-group-header--with-extra">
        <button
          ref={buttonRef}
          type="button"
          className="setting-group-header-toggle"
          onClick={handleToggle}
          aria-label={
            title ? `${isExpanded ? '收起' : '展开'} ${title}` : undefined
          }
        >
          <div className="setting-group-header-content">
            {titleRow}
            {descriptionEl}
          </div>
          <span
            className={`setting-group-chevron ${isExpanded ? 'expanded' : ''}`}
            aria-hidden
          >
            <svg
              className="setting-group-chevron-icon"
              viewBox="0 0 12 10"
              width="10"
              height="8"
              focusable="false"
            >
              {/* 实心全圆角三角（展开指向下） */}
              <path
                fill="currentColor"
                d="M2.35 1.15h7.3c.78 0 1.22.88.76 1.52L7.1 7.55c-.52.72-1.68.72-2.2 0L1.59 2.67c-.46-.64-.02-1.52.76-1.52Z"
              />
            </svg>
          </span>
        </button>
        {titleExtra && (
          <div className="setting-group-title-extra">{titleExtra}</div>
        )}
        {switchEl}
      </div>
    ) : (
      <div
        className={`setting-group-header${
          switchEl ? ' setting-group-header--with-switch' : ''
        }`}
      >
        <div className="setting-group-header-content">
          {titleRow}
          {descriptionEl}
        </div>
        {switchEl}
      </div>
    )
  ) : null

  return (
    <div
      className={[
        'setting-group',
        collapsible ? 'is-collapsible' : '',
        collapsible && !isExpanded ? 'is-collapsed' : '',
        collapsible && isExpanded ? 'is-expanded' : '',
        switchOff ? 'is-switch-off' : '',
        inGrid ? 'setting-group--in-grid' : '',
        useSubgrid ? 'setting-group--subgrid' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        useSubgrid && subgridSpan > 0
          ? ({
              gridRow: `1 / span ${subgridSpan}`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {header}

      {useSubgrid ? (
        showContent && (
          <>
            {itemNodes}
            {children}
          </>
        )
      ) : collapsible ? (
        /* 折叠组走高度动画；收起动画播完才卸载内容 */
        <CollapseRegion open={isExpanded}>
          <div className="setting-group-content">
            {itemNodes}
            {children}
          </div>
        </CollapseRegion>
      ) : (
        <div className="setting-group-content">
          {itemNodes}
          {children}
        </div>
      )}
    </div>
  )
}

SettingGroup.displayName = 'SettingGroup'
