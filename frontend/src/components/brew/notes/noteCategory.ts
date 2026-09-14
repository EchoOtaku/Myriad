/** 手记分类是站长自建的名字，不是订阅主题。 */

import {
  brewCategoryParts,
  isFriendLinkCategory,
  isMineCategory,
} from '../constants'
import {
  topicDisplayName,
  topicHue,
  topicNameKey,
  type TopicNameKey,
} from '../logic/topics'

export const MAX_NOTE_CATEGORY_CHARS = 40
/** 筛选：全部 */
export const NOTE_CATEGORY_ALL = null
/** 筛选：还没归类 */
export const NOTE_CATEGORY_NONE = ''

export function normalizeNoteCategory(
  value: string | null | undefined,
): string | null {
  const name = value?.trim() ?? ''
  if (!name) return null
  return [...name].slice(0, MAX_NOTE_CATEGORY_CHARS).join('')
}

export function isNoteBoardCategory(name: string): boolean {
  return !isFriendLinkCategory(name) && !isMineCategory(name)
}

export function collectNoteCategories(
  items: ReadonlyArray<{ topic?: string | null }>,
): string[] {
  const names = new Set<string>()
  for (const item of items) {
    for (const part of brewCategoryParts(item.topic)) {
      const name = normalizeNoteCategory(part)
      if (name && isNoteBoardCategory(name)) names.add(name)
    }
  }
  return [...names].toSorted((a, b) => a.localeCompare(b, 'zh'))
}

export function noteCategoryLabel(
  name: string,
  labels: Partial<Record<TopicNameKey, string>>,
): string {
  const key = topicNameKey(name)
  if (!key) return name
  return topicDisplayName({ key: name, nameKey: key }, labels)
}

export function noteCategoryHue(name: string): string {
  return topicHue(name)
}

export function noteStoryTopic(
  topic: string | null | undefined,
  labels: Partial<Record<TopicNameKey, string>>,
): { topic: string | null; hue: string | null } {
  const name = normalizeNoteCategory(topic)
  if (!name) return { topic: null, hue: null }
  return {
    topic: noteCategoryLabel(name, labels),
    hue: noteCategoryHue(name),
  }
}

export function matchesNoteCategory(
  topic: string | null | undefined,
  filter: string | null,
): boolean {
  if (filter == null) return true
  const parts = brewCategoryParts(topic)
    .map((part) => normalizeNoteCategory(part))
    .filter((name): name is string => name != null)
  if (filter === NOTE_CATEGORY_NONE) return parts.length === 0
  return parts.includes(filter)
}
