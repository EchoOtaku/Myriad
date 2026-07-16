import type { TappInstance, TappMessage } from '../types'
import {
  authorizeDataExchange,
  cancelDataExchange,
  consumeDataExchange,
  prepareDataExchange,
  type OneShotDataAccessGrant,
  type PreparedDataExchange,
} from '../services/TappApiService'
import type { TappBridge } from './TappBridge'

const PROVIDER_TIMEOUT_MS = 30_000
const DATA_EXCHANGE_ID = /^[A-Za-z0-9_.-]{1,128}$/

interface RuntimeRegistration {
  bridge: TappBridge
  instance: TappInstance
  exports: Set<string>
}

interface DataExchangeRequest {
  targetTappId: string
  exportId: string
  params?: unknown
  purpose: string
}

interface ProviderResponse {
  requestId: string
  ok: boolean
  data?: unknown
  error?: string
}

interface PendingInvocation {
  requester: RuntimeRegistration
  provider: RuntimeRegistration
  requesterRuntimeGrant: string
  access: OneShotDataAccessGrant
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

function getArgs(message: TappMessage): unknown[] {
  return (message.payload as { args?: unknown[] } | undefined)?.args ?? []
}

function formatLimit(prepared: PreparedDataExchange): string {
  const byteLimit = `${Math.ceil(prepared.maxBytes / 1024)} KiB`
  return prepared.maxRecords
    ? `${prepared.maxRecords} 条记录 / ${byteLimit}`
    : byteLimit
}

/**
 * Trusted host consent surface. The sandbox cannot call window.confirm itself
 * and never receives either the Runtime Grant or one-shot Data Access token.
 */
function confirmOneShotAccess(prepared: PreparedDataExchange): boolean {
  const language = navigator.language.toLowerCase()
  if (language.startsWith('ja')) {
    return window.confirm(
      `「${prepared.requesterName}」が「${prepared.providerName}」からデータを取得しようとしています。\n\n` +
        `データ: ${prepared.exportDescription || prepared.exportId}\n` +
        `目的: ${prepared.purpose}\n` +
        `上限: ${formatLimit(prepared)}\n\n` +
        '今回の1回だけ許可しますか？',
    )
  }
  if (!language.startsWith('zh')) {
    return window.confirm(
      `“${prepared.requesterName}” wants data from “${prepared.providerName}”.\n\n` +
        `Data: ${prepared.exportDescription || prepared.exportId}\n` +
        `Purpose: ${prepared.purpose}\n` +
        `Limit: ${formatLimit(prepared)}\n\n` +
        'Allow this request once?',
    )
  }
  return window.confirm(
    `“${prepared.requesterName}”想从“${prepared.providerName}”调取数据。\n\n` +
      `数据：${prepared.exportDescription || prepared.exportId}\n` +
      `用途：${prepared.purpose}\n` +
      `上限：${formatLimit(prepared)}\n\n` +
      '是否仅允许本次调用？',
  )
}

class DataExchangeBroker {
  private readonly runtimes = new Set<RuntimeRegistration>()
  private readonly pending = new Map<string, PendingInvocation>()

  register(bridge: TappBridge, instance: TappInstance): () => void {
    const runtime: RuntimeRegistration = {
      bridge,
      instance,
      exports: new Set(),
    }
    this.runtimes.add(runtime)

    bridge.registerHandler('dataExchange.registerProvider', async (message) => {
      const [exportId] = getArgs(message) as [string]
      if (!DATA_EXCHANGE_ID.test(exportId || '')) {
        return { success: false, error: 'Invalid Data Exchange export id' }
      }
      const declared = instance.manifest.dataExchange?.exports?.some(
        (item) => item.id === exportId,
      )
      if (!declared) {
        return {
          success: false,
          error: `Data Exchange export is not declared: ${exportId}`,
        }
      }
      runtime.exports.add(exportId)
      return { success: true, data: null }
    })

    bridge.registerHandler(
      'dataExchange.unregisterProvider',
      async (message) => {
        const [exportId] = getArgs(message) as [string]
        runtime.exports.delete(exportId)
        return { success: true, data: null }
      },
    )

    bridge.registerHandler('dataExchange.request', async (message) => {
      const [request] = getArgs(message) as [DataExchangeRequest]
      try {
        const data = await this.request(runtime, request)
        return { success: true, data }
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Data Exchange failed',
        }
      }
    })

    bridge.registerHandler('dataExchange.respond', async (message) => {
      const [response] = getArgs(message) as [ProviderResponse]
      try {
        await this.respond(runtime, response)
        return { success: true, data: null }
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Provider response failed',
        }
      }
    })

    return () => {
      this.runtimes.delete(runtime)
      for (const [requestId, invocation] of this.pending) {
        if (
          invocation.provider === runtime ||
          invocation.requester === runtime
        ) {
          clearTimeout(invocation.timeout)
          invocation.reject(new Error('Data Exchange runtime stopped'))
          this.pending.delete(requestId)
          void cancelDataExchange(
            requestId,
            invocation.requesterRuntimeGrant,
          ).catch(() => {})
        }
      }
      bridge.unregisterHandler('dataExchange.registerProvider')
      bridge.unregisterHandler('dataExchange.unregisterProvider')
      bridge.unregisterHandler('dataExchange.request')
      bridge.unregisterHandler('dataExchange.respond')
    }
  }

  async requestForHost(
    bridge: TappBridge,
    request: DataExchangeRequest,
  ): Promise<unknown> {
    const requester = [...this.runtimes].find(
      (runtime) => runtime.bridge === bridge,
    )
    if (!requester) {
      throw new Error('Requester runtime is not registered')
    }
    return this.request(requester, request)
  }

  private async findProvider(
    targetTappId: string,
    exportId: string,
    providerOwnerId: number,
  ): Promise<RuntimeRegistration | undefined> {
    const candidates = [...this.runtimes].filter(
      (runtime) =>
        runtime.instance.id === targetTappId && runtime.exports.has(exportId),
    )
    for (const candidate of candidates) {
      try {
        if ((await candidate.bridge.getRuntimeOwnerId()) === providerOwnerId) {
          return candidate
        }
      } catch {
        // A runtime may disappear while a prepared request is being matched.
        // Continue to any other online instance of the same installation.
      }
    }
    return undefined
  }

  private async request(
    requester: RuntimeRegistration,
    request: DataExchangeRequest,
  ): Promise<unknown> {
    if (
      !request ||
      typeof request !== 'object' ||
      !DATA_EXCHANGE_ID.test(request.targetTappId || '') ||
      !DATA_EXCHANGE_ID.test(request.exportId || '') ||
      typeof request.purpose !== 'string' ||
      request.purpose.trim().length === 0 ||
      request.purpose.length > 500
    ) {
      throw new Error('Invalid Data Exchange request')
    }

    const runtimeGrant = await requester.bridge.getRuntimeGrant()
    const prepared = await prepareDataExchange(
      {
        targetTappId: request.targetTappId,
        exportId: request.exportId,
        params: request.params ?? null,
        purpose: request.purpose,
      },
      runtimeGrant,
    )

    const provider = await this.findProvider(
      request.targetTappId,
      request.exportId,
      prepared.providerOwnerId,
    )
    if (!provider) {
      await cancelDataExchange(prepared.requestId, runtimeGrant).catch(() => {})
      throw new Error(
        `Data provider is not running: ${request.targetTappId}/${request.exportId}`,
      )
    }

    if (!confirmOneShotAccess(prepared)) {
      await cancelDataExchange(prepared.requestId, runtimeGrant).catch(() => {})
      throw new Error('Data Exchange request was denied')
    }

    const access = await authorizeDataExchange(prepared.requestId, runtimeGrant)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(prepared.requestId)
        void cancelDataExchange(prepared.requestId, runtimeGrant).catch(
          () => {},
        )
        reject(new Error('Data provider response timed out'))
      }, PROVIDER_TIMEOUT_MS)
      this.pending.set(prepared.requestId, {
        requester,
        provider,
        requesterRuntimeGrant: runtimeGrant,
        access,
        resolve,
        reject,
        timeout,
      })
      provider.bridge.emit('dataExchange:invoke', {
        requestId: prepared.requestId,
        exportId: prepared.exportId,
        params: access.params,
        purpose: access.purpose,
      })
    })
  }

  private async respond(
    provider: RuntimeRegistration,
    response: ProviderResponse,
  ): Promise<void> {
    if (!response || typeof response.requestId !== 'string') {
      throw new Error('Invalid provider response')
    }
    const invocation = this.pending.get(response.requestId)
    if (!invocation || invocation.provider !== provider) {
      throw new Error(
        'Data Exchange request is missing or belongs to another runtime',
      )
    }
    clearTimeout(invocation.timeout)
    this.pending.delete(response.requestId)

    const providerRuntimeGrant = await provider.bridge.getRuntimeGrant()
    if (!response.ok) {
      // Consume with a deliberately invalid response so provider failures also
      // exhaust the one-shot token. The original provider error is preserved.
      await consumeDataExchange(
        invocation.access.token,
        null,
        providerRuntimeGrant,
      ).catch(() => {})
      invocation.reject(
        new Error(response.error || 'Data provider failed to produce a result'),
      )
      return
    }

    try {
      const result = await consumeDataExchange(
        invocation.access.token,
        response.data,
        providerRuntimeGrant,
      )
      invocation.resolve(result)
    } catch (error) {
      invocation.reject(
        error instanceof Error ? error : new Error('Data response rejected'),
      )
      throw error
    }
  }
}

const broker = new DataExchangeBroker()

export function registerDataExchangeHandlers(
  bridge: TappBridge,
  instance: TappInstance,
): () => void {
  return broker.register(bridge, instance)
}

/** Trusted host adapter used by an authorized Agent Interaction intent. */
export function requestDataExchangeFromHost(
  bridge: TappBridge,
  request: DataExchangeRequest,
): Promise<unknown> {
  return broker.requestForHost(bridge, request)
}
