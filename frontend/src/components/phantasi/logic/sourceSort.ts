import type { SourceSortMode } from './board'

const MODES = ['smart', 'update', 'category', 'pinyin'] as const satisfies
  readonly SourceSortMode[]

export function isSourceSortMode(value: unknown): value is SourceSortMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

export function normalizeSourceSortMode(value: unknown): SourceSortMode {
  return isSourceSortMode(value) ? value : 'smart'
}
