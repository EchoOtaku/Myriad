import type {
  RuntimeGrantKind,
  TappRuntimeGrantResponse,
} from '../services/TappApiService'
import {
  authorizeTappRuntimePermission,
  issueTappRuntimeGrant,
  revokeTappRuntimeGrant,
} from '../services/TappApiService'

const REFRESH_SKEW_MS = 30_000

interface SharedWidgetEntry {
  grant: TappRuntimeGrant
  refs: number
}

/** 页面内共享 widget grant 的不透明 instanceId。不从 tappId 派生，避免跨标签页互相撤销。 */
export function newSharedWidgetInstanceId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return `ws.${hex}`
}

/**
 * 宿主持有；永不写入 iframe HTML 或 postMessage。多 widget 用 acquireSharedWidget：共享 BE
 * grant，各持自己的 session token。
 */
export class TappRuntimeGrant {
  private static readonly tokenOwners = new Map<string, TappRuntimeGrant>()
  private static readonly instances = new Set<TappRuntimeGrant>()
  private static readonly sharedWidgetEntries = new Map<string, SharedWidgetEntry>()
  private current: TappRuntimeGrantResponse | null = null
  private refreshPromise: Promise<TappRuntimeGrantResponse> | null = null
  private destroyed = false

  constructor(
    private readonly tappId: string,
    private readonly instanceId: string,
    private readonly kind: RuntimeGrantKind,
  ) {
    TappRuntimeGrant.instances.add(this)
  }

  /** 同 tappId 的 Widget 共享宿主 grant；各 iframe 仍有独立 session token。 */
  static acquireSharedWidget(tappId: string): {
    grant: TappRuntimeGrant
    release: () => void
  } {
    let entry = TappRuntimeGrant.sharedWidgetEntries.get(tappId)
    if (!entry || entry.grant.isDestroyed()) {
      const grant = new TappRuntimeGrant(
        tappId,
        newSharedWidgetInstanceId(),
        'widget',
      )
      entry = { grant, refs: 0 }
      TappRuntimeGrant.sharedWidgetEntries.set(tappId, entry)
    }
    entry.refs += 1
    let released = false
    const grant = entry.grant
    return {
      grant,
      release: () => {
        if (released) return
        released = true
        const current = TappRuntimeGrant.sharedWidgetEntries.get(tappId)
        if (!current || current.grant !== grant) return
        current.refs -= 1
        if (current.refs <= 0) {
          TappRuntimeGrant.sharedWidgetEntries.delete(tappId)
          current.grant.destroy()
        }
      },
    }
  }

  static sharedWidgetRefCount(tappId: string): number {
    return TappRuntimeGrant.sharedWidgetEntries.get(tappId)?.refs ?? 0
  }

  /** 清共享 widget 池。登录/登出走 destroyAll。 */
  static clearSharedWidgetGrants(): void {
    for (const entry of TappRuntimeGrant.sharedWidgetEntries.values()) {
      entry.grant.destroy()
    }
    TappRuntimeGrant.sharedWidgetEntries.clear()
  }

  async getToken(): Promise<string> {
    if (this.destroyed) {
      throw new Error('Tapp runtime has already stopped')
    }

    const expiresAt = this.current
      ? Date.parse(this.current.expiresAt)
      : Number.NaN
    if (
      this.current &&
      Number.isFinite(expiresAt) &&
      expiresAt - Date.now() > REFRESH_SKEW_MS
    ) {
      return this.current.token
    }

    if (!this.refreshPromise) {
      this.refreshPromise = issueTappRuntimeGrant(
        this.tappId,
        this.instanceId,
        this.kind,
      ).finally(() => {
        this.refreshPromise = null
      })
    }

    const grant = await this.refreshPromise
    if (this.destroyed) {
      void revokeTappRuntimeGrant(this.tappId, grant.runtimeId)
      throw new Error('Tapp runtime stopped while its grant was being issued')
    }

    const previous = this.current
    this.current = grant
    TappRuntimeGrant.tokenOwners.set(grant.token, this)
    if (previous && previous.token !== grant.token) {
      TappRuntimeGrant.tokenOwners.delete(previous.token)
    }
    return grant.token
  }

  async getOwnerId(): Promise<number> {
    await this.getToken()
    if (!this.current) {
      throw new Error('Tapp runtime grant is not initialized')
    }
    return this.current.ownerId
  }

  async getRuntimeId(): Promise<string> {
    await this.getToken()
    if (!this.current) {
      throw new Error('Tapp runtime grant is not initialized')
    }
    return this.current.runtimeId
  }

  async authorize(permission: string): Promise<void> {
    const token = await this.getToken()
    await authorizeTappRuntimePermission(this.tappId, permission, token)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  getTappId(): string {
    return this.tappId
  }

  getInstanceId(): string {
    return this.instanceId
  }

  getKind(): RuntimeGrantKind {
    return this.kind
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    TappRuntimeGrant.instances.delete(this)
    if (this.current) {
      TappRuntimeGrant.tokenOwners.delete(this.current.token)
      void revokeTappRuntimeGrant(this.tappId, this.current.runtimeId)
      this.current = null
    }
  }

  static destroyAll(): void {
    for (const grant of Iterator.from(TappRuntimeGrant.instances).toArray())
      grant.destroy()
    TappRuntimeGrant.tokenOwners.clear()
    TappRuntimeGrant.sharedWidgetEntries.clear()
  }

  static async recoverRejectedToken(token: string): Promise<string | null> {
    const owner = TappRuntimeGrant.tokenOwners.get(token)
    if (!owner || owner.destroyed) return null
    if (owner.current?.token === token) {
      const rejected = owner.current
      owner.current = null
      TappRuntimeGrant.tokenOwners.delete(token)
      void revokeTappRuntimeGrant(owner.tappId, rejected.runtimeId)
    }
    return owner.getToken()
  }
}
