/**
 * Unified Tapp app-icon badge — **default** icon presentation for all surfaces
 * (store, dock, launchpad, list, widgets, chrome).
 *
 * - Full-color bitmap / SVG → full-bleed standalone (no shell)
 * - Glyph / emoji / monochrome SVG → material multi-stop shell + white glyph
 * - Optional `iconShell: true` → custom full-color art keeps material shell
 *
 * Always uses the app's own icon / iconSvg (no host redraw).
 */

import type { CSSProperties, ReactNode } from 'react'
import type { IconStyle, TappIconStyleSource } from '../utils/tappColors'
import { getTappIconStyle } from '../utils/tappColors'
import { TappIcon } from './TappIcon'

export interface TappIconBadgeProps extends TappIconStyleSource {
  name: string
  /** Outer shell size / shape classes, e.g. "w-14 h-14 rounded-xl" */
  shellClassName: string
  /** Glyph size when not standalone; standalone always fills the shell */
  glyphSizeClass: string
  glyphTextClass?: string
  /** Precomputed style (avoids recompute when parent already called getTappIconStyle) */
  iconStyle?: IconStyle
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export function TappIconBadge({
  icon,
  iconSvg,
  name,
  themeColor,
  category,
  id,
  permissions,
  iconShell,
  shellClassName,
  glyphSizeClass,
  glyphTextClass = 'text-xl',
  iconStyle: iconStyleProp,
  className = '',
  style,
  children,
}: TappIconBadgeProps) {
  const iconStyle =
    iconStyleProp ??
    getTappIconStyle({
      icon,
      iconSvg,
      iconShell,
      themeColor,
      category,
      id,
      permissions,
    })

  const shellClasses = [
    'relative overflow-hidden shrink-0',
    shellClassName,
    iconStyle.standalone
      ? 'tapp-icon-badge--standalone bg-transparent'
      : // fill gradient + material inset highlight (consistent across hues)
        `${iconStyle.className} tapp-icon-shell--material flex items-center justify-center text-white`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // Standalone: never paint accent/theme shells (caller style may still add
  // layout-only props; drop background-bearing inline styles).
  const shellStyle: CSSProperties | undefined = iconStyle.standalone
    ? style
      ? (() => {
          const { background: _bg, backgroundImage: _bi, ...rest } = style
          return Object.keys(rest).length > 0 ? rest : undefined
        })()
      : undefined
    : { ...iconStyle.style, ...style }

  const mediaClass = iconStyle.standalone
    ? 'tapp-icon-badge__media relative z-10'
    : iconStyle.insetMedia
      ? // Full-color custom art on shell: keep colors, no monochrome wash
        'tapp-icon-badge__inset-media relative z-10'
      : 'tapp-icon-badge__glyph relative z-10'

  return (
    <div className={shellClasses} style={shellStyle}>
      <TappIcon
        icon={icon}
        iconSvg={iconSvg}
        name={name}
        sizeClass={iconStyle.standalone ? 'w-full h-full' : glyphSizeClass}
        textSizeClass={glyphTextClass}
        svgColor={iconStyle.insetMedia ? null : '#ffffff'}
        className={mediaClass}
      />
      {children}
    </div>
  )
}

export default TappIconBadge
