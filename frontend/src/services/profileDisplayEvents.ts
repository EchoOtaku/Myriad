/**
 * 站长公开资料（头像 + 名称/简介）跨组件 / 跨标签页同步。
 *
 * ## 事件约定
 *
 * | 事件 | 何时 | 监听方应做什么 |
 * |------|------|----------------|
 * | `avatar-changed` | 切换画像源 | 刷新 user-info + remount 头像（epoch） |
 * | `profile-display-changed` | 切换文案源，或画像源（兼容） | 强制刷新 user-info 全文案 |
 *
 * `notifyAvatarChanged()` 会**同时**派发两者：脸变了首页也要刷新；
 * `notifyProfileDisplayChanged()` **只**派发 profile-display-changed，
 * 避免纯文案切换时无意义的 img remount（可选优化，监听方可自行判断）。
 *
 * BroadcastChannel 名 `myriad-avatar` 保留（历史兼容）；消息体用 `type` 区分。
 */

const AVATAR_CHANGED_EVENT = 'avatar-changed'
const PROFILE_DISPLAY_CHANGED_EVENT = 'profile-display-changed'
const CHANNEL = 'myriad-avatar'

function broadcast(type: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(type))
  try {
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage({ type })
    channel.close()
  } catch {
    // Safari 隐私模式等：同页 CustomEvent 已派发
  }
}

/** 头像来源已变：派发 avatar-changed + profile-display-changed */
export function notifyAvatarChanged(): void {
  broadcast(AVATAR_CHANGED_EVENT)
  broadcast(PROFILE_DISPLAY_CHANGED_EVENT)
}

/** 名称/简介文案来源已变（不强制等同于头像变） */
export function notifyProfileDisplayChanged(): void {
  broadcast(PROFILE_DISPLAY_CHANGED_EVENT)
}

function subscribe(type: string, handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(type, handler)

  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event) => {
      if (event.data?.type === type) handler()
    }
  } catch {
    channel = null
  }

  return () => {
    window.removeEventListener(type, handler)
    channel?.close()
  }
}

export function onAvatarChanged(handler: () => void): () => void {
  return subscribe(AVATAR_CHANGED_EVENT, handler)
}

export function onProfileDisplayChanged(handler: () => void): () => void {
  return subscribe(PROFILE_DISPLAY_CHANGED_EVENT, handler)
}
