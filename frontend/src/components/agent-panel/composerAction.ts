export type ComposerActionKind = 'voice' | 'send' | 'stop'

/**
 * 右侧那一枚动作的身份：忙着且没字是终止（思考中也不回语音）；有字是发送；
 * 空着且语音可用才是语音。没配置语音服务时返回 null，按钮整枚不画。
 */
export function composerActionKind(input: {
  hasText: boolean
  busy: boolean
  speechAvailable: boolean
  voiceLocked: boolean
}): ComposerActionKind | null {
  if (input.busy && !input.hasText) return 'stop'
  if (input.hasText) return 'send'
  if (input.voiceLocked || input.speechAvailable) return 'voice'
  return null
}
