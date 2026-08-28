export type ComposerActionKind = 'voice' | 'send' | 'stop'

/**
 * 右侧那一枚动作的身份：忙着且没字没附件是终止（思考中也不回语音）；有字或
 * 挂了附件是发送；空着且语音可用才是语音。没配置语音服务时返回 null，按钮整枚不画。
 */
export function composerActionKind(input: {
  hasText: boolean
  /** 框里没字但挂了附件，也该是发送 */
  hasAttachments?: boolean
  busy: boolean
  speechAvailable: boolean
  voiceLocked: boolean
}): ComposerActionKind | null {
  const hasPayload = input.hasText || !!input.hasAttachments
  if (input.busy && !hasPayload) return 'stop'
  if (hasPayload) return 'send'
  if (input.voiceLocked || input.speechAvailable) return 'voice'
  return null
}
