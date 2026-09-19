import type { AppNotification } from './notificationApi'
import { currentCopy } from '../i18n/localeCopy'
import { apiService } from './api'
import { federationApi } from './federationApi'

export async function runFederationInviteAction(
  n: AppNotification,
  actionId: string,
): Promise<void> {
  const kind = n.metadata?.kind
  const roomId =
    typeof n.metadata?.room_id === 'string' ? n.metadata.room_id : ''
  const channelId =
    typeof n.metadata?.channel_id === 'string' ? n.metadata.channel_id : ''

  if (kind === 'room_invite' || (roomId && !channelId)) {
    if (!roomId) throw new Error(currentCopy().errors.inviteInvalid)
    if (actionId === 'accept') {
      await federationApi.acceptRoomInvite(roomId)
      return
    }
    if (actionId === 'reject') {
      await federationApi.rejectRoomInvite(roomId)
      return
    }
  }
  if (kind === 'channel_invite' || channelId) {
    if (!channelId) throw new Error(currentCopy().errors.inviteInvalid)
    if (actionId === 'accept') {
      await federationApi.acceptChannel(channelId)
      return
    }
    if (actionId === 'reject') {
      await federationApi.closeChannel(channelId)
      return
    }
  }
  throw new Error(currentCopy().errors.agentUnsupported)
}

function seoReviewDrafts(
  n: AppNotification,
): Record<string, string> {
  const body: Record<string, string> = {}
  for (const key of [
    'site_description',
    'site_keywords',
    'site_ai_intro',
  ] as const) {
    const value = n.metadata?.[key]
    if (typeof value === 'string' && value.trim()) {
      body[key] = value
    }
  }
  return body
}

export async function runSeoReviewApply(n: AppNotification): Promise<void> {
  const drafts = seoReviewDrafts(n)
  if (Object.keys(drafts).length === 0) {
    throw new Error(currentCopy().errors.seoApplyMissingDraft)
  }
  await apiService.post('/seo/apply-copy', drafts)
}
