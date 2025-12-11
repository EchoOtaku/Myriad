/**
 * Tapp 图标渲染组件
 * 统一处理 emoji、URL、内联 SVG 三种图标类型
 */

import React from 'react'

/** 图标属性 */
export interface TappIconProps {
  /** emoji 或 URL 图标 */
  icon?: string
  /** 内联 SVG 代码（优先于 icon） */
  iconSvg?: string
  /** 应用名称（用于 fallback 显示首字母） */
  name: string
  /** 图标尺寸 class，如 "w-4 h-4" */
  sizeClass?: string
  /** 字体尺寸 class，如 "text-2xl"（用于 emoji） */
  textSizeClass?: string
  /** 额外的 className */
  className?: string
}

/**
 * 检查字符串是否为 URL（用于区分 emoji 和图片 URL）
 */
export function isIconUrl(icon: string | undefined): boolean {
  if (!icon) return false
  return icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:') || icon.startsWith('/')
}

/**
 * 检查字符串是否为内联 SVG
 */
export function isIconSvg(icon: string | undefined): boolean {
  if (!icon) return false
  return icon.trim().startsWith('<svg')
}

/**
 * 渲染 Tapp 图标
 * 优先级：iconSvg > icon (URL) > icon (emoji) > 名称首字母
 */
export function TappIcon({
  icon,
  iconSvg,
  name,
  sizeClass = 'w-6 h-6',
  textSizeClass = 'text-xl',
  className = '',
}: TappIconProps): React.ReactElement {
  // 1. 优先使用内联 SVG
  if (iconSvg && isIconSvg(iconSvg)) {
    return (
      <span
        className={`inline-flex items-center justify-center ${sizeClass} ${className}`}
        dangerouslySetInnerHTML={{ __html: iconSvg }}
      />
    )
  }

  // 2. 检查 icon 是否为 SVG（兼容旧的使用方式）
  if (icon && isIconSvg(icon)) {
    return (
      <span
        className={`inline-flex items-center justify-center ${sizeClass} ${className}`}
        dangerouslySetInnerHTML={{ __html: icon }}
      />
    )
  }

  // 3. 检查 icon 是否为 URL
  if (icon && isIconUrl(icon)) {
    return (
      <img
        src={icon}
        alt=""
        className={`object-contain ${sizeClass} ${className}`}
      />
    )
  }

  // 4. 使用 emoji
  if (icon) {
    return (
      <span className={`${textSizeClass} ${className}`}>
        {icon}
      </span>
    )
  }

  // 5. Fallback：显示名称首字母
  return (
    <span className={`font-bold ${textSizeClass} ${className}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

export default TappIcon
