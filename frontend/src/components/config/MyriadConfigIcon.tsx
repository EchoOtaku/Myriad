import React from 'react'

export type MyriadConfigIconKind =
  | 'platforms'
  | 'data'
  | 'ai'
  | 'ui'
  | 'music'
  | 'oauth'
  | 'network'
  | 'permissions'
  | 'notifications'
  | 'modules'
  | 'advanced'
  | 'about'
  | 'users'
  | 'federation'

interface MyriadConfigIconProps {
  kind: MyriadConfigIconKind
  className?: string
}

const SHARED_CONFIG_ICON_ASSETS: Partial<Record<MyriadConfigIconKind, string>> =
  {
    ui: '/icons/control-panel/config.webp',
    music: '/icons/dynamic/music.webp',
    // Same icon as notification center federation source
    federation: '/icons/notifications/aro.webp',
  }

/**
 * Myriad 设置页专用彩绘 PNG 图标。
 * 同一资产会在分类导航和分类标题中按容器尺寸显示。
 */
export const MyriadConfigIcon = React.memo<MyriadConfigIconProps>(
  ({ kind, className = '' }) => {
    const src = SHARED_CONFIG_ICON_ASSETS[kind] ?? `/icons/config/${kind}.webp`

    return (
      <img
        className={`myriad-config-icon ${className}`.trim()}
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    )
  },
)

MyriadConfigIcon.displayName = 'MyriadConfigIcon'

export default MyriadConfigIcon
