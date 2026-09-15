/** 分类预置值走库里的「友情链接 / 我」，不走界面语言。 */

import type { PhantasiSource, FeedType, SourceType, UpdateSourceRequest } from '../../../../types/phantasi'
import { workbenchSourceKind } from '../../logic/board'
import type { AddFieldKind } from './addSource'
import { pickAddKind } from './addSource'

export type SubscriptionMode = 'disabled' | 'normal' | 'phantasiai'

export type EditFieldKind = AddFieldKind | 'note'

export const EDIT_INTERVALS = [15, 30, 60, 120, 360, 720, 1440] as const

export function subscriptionModeOf(
  source: Pick<PhantasiSource, 'enabled' | 'source_type'>,
): SubscriptionMode {
  if (!source.enabled) return 'disabled'
  if (source.source_type === 'phantasiai') return 'phantasiai'
  return 'normal'
}

export function editFieldKind(
  source: Pick<PhantasiSource, 'source_type' | 'feed_type'>,
): EditFieldKind {
  return workbenchSourceKind(source)
}

export function canAddCategory(selected: readonly string[]): boolean {
  return selected.length < 2
}

export function joinCategories(
  selected: readonly string[],
  draft = '',
): string | undefined {
  const next = Iterator.from(selected).toArray()
  const extra = draft.trim()
  if (extra && !next.includes(extra) && next.length < 2) next.push(extra)
  return next.length > 0 ? next.join(', ') : undefined
}

export function canSubmitEdit(input: {
  fieldKind: EditFieldKind
  originalKind: EditFieldKind
  url: string
  name: string
  rsshubFullUrl: string
  notionToken: string
}): boolean {
  if (input.fieldKind === 'note') return true
  if (input.fieldKind === 'rsshub') {
    return Boolean(input.rsshubFullUrl.trim() || input.url.trim())
  }
  if (!input.url.trim()) return false
  if (input.fieldKind === 'link' && !input.name.trim()) return false
  if (
    input.fieldKind === 'notion' &&
    input.originalKind !== 'notion' &&
    !input.notionToken.trim()
  ) {
    return false
  }
  return true
}

function resolveFeedType(
  fieldKind: AddFieldKind,
  source: Pick<PhantasiSource, 'feed_type'>,
  originalKind: EditFieldKind,
): FeedType {
  if (fieldKind === 'rsshub') return 'rsshub'
  if (fieldKind === 'notion') return 'notion'
  if (fieldKind === 'link') return 'rss'
  if (
    originalKind === 'rss' &&
    (source.feed_type === 'atom' || source.feed_type === 'json_feed')
  ) {
    return source.feed_type
  }
  return 'rss'
}

function resolveSourceType(
  fieldKind: AddFieldKind,
  mode: SubscriptionMode,
): SourceType {
  if (fieldKind === 'link') return 'link'
  if (mode === 'phantasiai') return 'phantasiai'
  if (fieldKind === 'rsshub') return 'rsshub'
  return 'rss'
}

export function resolveEditSourcePayload(input: {
  source: Pick<PhantasiSource, 'source_type' | 'feed_type'>
  fieldKind: EditFieldKind
  name: string
  category: string
  url: string
  updateInterval: number
  subscriptionMode: SubscriptionMode
  customIcon: string | null
  themeColor: string
  styleTags: readonly string[]
  adminOnly: boolean
  notionToken?: string
  rsshubRoute?: string | null
}): UpdateSourceRequest {
  const originalKind = editFieldKind(input.source)
  const isLink = input.fieldKind === 'link'
  const payload: UpdateSourceRequest = {
    name: input.name.trim() || undefined,
    category: input.category.trim() || undefined,
    theme_color: input.themeColor,
    ai_style_tags: Iterator.from(input.styleTags).toArray(),
    admin_only: input.adminOnly,
  }
  if (input.customIcon !== null) payload.icon = input.customIcon
  if (input.fieldKind === 'note') return payload

  const fieldKind = input.fieldKind
  payload.source_type = resolveSourceType(fieldKind, input.subscriptionMode)
  payload.feed_type = resolveFeedType(fieldKind, input.source, originalKind)
  const url = input.url.trim()
  if (url) payload.url = url
  if (!isLink) {
    payload.enabled = input.subscriptionMode !== 'disabled'
    payload.update_interval = input.updateInterval
  }
  if (fieldKind === 'rsshub') {
    payload.rsshub_route = input.rsshubRoute?.trim() || undefined
  } else if (originalKind === 'rsshub') {
    payload.rsshub_route = ''
  }
  const token = input.notionToken?.trim()
  if (fieldKind === 'notion' && token) {
    payload.extra_config = { token }
  }
  return payload
}

export function pickEditKind(kind: AddFieldKind) {
  return pickAddKind(kind)
}
