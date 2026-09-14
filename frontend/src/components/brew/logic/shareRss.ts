import type { BrewSource } from '../../../types/brew'
import { workbenchSourceKind } from './board'

/** 与 `myriad_brew_notes::NOTES_RSS_PATH` 同一条公开地址。 */
export const NOTES_RSS_PATH = '/brew/notes.xml'

export function notesRssUrl(origin: string): string {
  const base = origin.trim().replace(/\/$/, '')
  return base ? `${base}${NOTES_RSS_PATH}` : NOTES_RSS_PATH
}

export function sourceRssShareUrl(
  source: Pick<BrewSource, 'source_type' | 'feed_type'>,
  origin: string,
): string | null {
  if (workbenchSourceKind(source) !== 'note') return null
  return notesRssUrl(origin)
}

export function draftRssShareUrl(kind: string, origin: string): string | null {
  if (kind !== 'note') return null
  return notesRssUrl(origin)
}
