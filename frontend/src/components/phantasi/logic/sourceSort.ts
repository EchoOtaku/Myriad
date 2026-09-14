import type { SourceSortMode } from './board'

const KEY = 'phantasi-source-sort'
const MODES = ['smart', 'update', 'category', 'pinyin'] as const satisfies
  readonly SourceSortMode[]

export function isSourceSortMode(value: string): value is SourceSortMode {
  return (MODES as readonly string[]).includes(value)
}

export function readSourceSortMode(): SourceSortMode {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw && isSourceSortMode(raw)) return raw
  } catch {
    /* ignore */
  }
  return 'smart'
}

export function writeSourceSortMode(mode: SourceSortMode): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* ignore */
  }
}
