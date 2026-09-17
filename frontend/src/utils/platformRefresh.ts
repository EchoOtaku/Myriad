import type { TranslationKeys } from '../i18n'

type FetchCopy = TranslationKeys['dataManagement']['fetchResult']

/** A fetch can persist useful data before reporting an upstream failure. */
export async function refreshPlatformViews(
  loadStatus: () => Promise<unknown>,
  reloadPreview: () => Promise<unknown>,
) {
  await Promise.allSettled([loadStatus(), reloadPreview()])
}

// Translate persisted deterministic summaries too, without regenerating caches.
export function localizePlatformSummary(summary: string, copy: FetchCopy): string {
  const video = summary.match(/^Analysis based on (\d+) collected videos and (\d+) followed series$/)
  const collection = summary.match(/^Bangumi collection: (\d+) items, finished (\d+), currently (\d+)$/)
  const repo = summary.match(/^Owns (\d+) repositories, mainly using (.*)$/)
  const match = video || collection || repo
  if (!match) return summary
  const template = video ? copy.videoSummary : collection ? copy.collectionSummary : copy.repoSummary
  return template.replace(/\{(\d)\}/g, (_, i: string) => match[Number(i)])
}

export function platformFetchDetails(issues: unknown, copy: FetchCopy): string {
  if (!Array.isArray(issues)) return ''
  const stages: Record<string, string> = copy.stages
  const reasons: Record<string, string> = copy.reasons
  return issues.flatMap((issue: unknown) => {
    if (!issue || typeof issue !== 'object') return []
    const { stage, reason } = issue as { stage?: unknown, reason?: unknown }
    if (typeof stage !== 'string' || typeof reason !== 'string' || !Object.hasOwn(stages, stage) || !Object.hasOwn(reasons, reason)) return []
    return [`${stages[stage]}: ${reasons[reason]}`]
  }).join('\n')
}
