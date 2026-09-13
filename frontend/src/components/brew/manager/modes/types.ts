import type { SourceSortMode } from '../../logic/board'

/** 排序取值跟板块源表同一份。 */
export type SortMode = SourceSortMode

export type SortLabelKey =
  | 'sortBySmart'
  | 'sortByUpdate'
  | 'sortByCategory'
  | 'sortByPinyin'

export interface SortOption {
  value: SortMode
  labelKey: SortLabelKey
  icon: React.ReactNode
  disabled?: boolean
}

export interface ImportProgress {
  step: string
  current: number
  total: number
}

export interface TopicFeedModeConfig {
  topicKey: string
  topicLabel: string
  total: number
  onBack: () => void
}

export interface StarredModeConfig {
  total: number
  selectedIds: Set<number>
  isEditMode: boolean
  onBack: () => void
  onEnterEditMode: () => void
  onExitEditMode: () => void
  onSelectAll: () => void
  onBatchUnstar: () => void
  isProcessing?: boolean
}

export type { BrewExportManifest } from '../../../../types/brew'
