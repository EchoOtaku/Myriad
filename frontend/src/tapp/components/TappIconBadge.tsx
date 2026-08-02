/**
 * Unified Tapp app-icon badge.
 *
 * Glyph / emoji / monochrome SVG → tinted category/theme shell + optional shine.
 * Self-contained bitmap / full-color SVG → full-bleed squircle, no shell pad.
 */

import type { CSSProperties, ReactNode } from 'react'
import type { IconStyle, TappIconStyleSource } from '../utils/tappColors'
import { getTappIconStyle } from '../utils/tappColors'
import { TappIcon } from './TappIcon'

export interface TappIconBadgeProps extends TappIconStyleSource {
  name: string
  /** Outer shell size / shape classes, e.g. "w-14 h-14 rounded-xl shadow-lg" */
  shellClassName: string
  /** Glyph size when not standalone; standalone always fills the shell */
  glyphSizeClass: string
  glyphTextClass?: string
  /** Precomputed style (avoids recompute when parent already called getTappIconStyle) */
  iconStyle?: IconStyle
  /** Glass shine overlay on tinted shells (default true) */
  shine?: boolean
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
  shellClassName,
  glyphSizeClass,
  glyphTextClass = 'text-xl',
  iconStyle: iconStyleProp,
  shine = true,
  className = '',
  style,
  children,
}: TappIconBadgeProps) {
  const iconStyle =
    iconStyleProp ??
    getTappIconStyle({
      icon,
      iconSvg,
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
      : `${iconStyle.className} flex items-center justify-center text-white`,
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

  return (
    <div className={shellClasses} style={shellStyle}>
      {shine && !iconStyle.standalone && (
        <span
          className="pointer-events-none absolute inset-0 bg-linear-to-br from-white/25 to-transparent"
          aria-hidden
        />
      )}
      <TappIcon
        icon={icon}
        iconSvg={iconSvg}
        name={name}
        sizeClass={
          iconStyle.standalone ? 'w-full h-full' : glyphSizeClass
        }
        textSizeClass={glyphTextClass}
        className={
          iconStyle.standalone
            ? 'tapp-icon-badge__media relative z-10'
            : 'relative z-10'
        }
      />
      {children}
    </div>
  )
}

export default TappIconBadge
