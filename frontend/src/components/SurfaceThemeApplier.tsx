import { useEffect } from 'react'

import { useWidgetTheme } from '../hooks/useWidgetTheme'
import { mountSurfaceLenses } from '../utils/liquidGlass/surfaceLenses'

/** AppLayout's persistent theme and per-element liquid lens owner. */
export function SurfaceThemeApplier() {
  useWidgetTheme()
  useEffect(() => mountSurfaceLenses(), [])
  return null
}

export default SurfaceThemeApplier
