import {
  BangumiIcon,
  FaGithub,
  FaSteam,
  FaXbox,
  FaXTwitter,
  SiBilibili,
  SiDiscord,
  SiMyanimelist,
  SiNeteasecloudmusic,
  SiPlaystation,
} from '@lib/icons'

import React from 'react'

interface PlatformIconProps {
  platform: string
  className?: string
  style?: React.CSSProperties
}

/**
 * ✅ PlatformIcon 组件 - 已使用 React.memo 优化
 * 只在 props 变化时重新渲染
 */
const PlatformIcon: React.FC<PlatformIconProps> = React.memo(
  ({ platform, className = 'w-6 h-6', style }) => {
    switch (platform.toLowerCase()) {
      case 'github':
        return <FaGithub className={className} style={style} />
      case 'bilibili':
        return <SiBilibili className={className} style={style} />
      case 'steam':
        return <FaSteam className={className} style={style} />
      case 'netease music':
      case 'netease':
      case '网易云音乐':
        return <SiNeteasecloudmusic className={className} style={style} />
      case 'bangumi':
        return <BangumiIcon className={className} style={style} />
      case 'mal':
      case 'myanimelist':
        return <SiMyanimelist className={className} style={style} />
      case 'x':
      case 'twitter':
      case 'x (twitter)':
        return <FaXTwitter className={className} style={style} />
      case 'discord':
        return <SiDiscord className={className} style={style} />
      case 'xbox':
        return <FaXbox className={className} style={style} />
      case 'psn':
      case 'playstation':
        return <SiPlaystation className={className} style={style} />
      default:
        return (
          <span className={className} style={style}>
            ?
          </span>
        )
    }
  },
)

PlatformIcon.displayName = 'PlatformIcon'

export default PlatformIcon
