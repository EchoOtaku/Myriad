import type { ReactNode } from 'react'
import type { DynamicContentType } from '../../services/DynamicContentProvider'

export interface DynamicContent {
  type: DynamicContentType
  icon: ReactNode
  text: string
  subtext?: string
  showSubtext?: boolean
  sourceTappId?: string
  lyricDuration?: number
}
