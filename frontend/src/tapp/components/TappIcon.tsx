/**
 * Tapp 图标渲染组件
 * 统一处理 emoji、URL、内联 SVG 三种图标类型
 */

import React, { useMemo } from 'react'

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
 * 规范化 SVG 以确保 WebKit/Safari 兼容性
 * - 添加 xmlns 属性（如果缺失）
 * - 添加 width/height 100% 确保填充容器
 * - 确保 fill="currentColor" 样式继承
 */
function normalizeSvg(svg: string): string {
  let normalized = svg.trim()
  
  // 添加 xmlns（如果缺失）
  if (!normalized.includes('xmlns=')) {
    normalized = normalized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  
  // 确保 SVG 有 width 和 height 以填充容器
  if (!normalized.includes('width=')) {
    normalized = normalized.replace('<svg', '<svg width="100%" height="100%"')
  }
  
  // 添加 style 确保颜色继承（WebKit 兼容）
  if (!normalized.includes('style=')) {
    normalized = normalized.replace('<svg', '<svg style="display:block;color:inherit"')
  }
  
  return normalized
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
  // 规范化 SVG（使用 useMemo 避免重复计算）
  const normalizedSvg = useMemo(() => {
    if (iconSvg && isIconSvg(iconSvg)) {
      return normalizeSvg(iconSvg)
    }
    if (icon && isIconSvg(icon)) {
      return normalizeSvg(icon)
    }
    return null
  }, [iconSvg, icon])

  // 1. 优先使用内联 SVG
  if (normalizedSvg) {
    return (
      <span
        className={`inline-flex items-center justify-center ${sizeClass} ${className}`}
        style={{ color: 'inherit' }}
        dangerouslySetInnerHTML={{ __html: normalizedSvg }}
      />
    )
  }

  // 2. 检查 icon 是否为 URL
  if (icon && isIconUrl(icon)) {
    return (
      <img
        src={icon}
        alt=""
        className={`object-contain ${sizeClass} ${className}`}
      />
    )
  }

  // 3. 使用 emoji
  if (icon) {
    return (
      <span className={`${textSizeClass} ${className}`}>
        {icon}
      </span>
    )
  }

  // 4. Fallback：显示名称首字母
  return (
    <span className={`font-bold ${textSizeClass} ${className}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

export default TappIcon
