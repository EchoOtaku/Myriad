/** 手记文章卡 / 阅读器上的来源用本站身份，不用手记源名。 */

import { getCurrentMetadata } from '../../../utils/siteMetadata'

export type StoryAttribution = {
  name: string
  icon: string | null
}

export function isNoteGuid(guid?: string | null): boolean {
  return typeof guid === 'string' && guid.startsWith('note:')
}

export function isNoteStorySource(item: {
  guid?: string | null
  source_type?: string | null
}): boolean {
  return item.source_type === 'note' || isNoteGuid(item.guid)
}

export function siteStoryAttribution(
  meta: { site_title?: string; site_favicon?: string } = getCurrentMetadata(),
): StoryAttribution {
  return {
    name: meta.site_title?.trim() || '',
    icon: meta.site_favicon?.trim() || null,
  }
}

export function storySourceFace(
  item: {
    guid?: string | null
    source_type?: string | null
    source_name?: string | null
    source_icon?: string | null
  },
  site: StoryAttribution = siteStoryAttribution(),
): StoryAttribution {
  if (isNoteStorySource(item)) return site
  return {
    name: item.source_name?.trim() || '',
    icon: item.source_icon ?? null,
  }
}
